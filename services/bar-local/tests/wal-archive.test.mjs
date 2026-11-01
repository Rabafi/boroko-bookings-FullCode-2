import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash, randomBytes } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  archiveWalSegment,
  readWalArchiveKey,
  restoreWalSegment
} from '../dist/operations/walArchive.js'

const hash = (data) => createHash('sha256').update(data).digest('hex')
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

test('WAL archive encrypts content, verifies authenticated restore, and retries idempotently', async (t) => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'bar-local-wal-'))
  t.after(() => rm(temp, { recursive: true, force: true }))
  const archiveDir = path.join(temp, 'archive')
  const source = path.join(temp, '000000010000000000000001')
  const restored = path.join(temp, 'restore', path.basename(source))
  const keyFile = path.join(temp, 'recovery.key')
  const key = randomBytes(32)
  const contents = Buffer.concat([Buffer.from('postgresql WAL fixture\n'), randomBytes(32 * 1024)])
  await writeFile(source, contents)
  await writeFile(keyFile, `${key.toString('hex')}\n`, { mode: 0o600 })
  const loadedKey = await readWalArchiveKey(keyFile)
  assert.deepEqual(loadedKey, key)

  const first = await archiveWalSegment({ sourcePath: source, walName: path.basename(source), archiveDir, key: loadedKey })
  assert.equal(first.archived, true)
  const encrypted = await readFile(first.path)
  assert.equal(encrypted.includes(contents), false)
  assert.notEqual(hash(encrypted), hash(contents))

  const replay = await archiveWalSegment({ sourcePath: source, walName: path.basename(source), archiveDir, key: loadedKey })
  assert.equal(replay.archived, false)
  assert.equal(replay.sha256, hash(contents))

  const restoredResult = await restoreWalSegment({ walName: path.basename(source), archiveDir, targetPath: restored, key: loadedKey })
  assert.equal(restoredResult.restored, true)
  assert.deepEqual(await readFile(restored), contents)
  const restoreReplay = await restoreWalSegment({ walName: path.basename(source), archiveDir, targetPath: restored, key: loadedKey })
  assert.equal(restoreReplay.restored, false)
  assert.equal(restoreReplay.sha256, hash(contents))
})

test('WAL archive rejects tampering, changed segment reuse, and unsafe segment names without publishing partial output', async (t) => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'bar-local-wal-'))
  t.after(() => rm(temp, { recursive: true, force: true }))
  const archiveDir = path.join(temp, 'archive')
  const source = path.join(temp, '000000010000000000000002')
  const target = path.join(temp, 'restore', path.basename(source))
  const key = randomBytes(32)
  await writeFile(source, randomBytes(8192))
  const archived = await archiveWalSegment({ sourcePath: source, walName: path.basename(source), archiveDir, key })
  const tampered = Buffer.from(await readFile(archived.path))
  tampered[tampered.length - 1] ^= 0xff
  await writeFile(archived.path, tampered)

  await assert.rejects(
    restoreWalSegment({ walName: path.basename(source), archiveDir, targetPath: target, key }),
    (error) => error.code === 'WAL_ARCHIVE_CORRUPT'
  )
  assert.equal(await access(target).then(() => true, () => false), false)
  await assert.rejects(
    archiveWalSegment({ sourcePath: source, walName: path.basename(source), archiveDir, key }),
    (error) => error.code === 'WAL_ARCHIVE_CONFLICT'
  )
  await assert.rejects(
    archiveWalSegment({ sourcePath: source, walName: '../escape', archiveDir, key }),
    (error) => error.code === 'WAL_NAME_INVALID'
  )
})

test('WAL archive key file format is strict and rejects wrong key sizes', async (t) => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'bar-local-wal-key-'))
  t.after(() => rm(temp, { recursive: true, force: true }))
  const keyFile = path.join(temp, 'recovery.key')
  await writeFile(keyFile, `${randomBytes(31).toString('hex')}\n`)
  await assert.rejects(readWalArchiveKey(keyFile), (error) => error.code === 'WAL_KEY_INVALID')
  await writeFile(keyFile, 'not a key file')
  await assert.rejects(readWalArchiveKey(keyFile), (error) => error.code === 'WAL_KEY_INVALID')
})

test('PostgreSQL archiver CLI accepts the configured archive and restore argument contracts', async (t) => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'bar-local-wal-cli-'))
  t.after(() => rm(temp, { recursive: true, force: true }))
  const walName = '000000010000000000000003'
  const source = path.join(temp, walName)
  const target = path.join(temp, 'restored', walName)
  const archiveDir = path.join(temp, 'archive')
  const keyFile = path.join(temp, 'key')
  const data = randomBytes(4096)
  await writeFile(source, data)
  await writeFile(keyFile, randomBytes(32).toString('hex'))
  const cli = path.join(root, 'scripts', 'wal-archive.mjs')
  const run = (mode, locationFlag, location) => spawnSync(process.execPath, [
    cli, mode,
    '--wal-name', walName,
    '--archive-dir', archiveDir,
    '--key-file', keyFile,
    locationFlag, location
  ], { encoding: 'utf8', windowsHide: true })

  const archived = run('archive', '--source', source)
  assert.equal(archived.status, 0, archived.stderr)
  assert.equal(JSON.parse(archived.stdout).ok, true)
  const restored = run('restore', '--target', target)
  assert.equal(restored.status, 0, restored.stderr)
  assert.equal(JSON.parse(restored.stdout).ok, true)
  assert.deepEqual(await readFile(target), data)
})
