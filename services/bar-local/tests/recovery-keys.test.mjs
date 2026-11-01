import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { exportRecoveryKeys, unlockRecoveryKeys, safeRecoveryPath } from '../dist/operations/recovery.js'

test('portable recovery keys require passphrase, authenticate tampering and never expose plaintext', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'bar-recovery-keys-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const backup = 'ab'.repeat(32), wal = 'cd'.repeat(32)
  await writeFile(path.join(root, 'backup.key'), backup)
  await writeFile(path.join(root, 'wal.key'), wal)
  const config = { backup: { keyFile: path.join(root, 'backup.key') }, recovery: { walKeyFile: path.join(root, 'wal.key') } }
  await assert.rejects(exportRecoveryKeys(config, 'short'))
  const bundle = await exportRecoveryKeys(config, 'a long recovery passphrase')
  assert.equal(JSON.stringify(bundle).includes(backup), false)
  assert.equal(unlockRecoveryKeys(bundle, 'a long recovery passphrase').wal_key, wal)
  assert.throws(() => unlockRecoveryKeys(bundle, 'wrong passphrase'))
  assert.throws(() => unlockRecoveryKeys({ ...bundle, tag: '00'.repeat(16) }, 'a long recovery passphrase'))
  for (const name of ['../data', '/absolute', 'C:/data', 'a\\b', 'a/../b', 'a//b']) assert.throws(() => safeRecoveryPath(root, name))
})
