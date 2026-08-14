import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  decryptBackupFile,
  encryptBackupFile,
  generateBackupKeyPair
} from '../scripts/backup-crypto.mjs'
import { selectBackupRetention } from '../scripts/google-drive-backup.mjs'

test('encrypted backup round trip restores the exact bytes', async (context) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'tsa-backup-crypto-'))
  context.after(() => fs.rm(directory, { recursive: true, force: true }))
  const inputPath = path.join(directory, 'database.tar.gz')
  const encryptedPath = path.join(directory, 'database.tbbackup')
  const restoredPath = path.join(directory, 'restored.tar.gz')
  const original = Buffer.concat([
    Buffer.from('roles.sql\nschema.sql\ndata.sql\n'),
    Buffer.alloc(256 * 1024, 0x5a)
  ])
  await fs.writeFile(inputPath, original)
  const passphrase = 'correct horse battery staple'
  const pair = generateBackupKeyPair(passphrase)

  await encryptBackupFile({ inputPath, outputPath: encryptedPath, publicKeyPem: pair.publicKey })
  await decryptBackupFile({
    inputPath: encryptedPath,
    outputPath: restoredPath,
    privateKeyPem: pair.privateKey,
    passphrase
  })

  assert.deepEqual(await fs.readFile(restoredPath), original)
})

test('tampered encrypted backup fails closed and leaves no partial restore', async (context) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'tsa-backup-tamper-'))
  context.after(() => fs.rm(directory, { recursive: true, force: true }))
  const inputPath = path.join(directory, 'database.tar.gz')
  const encryptedPath = path.join(directory, 'database.tbbackup')
  const restoredPath = path.join(directory, 'restored.tar.gz')
  await fs.writeFile(inputPath, Buffer.alloc(64 * 1024, 0x31))
  const passphrase = 'another long recovery password'
  const pair = generateBackupKeyPair(passphrase)
  await encryptBackupFile({ inputPath, outputPath: encryptedPath, publicKeyPem: pair.publicKey })

  const encrypted = await fs.readFile(encryptedPath)
  encrypted[Math.floor(encrypted.length / 2)] ^= 0xff
  await fs.writeFile(encryptedPath, encrypted)

  await assert.rejects(
    decryptBackupFile({
      inputPath: encryptedPath,
      outputPath: restoredPath,
      privateKeyPem: pair.privateKey,
      passphrase
    })
  )
  await assert.rejects(fs.stat(restoredPath), { code: 'ENOENT' })
})

test('tampered authenticated backup header also fails closed', async (context) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'tsa-backup-header-'))
  context.after(() => fs.rm(directory, { recursive: true, force: true }))
  const inputPath = path.join(directory, 'database.tar.gz')
  const encryptedPath = path.join(directory, 'database.tbbackup')
  const restoredPath = path.join(directory, 'restored.tar.gz')
  await fs.writeFile(inputPath, Buffer.alloc(16 * 1024, 0x42))
  const passphrase = 'header authentication test password'
  const pair = generateBackupKeyPair(passphrase)
  await encryptBackupFile({ inputPath, outputPath: encryptedPath, publicKeyPem: pair.publicKey })

  const encrypted = await fs.readFile(encryptedPath)
  const headerName = Buffer.from('database.tar.gz')
  const headerNameOffset = encrypted.indexOf(headerName)
  assert.ok(headerNameOffset > 0)
  encrypted[headerNameOffset] ^= 0x01
  await fs.writeFile(encryptedPath, encrypted)

  await assert.rejects(
    decryptBackupFile({
      inputPath: encryptedPath,
      outputPath: restoredPath,
      privateKeyPem: pair.privateKey,
      passphrase
    })
  )
  await assert.rejects(fs.stat(restoredPath), { code: 'ENOENT' })
})

test('retention keeps recent daily files, one older file per week, and trashes expired files', () => {
  const now = new Date('2026-08-06T12:00:00Z')
  const files = [
    { id: 'recent-1', createdTime: '2026-08-06T01:00:00Z' },
    { id: 'recent-2', createdTime: '2026-07-24T01:00:00Z' },
    { id: 'week-newest', createdTime: '2026-07-20T02:00:00Z' },
    { id: 'week-duplicate', createdTime: '2026-07-20T01:00:00Z' },
    { id: 'older-week', createdTime: '2026-06-15T01:00:00Z' },
    { id: 'expired', createdTime: '2026-04-01T01:00:00Z' },
    { id: 'invalid-date', createdTime: 'not-a-date' }
  ]
  const result = selectBackupRetention(files, {
    now,
    dailyRetentionDays: 14,
    weeklyRetentionDays: 90
  })
  assert.deepEqual(result.keep.map((file) => file.id).sort(), [
    'invalid-date',
    'older-week',
    'recent-1',
    'recent-2',
    'week-newest'
  ])
  assert.deepEqual(result.trash.map((file) => file.id).sort(), ['expired', 'week-duplicate'])
})

test('workflow uploads only encrypted backup material and scopes credentials by step', async () => {
  const workflowPath = path.resolve('.github/workflows/supabase-backup.yml')
  const workflow = await fs.readFile(workflowPath, 'utf8')

  assert.match(workflow, /node scripts\/backup-crypto\.mjs encrypt/)
  assert.match(workflow, /path: \$\{\{ steps\.dump\.outputs\.encrypted_path \}\}/)
  assert.match(
    workflow,
    /GOOGLE_DRIVE_REFRESH_TOKEN: \$\{\{ secrets\.GOOGLE_DRIVE_REFRESH_TOKEN \}\}/
  )
  assert.doesNotMatch(workflow, /service[_-]?account/i)

  const jobEnvironment = workflow.slice(workflow.indexOf('    env:'), workflow.indexOf('    steps:'))
  assert.doesNotMatch(
    jobEnvironment,
    /SUPABASE_DB_URL|GOOGLE_DRIVE_CLIENT_SECRET|GOOGLE_DRIVE_REFRESH_TOKEN/
  )

  const encryptionPosition = workflow.indexOf('node scripts/backup-crypto.mjs encrypt')
  const artifactPosition = workflow.indexOf('uses: actions/upload-artifact@')
  assert.ok(encryptionPosition > -1 && artifactPosition > encryptionPosition)
})
