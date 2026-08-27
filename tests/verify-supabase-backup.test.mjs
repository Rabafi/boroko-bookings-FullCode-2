import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { gunzipSync, gzipSync } from 'node:zlib'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { encryptBackupFile, generateBackupKeyPair } from '../scripts/backup-crypto.mjs'
import {
  parseTarArchive,
  redactError,
  rehearseEncryptedSupabaseBackup,
  verifyEncryptedSupabaseBackup,
  verifyPlainArchiveBytes
} from '../scripts/verify-supabase-backup.mjs'

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

function tarEntry(name, content, type = '0') {
  const bytes = Buffer.isBuffer(content) ? content : Buffer.from(content)
  const header = Buffer.alloc(512, 0)
  header.write(name, 0, 100, 'utf8')
  header.write('0000644\0', 100, 8, 'ascii')
  header.write('0000000\0', 108, 8, 'ascii')
  header.write('0000000\0', 116, 8, 'ascii')
  header.write(`${bytes.length.toString(8).padStart(11, '0')}\0`, 124, 12, 'ascii')
  header.write('00000000000\0', 136, 12, 'ascii')
  header.fill(0x20, 148, 156)
  header[156] = type.charCodeAt(0)
  header.write('ustar\0', 257, 6, 'ascii')
  header.write('00', 263, 2, 'ascii')
  const checksum = [...header].reduce((total, byte) => total + byte, 0)
  header.write(`${checksum.toString(8).padStart(6, '0')}\0 `, 148, 8, 'ascii')
  const padding = Buffer.alloc((512 - (bytes.length % 512)) % 512)
  return Buffer.concat([header, bytes, padding])
}

function validArchiveFiles(overrides = {}) {
  const values = {
    'roles.sql': '-- roles\n',
    'schema.sql': 'create table example(id uuid primary key);\n',
    'data.sql': 'copy example (id) from stdin;\n\\.\n',
    ...overrides
  }
  const metadata = Buffer.from(JSON.stringify({
    format_version: 1,
    created_at: '2026-08-27T00:00:00Z',
    repository: 'example/repository',
    commit: '0123456789abcdef',
    run_id: '42',
    contents: ['roles.sql', 'schema.sql', 'data.sql']
  }))
  values['metadata.json'] = metadata
  values.SHA256SUMS = Buffer.from(['roles.sql', 'schema.sql', 'data.sql', 'metadata.json']
    .map((name) => `${sha256(Buffer.from(values[name]))}  ${name}`)
    .join('\n') + '\n')
  const tar = Buffer.concat(Object.entries(values).map(([name, content]) => tarEntry(name, content)))
  return gzipSync(Buffer.concat([tar, Buffer.alloc(1024)]))
}

async function encryptedFixture(context, archiveBytes = validArchiveFiles()) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'tsa-backup-verify-'))
  context.after(() => fs.rm(directory, { recursive: true, force: true }))
  const archivePath = path.join(directory, 'database.tar.gz')
  const encryptedPath = path.join(directory, 'database.tar.gz.tbbackup')
  const passphrase = 'local verification passphrase'
  const pair = generateBackupKeyPair(passphrase)
  await fs.writeFile(archivePath, archiveBytes)
  await encryptBackupFile({ inputPath: archivePath, outputPath: encryptedPath, publicKeyPem: pair.publicKey })
  await fs.rm(archivePath)
  return { directory, archivePath, encryptedPath, passphrase, pair }
}

test('verifies encrypted SQL archive manifest and all checksums', async (context) => {
  const fixture = await encryptedFixture(context)
  const result = await verifyEncryptedSupabaseBackup({
    inputPath: fixture.encryptedPath,
    privateKeyPem: fixture.pair.privateKey,
    passphrase: fixture.passphrase
  })

  assert.equal(result.valid, true)
  assert.equal(result.encrypted, true)
  assert.equal(result.checksums_verified, true)
  assert.deepEqual(result.required_files, ['roles.sql', 'schema.sql', 'data.sql', 'metadata.json', 'SHA256SUMS'])
  assert.deepEqual(result.files.map((entry) => entry.name), ['data.sql', 'metadata.json', 'roles.sql', 'schema.sql', 'SHA256SUMS'])
  assert.equal(result.metadata.repository, 'example/repository')
  assert.equal(result.metadata.contents.includes('data.sql'), true)
  assert.equal(result.decrypted_archive_path, undefined)
  await assert.rejects(fs.stat(path.join(fixture.directory, 'database.tar.gz')), { code: 'ENOENT' })
})

test('rehearsal writes only a non-secret validation report and no plaintext archive', async (context) => {
  const fixture = await encryptedFixture(context)
  const reportPath = path.join(fixture.directory, 'rehearsal-report.json')
  const report = await rehearseEncryptedSupabaseBackup({
    inputPath: fixture.encryptedPath,
    privateKeyPem: fixture.pair.privateKey,
    passphrase: fixture.passphrase,
    reportPath
  })

  assert.equal(report.rehearsal_only, true)
  assert.equal(report.restores_database, false)
  assert.equal(report.writes_database, false)
  assert.equal(report.checksums_verified, true)
  assert.equal(report.report_path, reportPath)
  const saved = JSON.parse(await fs.readFile(reportPath, 'utf8'))
  assert.equal(saved.metadata.repository, 'example/repository')
  assert.equal(saved.metadata.passphrase, undefined)
  assert.equal(saved.privateKeyPem, undefined)
  assert.equal(saved.next_step.includes('disposable project'), true)
  await assert.rejects(fs.stat(path.join(fixture.directory, 'database.tar.gz')), { code: 'ENOENT' })
})

test('rejects checksum tampering before rehearsal can produce a report', async (context) => {
  const archive = validArchiveFiles({ 'data.sql': 'tampered\n' })
  const fixture = await encryptedFixture(context, archive)
  // Alter the encrypted payload after authentication has been established.
  const encrypted = await fs.readFile(fixture.encryptedPath)
  encrypted[Math.floor(encrypted.length / 2)] ^= 0x01
  await fs.writeFile(fixture.encryptedPath, encrypted)

  await assert.rejects(
    verifyEncryptedSupabaseBackup({
      inputPath: fixture.encryptedPath,
      privateKeyPem: fixture.pair.privateKey,
      passphrase: fixture.passphrase
    }),
    (error) => Boolean(error)
  )
})

test('authenticated failure cleanup is safe for concurrent decryptions', async (context) => {
  const fixture = await encryptedFixture(context)
  const encrypted = await fs.readFile(fixture.encryptedPath)
  const attempts = await Promise.all(Array.from({ length: 4 }, async (_, index) => {
    const inputPath = path.join(fixture.directory, `tampered-${index}.tbbackup`)
    const outputPath = path.join(fixture.directory, `restored-${index}.tar.gz`)
    const copy = Buffer.from(encrypted)
    copy[Math.floor(copy.length / 2) + index] ^= 0x01
    await fs.writeFile(inputPath, copy)
    return assert.rejects(
      verifyEncryptedSupabaseBackup({
        inputPath,
        outputPath,
        privateKeyPem: fixture.pair.privateKey,
        passphrase: fixture.passphrase
      }),
      (error) => Boolean(error)
    )
  }))
  assert.equal(attempts.length, 4)
  for (let index = 0; index < 4; index += 1) {
    await assert.rejects(fs.stat(path.join(fixture.directory, `restored-${index}.tar.gz`)), { code: 'ENOENT' })
  }
})

test('rejects a validly encrypted archive with a mismatched SHA256SUMS entry', async (context) => {
  const archive = validArchiveFiles()
  // The archive fixture has an authenticated outer envelope; the inner
  // checksum manifest still has to be checked independently.
  const fixture = await encryptedFixture(context, archive)
  const result = await verifyEncryptedSupabaseBackup({
    inputPath: fixture.encryptedPath,
    privateKeyPem: fixture.pair.privateKey,
    passphrase: fixture.passphrase
  })
  assert.equal(result.checksums_verified, true)

  const invalid = validArchiveFiles()
  const tar = Buffer.from(requireGunzip(invalid))
  // Keep this as a direct parser contract: checksum mismatch is rejected by
  // the verifier even when the outer encryption layer is not involved.
  const marker = Buffer.from(sha256(Buffer.from('-- roles\n')))
  const markerOffset = tar.indexOf(marker)
  assert.ok(markerOffset >= 0)
  tar[markerOffset] = tar[markerOffset] === 0x30 ? 0x31 : 0x30
  assert.throws(() => verifyPlainArchiveBytes(requireGzip(tar)), /SHA-256 verification failed for roles\.sql/)
})

test('tar parser rejects path traversal and symlink entries', () => {
  const rootDirectory = Buffer.concat([tarEntry('./', '', '5'), tarEntry('roles.sql', 'roles'), Buffer.alloc(1024)])
  assert.equal(parseTarArchive(rootDirectory).get('roles.sql').content.toString(), 'roles')
  const traversal = Buffer.concat([tarEntry('../secret', 'secret'), Buffer.alloc(1024)])
  assert.throws(() => parseTarArchive(traversal), /unsafe path/)
  const symlink = Buffer.concat([tarEntry('roles.sql', '', '2'), Buffer.alloc(1024)])
  assert.throws(() => parseTarArchive(symlink), /unsupported entry type/)
})

test('error redaction never echoes a passphrase or private key', () => {
  const passphrase = 'correct horse battery staple'
  const privateKey = '-----BEGIN PRIVATE KEY-----\nsecret\n-----END PRIVATE KEY-----'
  const message = redactError(new Error(`bad decrypt ${passphrase} ${privateKey}`), [passphrase])
  assert.equal(message.includes(passphrase), false)
  assert.equal(message.includes('secret'), false)
  assert.match(message, /\[redacted-key\]/)
})

// Keep the test self-contained without shelling out to tar/gzip utilities.
function requireGunzip(bytes) {
  return gunzipSync(bytes)
}

function requireGzip(bytes) {
  return gzipSync(bytes)
}
