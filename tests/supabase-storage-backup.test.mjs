import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { decryptBackupFile, generateBackupKeyPair } from '../scripts/backup-crypto.mjs'
import {
  DEFAULT_PREFIX,
  S3Client,
  applyStorageRetention,
  backupSupabaseStorage,
  canonicalJson,
  parseObjectsXml,
} from '../scripts/supabase-storage-backup.mjs'

class MemoryDestination {
  constructor() {
    this.objects = new Map()
    this.deletes = []
  }

  async listObjects(bucket, prefix = '') {
    return [...this.objects.entries()]
      .filter(([key]) => key.startsWith(prefix))
      .map(([key, value]) => ({ key, size: value.body.length, eTag: value.eTag || '"memory"', lastModified: value.lastModified || '2026-08-27T00:00:00Z' }))
      .sort((left, right) => left.key.localeCompare(right.key))
  }

  async headObject(bucket, key) {
    const value = this.objects.get(key)
    if (!value) throw new Error(`missing: ${key}`)
    return { size: value.body.length, metadata: value.metadata || {}, eTag: value.eTag || '"memory"' }
  }

  async hashObject(bucket, key) {
    const value = this.objects.get(key)
    if (!value) throw new Error(`missing: ${key}`)
    return {
      size: value.body.length,
      sha256: createHash('sha256').update(value.body).digest('hex'),
    }
  }

  async putFile(bucket, key, filePath, details) {
    this.objects.set(key, { body: await fs.readFile(filePath), metadata: { 'tsa-sha256': details.sha256 } })
    return details
  }

  async putJson(bucket, key, value) {
    const body = Buffer.from(`${canonicalJson(value)}\n`)
    const checksum = createHash('sha256').update(body).digest('hex')
    this.objects.set(key, { body, json: structuredClone(value), metadata: { 'tsa-sha256': checksum } })
    return { size: body.length, sha256: checksum }
  }

  async getJson(bucket, key) {
    const value = this.objects.get(key)
    if (!value) throw new Error(`missing: ${key}`)
    if (value.invalidJson) throw new Error('Storage backup index contains malformed JSON.')
    return value.json ? structuredClone(value.json) : JSON.parse(value.body.toString('utf8'))
  }

  async deleteObject(bucket, object) {
    this.deletes.push(object.key)
    this.objects.delete(object.key)
  }

  addVerified(key, size, checksum, extras = {}) {
    this.objects.set(key, { body: Buffer.alloc(size), metadata: { 'tsa-sha256': checksum }, ...extras })
  }

  addIndex(key, json) {
    const body = Buffer.from(`${canonicalJson(json)}\n`)
    this.objects.set(key, { body, json, metadata: { 'tsa-sha256': createHash('sha256').update(body).digest('hex') } })
  }
}

class MemorySource {
  constructor() {
    this.downloads = 0
    this.listCalls = 0
    this.object = {
      key: 'cashups/private/jane@example.com/proof.pdf',
      bytes: Buffer.from('synthetic private cash-up proof'),
      eTag: '"source-etag"',
      lastModified: '2026-08-27T08:00:00Z',
    }
  }

  async listBuckets() {
    return [{ name: 'private-cashup-proofs', creationDate: '2026-08-20T00:00:00Z' }]
  }

  async getBucketLocation() { return 'af-south-1' }

  async listObjects() {
    this.listCalls += 1
    return [{ key: this.object.key, size: this.object.bytes.length, eTag: this.object.eTag, lastModified: this.object.lastModified, storageClass: 'STANDARD' }]
  }

  async headObject() {
    return {
      size: this.object.bytes.length,
      eTag: this.object.eTag,
      lastModified: this.object.lastModified,
      contentType: 'application/pdf',
      cacheControl: 'private, max-age=0',
      metadata: { lodge: 'private-lodge-metadata' },
    }
  }

  async downloadObject(bucket, key, outputPath) {
    this.downloads += 1
    await fs.writeFile(outputPath, this.object.bytes, { flag: 'wx' })
    return { size: this.object.bytes.length, sha256: createHash('sha256').update(this.object.bytes).digest('hex') }
  }
}

function clock(values) {
  let index = 0
  return () => new Date(values[Math.min(index++, values.length - 1)])
}

function checksum(character) { return character.repeat(64) }

function indexFixture({ snapshotId, createdAt, manifestKey, objects }) {
  return {
    formatVersion: 1,
    kind: 'tsa-bonno-supabase-storage-index',
    complete: true,
    snapshotId,
    createdAt,
    certifiedInventorySha256: checksum('f'),
    certification: {
      certified: true,
      nonAtomic: true,
      initialEnumerationStartedAt: createdAt,
      initialEnumerationCompletedAt: createdAt,
      finalEnumerationStartedAt: createdAt,
      finalEnumerationCompletedAt: createdAt,
    },
    bucketCount: 1,
    objectCount: objects.length,
    manifest: { key: manifestKey, size: 4, sha256: checksum('d') },
    objects,
  }
}

function objectFixture({ source = 'a', plaintext = 'b' } = {}) {
  return {
    sourceFingerprint: checksum(source),
    blobKey: `${DEFAULT_PREFIX}blobs/${checksum(plaintext)}.tbbackup`,
    plaintextSize: 3,
    plaintextSha256: checksum(plaintext),
    encryptedSize: 5,
    encryptedSha256: checksum('e'),
  }
}

test('S3 object parser preserves continuation information and object metadata', () => {
  const parsed = parseObjectsXml(`<?xml version="1.0"?><ListBucketResult>
    <IsTruncated>true</IsTruncated><NextContinuationToken>next&amp;token</NextContinuationToken>
    <Contents><Key>private/a&amp;b.pdf</Key><LastModified>2026-08-27T00:00:00Z</LastModified><ETag>&quot;etag&quot;</ETag><Size>42</Size><StorageClass>STANDARD</StorageClass></Contents>
  </ListBucketResult>`)
  assert.equal(parsed.truncated, true)
  assert.equal(parsed.nextToken, 'next&token')
  assert.deepEqual(parsed.objects[0], {
    key: 'private/a&b.pdf', size: 42, eTag: '"etag"', lastModified: '2026-08-27T00:00:00Z', storageClass: 'STANDARD',
  })
})

test('S3 client follows ListObjectsV2 continuation tokens', async (context) => {
  const originalFetch = global.fetch
  const urls = []
  context.after(() => { global.fetch = originalFetch })
  global.fetch = async (url) => {
    urls.push(String(url))
    const second = String(url).includes('continuation-token=page-2')
    const body = second
      ? '<ListBucketResult><IsTruncated>false</IsTruncated><Contents><Key>two</Key><Size>2</Size><ETag>e2</ETag><LastModified>2026-08-27T00:00:01Z</LastModified></Contents></ListBucketResult>'
      : '<ListBucketResult><IsTruncated>true</IsTruncated><NextContinuationToken>page-2</NextContinuationToken><Contents><Key>one</Key><Size>1</Size><ETag>e1</ETag><LastModified>2026-08-27T00:00:00Z</LastModified></Contents></ListBucketResult>'
    return new Response(body, { status: 200 })
  }
  const client = new S3Client({ endpoint: 'https://project.storage.supabase.co/storage/v1/s3', region: 'local', accessKeyId: 'access', secretAccessKey: 'secret' })
  const objects = await client.listObjects('private-bucket')
  assert.deepEqual(objects.map((object) => object.key), ['one', 'two'])
  assert.equal(urls.length, 2)
  assert.match(urls[0], /max-keys=1000/)
  assert.match(urls[1], /continuation-token=page-2/)
  assert.ok(urls.every((url) => url.includes('/storage/v1/s3/private-bucket')))
})

test('S3 signing path preserves empty and trailing object-key segments', async (context) => {
  const originalFetch = global.fetch
  let requestedUrl = ''
  context.after(() => { global.fetch = originalFetch })
  global.fetch = async (url) => {
    requestedUrl = String(url)
    return new Response(null, { status: 200, headers: { 'content-length': '1', etag: '"e"' } })
  }
  const client = new S3Client({ endpoint: 'https://project.storage.supabase.co/storage/v1/s3', region: 'local', accessKeyId: 'access', secretAccessKey: 'secret' })
  await client.headObject('private-bucket', 'folder//nested/')
  assert.match(requestedUrl, /\/private-bucket\/folder\/\/nested\/$/)
})

test('S3 failures do not echo private object paths from provider error bodies', async (context) => {
  const originalFetch = global.fetch
  context.after(() => { global.fetch = originalFetch })
  global.fetch = async () => new Response('<Error><Code>NoSuchKey</Code><Key>jane@example.com/private-proof.pdf</Key></Error>', { status: 404 })
  const client = new S3Client({ endpoint: 'https://project.storage.supabase.co/storage/v1/s3', region: 'local', accessKeyId: 'access', secretAccessKey: 'secret' })
  await assert.rejects(client.headObject('private-bucket', 'jane@example.com/private-proof.pdf'), (error) => {
    assert.match(error.message, /404, NoSuchKey/)
    assert.doesNotMatch(error.message, /jane@example|private-proof/)
    return true
  })
})

test('certified backup encrypts private paths and reuses an unchanged verified blob', async (context) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'storage-backup-test-'))
  context.after(() => fs.rm(directory, { recursive: true, force: true }))
  const pair = generateBackupKeyPair('storage backup test passphrase')
  const source = new MemorySource()
  const destination = new MemoryDestination()
  const first = await backupSupabaseStorage({
    source, destination, destinationBucket: 'backup-bucket', publicKeyPem: pair.publicKey,
    tempDirectory: path.join(directory, 'first'), runId: '100',
    clock: clock(['2026-08-27T10:00:00Z', '2026-08-27T10:01:00Z', '2026-08-27T10:02:00Z', '2026-08-27T10:03:00Z', '2026-08-27T10:04:00Z']),
  })
  assert.equal(first.bucketCount, 1)
  assert.equal(first.objectCount, 1)
  assert.equal(source.downloads, 1)
  const index = await destination.getJson('backup-bucket', first.indexKey)
  const publicText = JSON.stringify(index)
  assert.doesNotMatch(publicText, /jane@example|private-cashup-proofs|cashups\/private|private-lodge-metadata/)
  assert.match(index.objects[0].blobKey, /\/blobs\/[a-f0-9]{64}\.tbbackup$/)

  const encryptedManifest = destination.objects.get(first.manifestKey).body
  const encryptedPath = path.join(directory, 'manifest.tbbackup')
  const restoredPath = path.join(directory, 'manifest.json')
  await fs.writeFile(encryptedPath, encryptedManifest)
  await decryptBackupFile({ inputPath: encryptedPath, outputPath: restoredPath, privateKeyPem: pair.privateKey, passphrase: 'storage backup test passphrase' })
  const manifest = JSON.parse(await fs.readFile(restoredPath, 'utf8'))
  assert.equal(manifest.certification.certified, true)
  assert.equal(manifest.certification.nonAtomic, true)
  assert.equal(manifest.objects[0].key, source.object.key)
  assert.equal(manifest.objects[0].head.metadata.lodge, 'private-lodge-metadata')

  await backupSupabaseStorage({
    source, destination, destinationBucket: 'backup-bucket', publicKeyPem: pair.publicKey,
    tempDirectory: path.join(directory, 'second'), runId: '101',
    clock: clock(['2026-08-28T10:00:00Z', '2026-08-28T10:01:00Z', '2026-08-28T10:02:00Z', '2026-08-28T10:03:00Z', '2026-08-28T10:04:00Z']),
  })
  assert.equal(source.downloads, 1, 'unchanged verified bytes should not be downloaded twice')
})

test('R2 verification hashes encrypted bytes when HEAD omits custom metadata', async (context) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'storage-backup-head-metadata-'))
  context.after(() => fs.rm(directory, { recursive: true, force: true }))
  const pair = generateBackupKeyPair('storage metadata fallback passphrase')
  const source = new MemorySource()
  const destination = new MemoryDestination()
  const originalHead = destination.headObject.bind(destination)
  let contentVerifications = 0
  destination.headObject = async (...args) => ({ ...await originalHead(...args), metadata: {} })
  const originalHash = destination.hashObject.bind(destination)
  destination.hashObject = async (...args) => {
    contentVerifications += 1
    return originalHash(...args)
  }

  const result = await backupSupabaseStorage({
    source, destination, destinationBucket: 'backup-bucket', publicKeyPem: pair.publicKey,
    tempDirectory: path.join(directory, 'work'), runId: 'metadata-fallback',
    clock: clock(['2026-08-27T12:00:00Z', '2026-08-27T12:01:00Z', '2026-08-27T12:02:00Z', '2026-08-27T12:03:00Z', '2026-08-27T12:04:00Z']),
  })

  assert.equal(result.objectCount, 1)
  assert.ok(contentVerifications >= 3, 'blob, manifest, and public index bytes should be verified')
})

test('zero-byte S3 objects remain recoverable', async (context) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'storage-backup-empty-'))
  context.after(() => fs.rm(directory, { recursive: true, force: true }))
  const pair = generateBackupKeyPair('storage empty object passphrase')
  const source = new MemorySource()
  source.object.bytes = Buffer.alloc(0)
  source.object.key = 'private/empty-marker'
  const destination = new MemoryDestination()
  const result = await backupSupabaseStorage({
    source, destination, destinationBucket: 'backup-bucket', publicKeyPem: pair.publicKey,
    tempDirectory: path.join(directory, 'work'), runId: 'empty',
    clock: clock(['2026-08-27T11:00:00Z', '2026-08-27T11:01:00Z', '2026-08-27T11:02:00Z', '2026-08-27T11:03:00Z', '2026-08-27T11:04:00Z']),
  })
  const index = await destination.getJson('backup-bucket', result.indexKey)
  assert.equal(index.objects[0].plaintextSize, 0)
  const encryptedPath = path.join(directory, 'empty.tbbackup')
  const restoredPath = path.join(directory, 'empty.bin')
  await fs.writeFile(encryptedPath, destination.objects.get(index.objects[0].blobKey).body)
  await decryptBackupFile({ inputPath: encryptedPath, outputPath: restoredPath, privateKeyPem: pair.privateKey, passphrase: 'storage empty object passphrase' })
  assert.equal((await fs.stat(restoredPath)).size, 0)
})

test('source mutation during backup leaves no certifying index or manifest', async (context) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'storage-backup-race-'))
  context.after(() => fs.rm(directory, { recursive: true, force: true }))
  const pair = generateBackupKeyPair('storage race test passphrase')
  const source = new MemorySource()
  const originalList = source.listObjects.bind(source)
  source.listObjects = async (...args) => {
    const result = await originalList(...args)
    if (source.listCalls >= 2) result[0].lastModified = '2026-08-27T10:30:00Z'
    return result
  }
  const destination = new MemoryDestination()
  await assert.rejects(
    backupSupabaseStorage({
      source, destination, destinationBucket: 'backup-bucket', publicKeyPem: pair.publicKey,
      tempDirectory: path.join(directory, 'work'), runId: 'race',
      clock: clock(['2026-08-27T10:00:00Z', '2026-08-27T10:01:00Z', '2026-08-27T10:02:00Z', '2026-08-27T10:03:00Z']),
    }),
    /changed during backup/,
  )
  assert.equal((await destination.listObjects('backup-bucket', `${DEFAULT_PREFIX}indexes/`)).length, 0)
  assert.equal((await destination.listObjects('backup-bucket', `${DEFAULT_PREFIX}manifests/`)).length, 0)
})

test('retention verifies retained references and deletes only unreferenced blobs', async () => {
  const destination = new MemoryDestination()
  const shared = objectFixture({ source: 'a', plaintext: 'b' })
  const oldOnly = objectFixture({ source: 'c', plaintext: 'd' })
  const recentManifest = `${DEFAULT_PREFIX}manifests/2026-08-27T00-00-00Z-recent.tbbackup`
  const oldManifest = `${DEFAULT_PREFIX}manifests/2026-01-01T00-00-00Z-old.tbbackup`
  const recentIndexKey = `${DEFAULT_PREFIX}indexes/2026-08-27T00-00-00Z-recent.json`
  const oldIndexKey = `${DEFAULT_PREFIX}indexes/2026-01-01T00-00-00Z-old.json`
  destination.addVerified(recentManifest, 4, checksum('d'))
  destination.addVerified(oldManifest, 4, checksum('d'))
  destination.addVerified(shared.blobKey, shared.encryptedSize, shared.encryptedSha256)
  destination.addVerified(oldOnly.blobKey, oldOnly.encryptedSize, oldOnly.encryptedSha256)
  destination.addIndex(recentIndexKey, indexFixture({ snapshotId: '2026-08-27T00-00-00Z-recent', createdAt: '2026-08-27T00:00:00Z', manifestKey: recentManifest, objects: [shared] }))
  destination.addIndex(oldIndexKey, indexFixture({ snapshotId: '2026-01-01T00-00-00Z-old', createdAt: '2026-01-01T00:00:00Z', manifestKey: oldManifest, objects: [oldOnly] }))

  const result = await applyStorageRetention({ destination, bucket: 'backup-bucket', now: new Date('2026-08-27T12:00:00Z'), dailyDays: 14, weeklyDays: 90 })
  assert.equal(result.deletedSnapshots, 1)
  assert.equal(result.deletedBlobs, 1)
  assert.ok(destination.objects.has(shared.blobKey))
  assert.ok(!destination.objects.has(oldOnly.blobKey))
})

test('retention fails closed without deleting when an index is malformed or a manifest is missing', async () => {
  const destination = new MemoryDestination()
  const blob = objectFixture()
  destination.addVerified(blob.blobKey, blob.encryptedSize, blob.encryptedSha256)
  const badIndex = `${DEFAULT_PREFIX}indexes/2026-08-27T00-00-00Z-bad.json`
  destination.objects.set(badIndex, { body: Buffer.from('{'), invalidJson: true })
  await assert.rejects(applyStorageRetention({ destination, bucket: 'backup-bucket' }), /malformed JSON/)
  assert.deepEqual(destination.deletes, [])

  destination.objects.clear()
  destination.deletes.length = 0
  const manifestKey = `${DEFAULT_PREFIX}manifests/2026-08-27T00-00-00Z-bad.tbbackup`
  destination.addIndex(badIndex, indexFixture({ snapshotId: '2026-08-27T00-00-00Z-bad', createdAt: '2026-08-27T00:00:00Z', manifestKey, objects: [blob] }))
  await assert.rejects(applyStorageRetention({ destination, bucket: 'backup-bucket' }), /missing manifest/)
  assert.deepEqual(destination.deletes, [])

  destination.objects.clear()
  destination.deletes.length = 0
  destination.addVerified(manifestKey, 4, checksum('d'))
  destination.addIndex(badIndex, indexFixture({ snapshotId: '2026-08-27T00-00-00Z-bad', createdAt: '2026-08-27T00:00:00Z', manifestKey, objects: [blob] }))
  await assert.rejects(applyStorageRetention({ destination, bucket: 'backup-bucket' }), /missing:/)
  assert.deepEqual(destination.deletes, [])
})

test('workflow scopes Supabase Storage S3 credentials to the certifying Storage step', async () => {
  const workflow = await fs.readFile(path.resolve('.github/workflows/supabase-backup.yml'), 'utf8')
  const storageStart = workflow.indexOf('      - name: Back up and certify encrypted Supabase Storage')
  const storageEnd = workflow.indexOf('      - name: Write backup failure summary')
  assert.ok(storageStart > 0 && storageEnd > storageStart)
  const storageStep = workflow.slice(storageStart, storageEnd)
  for (const name of ['SUPABASE_STORAGE_S3_ENDPOINT', 'SUPABASE_STORAGE_S3_REGION', 'SUPABASE_STORAGE_S3_ACCESS_KEY_ID', 'SUPABASE_STORAGE_S3_SECRET_ACCESS_KEY']) {
    assert.equal(workflow.match(new RegExp(`${name}: \\$\\{\\{ secrets\\.${name} \\}\\}`, 'g'))?.length, 1)
    assert.match(storageStep, new RegExp(`\\b${name}\\b`))
  }
  assert.match(storageStep, /node scripts\/supabase-storage-backup\.mjs/)
  assert.doesNotMatch(workflow, /SUPABASE_(SERVICE_ROLE|SERVICE_KEY)|service[_-]?role/i)
  assert.match(workflow, /STORAGE_BACKUP_OUTCOME: \$\{\{ steps\.storage_backup\.outcome \}\}/)
  assert.match(workflow, /require_success 'storage-backup'/)
})
