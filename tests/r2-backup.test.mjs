import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  DEFAULT_PREFIX,
  canonicalQuery,
  deleteR2Object,
  isManagedBackupObject,
  parseListObjectsXml,
  selectBackupRetention,
  uploadEncryptedBackup
} from '../scripts/r2-backup.mjs'

const backupKey = (stamp, runId) => `${DEFAULT_PREFIX}tsa-bonno-supabase-${stamp}-${runId}.tar.gz.tbbackup`

test('R2 object discovery accepts only names from the managed encrypted-backup namespace', () => {
  assert.equal(isManagedBackupObject({ key: backupKey('2026-08-27T00-00-00Z', 123) }), true)
  const recoveryPrefix = 'tsa-bonno/supabase/whole-project/'
  assert.equal(isManagedBackupObject({ key: `${recoveryPrefix}tsa-bonno-supabase-whole-project-2026-08-27T00-00-00Z-123.tar.gz.tbbackup` }, recoveryPrefix), true)
  assert.equal(isManagedBackupObject({ key: `${DEFAULT_PREFIX}tsa-bonno-supabase-whole-project-2026-08-27T00-00-00Z-123.tar.gz.tbbackup` }), false)
  assert.equal(isManagedBackupObject({ key: `${DEFAULT_PREFIX}other-file.tbbackup` }), false)
  assert.equal(isManagedBackupObject({ key: `other-prefix/tsa-bonno-supabase-2026-08-27T00-00-00Z-123.tar.gz.tbbackup` }), false)
  assert.equal(isManagedBackupObject({ key: `${DEFAULT_PREFIX}tsa-bonno-supabase-2026-08-27T00-00-00Z-123.tar.gz` }), false)
})

test('R2 retention never deletes the sole positively identified successful backup', () => {
  const result = selectBackupRetention([
    { key: backupKey('2026-01-01T00-00-00Z', 1), lastModified: '2026-01-01T00:00:00Z' }
  ], {
    now: new Date('2026-08-27T00:00:00Z'),
    dailyRetentionDays: 14,
    weeklyRetentionDays: 90
  })
  assert.equal(result.keep.length, 1)
  assert.equal(result.trash.length, 0)
})

test('R2 retention applies the configured whole-project namespace', () => {
  const prefix = 'tsa-bonno/supabase/whole-project/'
  const result = selectBackupRetention([
    { key: `${prefix}tsa-bonno-supabase-whole-project-2026-01-01T00-00-00Z-1.tar.gz.tbbackup`, lastModified: '2026-01-01T00:00:00Z' }
  ], {
    now: new Date('2026-08-27T00:00:00Z'),
    dailyRetentionDays: 14,
    weeklyRetentionDays: 90,
    prefix
  })
  assert.equal(result.keep.length, 1, 'the configured namespace must retain the sole recovery backup')
  assert.equal(result.trash.length, 0)
})

test('R2 list parsing ignores lookalike objects even when they share the listing prefix', () => {
  const parsed = parseListObjectsXml(`
    <ListBucketResult>
      <Contents><Key>${backupKey('2026-08-27T00-00-00Z', 123)}</Key><LastModified>2026-08-27T00:00:00Z</LastModified><Size>42</Size><ETag>&quot;etag&quot;</ETag></Contents>
      <Contents><Key>${DEFAULT_PREFIX}not-a-managed-backup.txt</Key><LastModified>2026-08-27T00:00:00Z</LastModified><Size>1</Size></Contents>
      <IsTruncated>false</IsTruncated>
    </ListBucketResult>
  `, DEFAULT_PREFIX)
  assert.equal(parsed.truncated, false)
  assert.deepEqual(parsed.objects, [{
    key: backupKey('2026-08-27T00-00-00Z', 123),
    size: 42,
    lastModified: '2026-08-27T00:00:00Z',
    createdTime: '2026-08-27T00:00:00Z',
    etag: '"etag"'
  }])
})

test('R2 upload uses a SigV4-signed S3-compatible PUT and never sends plaintext backup content', async (context) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'tsa-r2-backup-'))
  context.after(() => fs.rm(directory, { recursive: true, force: true }))
  const filePath = path.join(directory, 'tsa-bonno-supabase-2026-08-27T00-00-00Z-123.tar.gz.tbbackup')
  await fs.writeFile(filePath, Buffer.from('encrypted backup bytes'))

  const previousFetch = global.fetch
  context.after(() => { global.fetch = previousFetch })
  global.fetch = async (url, request) => {
    assert.match(String(url), /r2\.cloudflarestorage\.com\/backup-bucket\/tsa-bonno\/supabase\/tsa-bonno-supabase-2026-08-27T00-00-00Z-123\.tar\.gz\.tbbackup/)
    assert.equal(request.method, 'PUT')
    assert.match(request.headers.authorization, /^AWS4-HMAC-SHA256 Credential=access-key\//)
    assert.match(request.headers.authorization, /SignedHeaders=/)
    assert.match(request.headers['x-amz-content-sha256'], /^[0-9a-f]{64}$/)
    assert.equal(request.headers['content-type'], 'application/octet-stream')
    return new Response('', { status: 200 })
  }

  const result = await uploadEncryptedBackup({
    accountId: 'abc123',
    bucket: 'backup-bucket',
    accessKeyId: 'access-key',
    secretAccessKey: 'secret-key',
    filePath
  })
  assert.equal(result.key, `${DEFAULT_PREFIX}tsa-bonno-supabase-2026-08-27T00-00-00Z-123.tar.gz.tbbackup`)
  assert.equal(result.size, 22)
  assert.match(result.sha256, /^[0-9a-f]{64}$/)
})

test('R2 canonical query encoding is deterministic for SigV4', () => {
  assert.equal(canonicalQuery({ prefix: 'tsa-bonno/supabase/', 'list-type': '2', 'max-keys': '1000' }), 'list-type=2&max-keys=1000&prefix=tsa-bonno%2Fsupabase%2F')
})

test('R2 deletion refuses an unmanaged key before making a request', async () => {
  await assert.rejects(deleteR2Object({
    accountId: 'abc123',
    bucket: 'backup-bucket',
    accessKeyId: 'access-key',
    secretAccessKey: 'secret-key',
    object: { key: `${DEFAULT_PREFIX}not-managed.txt` }
  }), /unmanaged R2 object/i)
})
