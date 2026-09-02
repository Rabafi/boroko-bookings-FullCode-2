import { createHash, createHmac } from 'node:crypto'
import { createReadStream, createWriteStream, promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { pathToFileURL } from 'node:url'
import { encryptBackupFile } from './backup-crypto.mjs'

const SERVICE = 's3'
const DEFAULT_PREFIX = 'tsa-bonno/supabase/storage/v1/'
const MAX_LIST_PAGES = 10_000
const MAX_INDEX_BYTES = 16 * 1024 * 1024
const FORMAT_VERSION = 1

function required(value, label) {
  if (!value) throw new Error(`${label} is required.`)
  return String(value)
}

function normalizePrefix(value = DEFAULT_PREFIX) {
  const prefix = String(value || '').replaceAll('\\', '/')
  if (!prefix || prefix.startsWith('/') || prefix.includes('\0') || prefix.split('/').some((part) => part === '..')) {
    throw new Error('Storage backup prefix is invalid.')
  }
  return prefix.endsWith('/') ? prefix : `${prefix}/`
}

function encodeRfc3986(value) {
  return encodeURIComponent(String(value)).replace(/[!'()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`)
}

function canonicalQuery(query = {}) {
  return Object.entries(query)
    .filter(([, value]) => value !== undefined && value !== null)
    .flatMap(([name, value]) => Array.isArray(value) ? value.map((item) => [name, item]) : [[name, value]])
    .sort(([leftName, leftValue], [rightName, rightValue]) => {
      const left = `${encodeRfc3986(leftName)}=${encodeRfc3986(leftValue)}`
      const right = `${encodeRfc3986(rightName)}=${encodeRfc3986(rightValue)}`
      return left < right ? -1 : left > right ? 1 : 0
    })
    .map(([name, value]) => `${encodeRfc3986(name)}=${encodeRfc3986(value)}`)
    .join('&')
}

function canonicalPath(endpoint, bucket = '', key = '') {
  const base = endpoint.pathname.split('/').filter(Boolean).map(encodeRfc3986)
  const suffix = []
  if (bucket) suffix.push(encodeRfc3986(bucket))
  if (key !== '') suffix.push(...String(key).split('/').map(encodeRfc3986))
  return `/${[...base, ...suffix].join('/')}`
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

function hmac(key, value) {
  return createHmac('sha256', key).update(value).digest()
}

function signingKey(secret, dateStamp, region) {
  return hmac(hmac(hmac(hmac(`AWS4${secret}`, dateStamp), region), SERVICE), 'aws4_request')
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

function redact(value, secrets = []) {
  let output = String(value || '')
  for (const secret of secrets) if (secret) output = output.replaceAll(String(secret), '[redacted]')
  return output.slice(0, 500)
}

function xmlUnescape(value) {
  return String(value || '').replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&quot;', '"').replaceAll('&apos;', "'").replaceAll('&amp;', '&')
}

function xmlTag(fragment, name) {
  const match = String(fragment).match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`))
  return match ? xmlUnescape(match[1]) : ''
}

export function parseBucketsXml(xml) {
  if (!/<ListAllMyBucketsResult(?:\s[^>]*)?>/.test(String(xml)) && !/<Buckets(?:\s[^>]*)?>/.test(String(xml))) {
    throw new Error('Supabase Storage bucket listing returned malformed XML.')
  }
  return [...String(xml).matchAll(/<Bucket(?:\s[^>]*)?>([\s\S]*?)<\/Bucket>/g)]
    .map((match) => ({ name: xmlTag(match[1], 'Name'), creationDate: xmlTag(match[1], 'CreationDate') }))
    .filter((bucket) => bucket.name)
}

export function parseObjectsXml(xml) {
  if (!/<ListBucketResult(?:\s[^>]*)?>/.test(String(xml)) || !/<IsTruncated(?:\s[^>]*)?>/.test(String(xml))) {
    throw new Error('S3 object listing returned malformed XML.')
  }
  const objects = [...String(xml).matchAll(/<Contents(?:\s[^>]*)?>([\s\S]*?)<\/Contents>/g)].map((match) => {
    const size = Number(xmlTag(match[1], 'Size'))
    if (!Number.isSafeInteger(size) || size < 0) throw new Error('S3 object listing contained an invalid size.')
    const key = xmlTag(match[1], 'Key')
    if (!key) throw new Error('S3 object listing contained an empty key.')
    return {
      key,
      size,
      eTag: xmlTag(match[1], 'ETag'),
      lastModified: xmlTag(match[1], 'LastModified'),
      storageClass: xmlTag(match[1], 'StorageClass') || null,
    }
  })
  const truncated = xmlTag(xml, 'IsTruncated').toLowerCase() === 'true'
  const nextToken = xmlTag(xml, 'NextContinuationToken')
  if (truncated && !nextToken) throw new Error('S3 listing was truncated without a continuation token.')
  return { objects, truncated, nextToken }
}

function headerMetadata(headers) {
  const metadata = {}
  for (const [name, value] of headers.entries()) {
    if (name.toLowerCase().startsWith('x-amz-meta-')) metadata[name.toLowerCase().slice(11)] = value
  }
  return Object.fromEntries(Object.entries(metadata).sort(([left], [right]) => left.localeCompare(right)))
}

function parseLength(value, label) {
  const size = Number(value)
  if (!Number.isSafeInteger(size) || size < 0) throw new Error(`${label} returned an invalid content length.`)
  return size
}

export class S3Client {
  constructor({ endpoint, region, accessKeyId, secretAccessKey, label = 'S3' }) {
    this.endpoint = new URL(required(endpoint, `${label} endpoint`))
    if (this.endpoint.protocol !== 'https:') throw new Error(`${label} endpoint must use HTTPS.`)
    this.region = required(region, `${label} region`)
    this.accessKeyId = required(accessKeyId, `${label} access key ID`)
    this.secretAccessKey = required(secretAccessKey, `${label} secret access key`)
    this.label = label
  }

  async request({ method, bucket = '', key = '', query, headers = {}, body, payloadHash, operation = method }) {
    const pathName = canonicalPath(this.endpoint, bucket, key)
    const queryString = canonicalQuery(query)
    const amzDate = new Date().toISOString().replaceAll(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')
    const dateStamp = amzDate.slice(0, 8)
    const bodyHash = payloadHash || sha256('')
    const canonicalHeaders = {
      host: this.endpoint.host,
      'x-amz-content-sha256': bodyHash,
      'x-amz-date': amzDate,
      ...Object.fromEntries(Object.entries(headers).map(([name, value]) => [name.toLowerCase(), String(value).trim()])),
    }
    const signedNames = Object.keys(canonicalHeaders).sort()
    const headerText = signedNames.map((name) => `${name}:${canonicalHeaders[name]}\n`).join('')
    const canonicalRequest = [method.toUpperCase(), pathName, queryString, headerText, signedNames.join(';'), bodyHash].join('\n')
    const scope = `${dateStamp}/${this.region}/${SERVICE}/aws4_request`
    const stringToSign = `AWS4-HMAC-SHA256\n${amzDate}\n${scope}\n${sha256(canonicalRequest)}`
    const signature = createHmac('sha256', signingKey(this.secretAccessKey, dateStamp, this.region)).update(stringToSign).digest('hex')
    const request = {
      method: method.toUpperCase(),
      headers: {
        ...canonicalHeaders,
        authorization: `AWS4-HMAC-SHA256 Credential=${this.accessKeyId}/${scope}, SignedHeaders=${signedNames.join(';')}, Signature=${signature}`,
      },
      body,
    }
    if (body && typeof body.pipe === 'function') request.duplex = 'half'
    const url = new URL(`${pathName}${queryString ? `?${queryString}` : ''}`, this.endpoint.origin)
    const response = await fetch(url, request)
    if (!response.ok) {
      const responseBody = await response.text().catch(() => '')
      const errorCode = xmlTag(responseBody, 'Code').replace(/[^A-Za-z0-9_.-]/g, '').slice(0, 80)
      throw new Error(`${this.label} ${operation} failed (${response.status}${errorCode ? `, ${errorCode}` : ''}).`)
    }
    return response
  }

  async listBuckets() {
    const response = await this.request({ method: 'GET', operation: 'list buckets' })
    return parseBucketsXml(await response.text())
  }

  async getBucketLocation(bucket) {
    const response = await this.request({ method: 'GET', bucket, query: { location: '' }, operation: 'get bucket location' })
    const body = await response.text()
    return xmlTag(body, 'LocationConstraint') || this.region
  }

  async listObjects(bucket, prefix = '') {
    const objects = []
    let continuationToken = ''
    for (let page = 0; page < MAX_LIST_PAGES; page += 1) {
      const response = await this.request({
        method: 'GET', bucket, operation: 'list objects',
        query: { 'list-type': '2', prefix: prefix || undefined, 'max-keys': '1000', 'continuation-token': continuationToken || undefined },
      })
      const parsed = parseObjectsXml(await response.text())
      objects.push(...parsed.objects)
      if (!parsed.truncated) return objects
      continuationToken = parsed.nextToken
    }
    throw new Error(`S3 listing exceeded the ${MAX_LIST_PAGES}-page safety limit.`)
  }

  async headObject(bucket, key) {
    const response = await this.request({ method: 'HEAD', bucket, key, operation: 'head object' })
    return {
      size: parseLength(response.headers.get('content-length'), this.label),
      eTag: response.headers.get('etag') || '',
      lastModified: response.headers.get('last-modified') || '',
      contentType: response.headers.get('content-type') || null,
      cacheControl: response.headers.get('cache-control') || null,
      contentDisposition: response.headers.get('content-disposition') || null,
      contentEncoding: response.headers.get('content-encoding') || null,
      contentLanguage: response.headers.get('content-language') || null,
      expires: response.headers.get('expires') || null,
      versionId: response.headers.get('x-amz-version-id') || null,
      metadata: headerMetadata(response.headers),
    }
  }

  async downloadObject(bucket, key, outputPath, expectedETag = '') {
    const response = await this.request({
      method: 'GET', bucket, key, operation: 'download object',
      headers: expectedETag ? { 'if-match': expectedETag } : {},
    })
    if (!response.body) throw new Error(`${this.label} download returned no body.`)
    const hash = createHash('sha256')
    let size = 0
    const meter = new Transform({
      transform(chunk, encoding, callback) {
        hash.update(chunk)
        size += chunk.length
        callback(null, chunk)
      },
    })
    await pipeline(Readable.fromWeb(response.body), meter, createWriteStream(outputPath, { flags: 'wx' }))
    return { size, sha256: hash.digest('hex') }
  }

  async hashObject(bucket, key) {
    const response = await this.request({ method: 'GET', bucket, key, operation: 'verify object content' })
    if (!response.body) throw new Error(`${this.label} verification download returned no body.`)
    const hash = createHash('sha256')
    let size = 0
    for await (const chunk of Readable.fromWeb(response.body)) {
      hash.update(chunk)
      size += chunk.length
    }
    return { size, sha256: hash.digest('hex') }
  }

  async putFile(bucket, key, filePath, { sha256: checksum, contentType = 'application/octet-stream' } = {}) {
    const stat = await fs.stat(filePath)
    const payloadHash = checksum || await sha256File(filePath)
    await this.request({
      method: 'PUT', bucket, key, body: createReadStream(filePath), payloadHash, operation: 'upload object',
      headers: { 'content-length': stat.size, 'content-type': contentType, 'x-amz-meta-tsa-sha256': payloadHash },
    })
    return { size: stat.size, sha256: payloadHash }
  }

  async putJson(bucket, key, value) {
    const body = Buffer.from(`${canonicalJson(value)}\n`, 'utf8')
    const payloadHash = sha256(body)
    await this.request({
      method: 'PUT', bucket, key, body, payloadHash, operation: 'upload index',
      headers: { 'content-length': body.length, 'content-type': 'application/json', 'x-amz-meta-tsa-sha256': payloadHash },
    })
    return { size: body.length, sha256: payloadHash }
  }

  async getJson(bucket, key) {
    const response = await this.request({ method: 'GET', bucket, key, operation: 'read index' })
    const length = Number(response.headers.get('content-length') || 0)
    if (length > MAX_INDEX_BYTES) throw new Error('Storage backup index exceeds its size limit.')
    const text = await response.text()
    if (Buffer.byteLength(text) > MAX_INDEX_BYTES) throw new Error('Storage backup index exceeds its size limit.')
    try { return JSON.parse(text) } catch { throw new Error('Storage backup index contains malformed JSON.') }
  }

  async deleteObject(bucket, object) {
    await this.request({
      method: 'DELETE', bucket, key: object.key, operation: 'delete object',
      headers: object.eTag ? { 'if-match': object.eTag } : {},
    })
  }
}

async function sha256File(filePath) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(filePath)) hash.update(chunk)
  return hash.digest('hex')
}

function normalizeHead(head) {
  return {
    size: Number(head.size), eTag: String(head.eTag || ''), lastModified: String(head.lastModified || ''),
    contentType: head.contentType || null, cacheControl: head.cacheControl || null,
    contentDisposition: head.contentDisposition || null, contentEncoding: head.contentEncoding || null,
    contentLanguage: head.contentLanguage || null, expires: head.expires || null,
    versionId: head.versionId || null,
    metadata: Object.fromEntries(Object.entries(head.metadata || {}).sort(([left], [right]) => left.localeCompare(right))),
  }
}

export async function enumerateStorage(source, clock = () => new Date()) {
  const startedAt = clock().toISOString()
  const buckets = []
  for (const listedBucket of (await source.listBuckets()).sort((left, right) => left.name.localeCompare(right.name))) {
    const objects = []
    for (const listedObject of (await source.listObjects(listedBucket.name)).sort((left, right) => left.key.localeCompare(right.key))) {
      const head = normalizeHead(await source.headObject(listedBucket.name, listedObject.key))
      if (head.size !== listedObject.size) throw new Error('Supabase Storage changed while the initial object inventory was being read.')
      objects.push({ key: listedObject.key, listed: listedObject, head })
    }
    buckets.push({ name: listedBucket.name, creationDate: listedBucket.creationDate || null, location: await source.getBucketLocation(listedBucket.name), objects })
  }
  const completedAt = clock().toISOString()
  const fingerprint = sha256(canonicalJson(buckets))
  return { startedAt, completedAt, buckets, fingerprint }
}

function sourceFingerprint(bucket, object) {
  return sha256(canonicalJson({ bucket, key: object.key, listed: object.listed, head: object.head }))
}

function validateOpaqueKey(key, prefix, kind) {
  const escaped = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const patterns = {
    blob: new RegExp(`^${escaped}blobs/[a-f0-9]{64}\\.tbbackup$`),
    manifest: new RegExp(`^${escaped}manifests/[0-9TZ-]+-[A-Za-z0-9_-]+\\.tbbackup$`),
    index: new RegExp(`^${escaped}indexes/[0-9TZ-]+-[A-Za-z0-9_-]+\\.json$`),
  }
  if (!patterns[kind]?.test(String(key))) throw new Error(`Storage backup ${kind} key is not a managed synthetic key.`)
}

export function validatePublicIndex(index, prefix = DEFAULT_PREFIX) {
  const normalizedPrefix = normalizePrefix(prefix)
  if (!index || index.formatVersion !== FORMAT_VERSION || index.kind !== 'tsa-bonno-supabase-storage-index' || index.complete !== true) {
    throw new Error('Storage backup index has an unsupported or incomplete format.')
  }
  if (!/^[0-9TZ-]+-[A-Za-z0-9_-]+$/.test(index.snapshotId || '') || !index.createdAt || !Array.isArray(index.objects) || !index.manifest?.key) throw new Error('Storage backup index is malformed.')
  if (!Number.isSafeInteger(index.bucketCount) || index.bucketCount < 0 || index.objectCount !== index.objects.length || index.certification?.certified !== true || index.certification?.nonAtomic !== true) {
    throw new Error('Storage backup index certification is malformed.')
  }
  const timingFields = ['initialEnumerationStartedAt', 'initialEnumerationCompletedAt', 'finalEnumerationStartedAt', 'finalEnumerationCompletedAt']
  if (!/^[a-f0-9]{64}$/.test(index.certifiedInventorySha256 || '') || !Number.isFinite(Date.parse(index.createdAt)) || timingFields.some((field) => !Number.isFinite(Date.parse(index.certification[field])))) {
    throw new Error('Storage backup index certification is malformed.')
  }
  validateOpaqueKey(index.manifest.key, normalizedPrefix, 'manifest')
  if (index.manifest.key !== `${normalizedPrefix}manifests/${index.snapshotId}.tbbackup`) throw new Error('Storage backup index manifest identity is malformed.')
  const seen = new Set()
  for (const object of index.objects) {
    if (!/^[a-f0-9]{64}$/.test(object?.sourceFingerprint || '') || !/^[a-f0-9]{64}$/.test(object?.plaintextSha256 || '') || !/^[a-f0-9]{64}$/.test(object?.encryptedSha256 || '')) {
      throw new Error('Storage backup index contains an invalid checksum.')
    }
    validateOpaqueKey(object.blobKey, normalizedPrefix, 'blob')
    if (object.blobKey !== `${normalizedPrefix}blobs/${object.plaintextSha256}.tbbackup`) throw new Error('Storage backup index blob identity is malformed.')
    if (!Number.isSafeInteger(object.plaintextSize) || object.plaintextSize < 0 || !Number.isSafeInteger(object.encryptedSize) || object.encryptedSize <= 0) {
      throw new Error('Storage backup index contains an invalid size.')
    }
    if (seen.has(object.sourceFingerprint)) throw new Error('Storage backup index contains a duplicate object reference.')
    seen.add(object.sourceFingerprint)
  }
  if (!/^[a-f0-9]{64}$/.test(index.manifest.sha256 || '') || !Number.isSafeInteger(index.manifest.size) || index.manifest.size <= 0) {
    throw new Error('Storage backup index contains invalid manifest verification data.')
  }
  return index
}

async function verifyDestinationObject(destination, bucket, key, expected) {
  const head = await destination.headObject(bucket, key)
  if (head.size !== expected.size) throw new Error('Cloudflare R2 upload size verification failed.')
  if (head.metadata?.['tsa-sha256'] === expected.sha256) return head

  // Some S3-compatible gateways omit custom metadata from HEAD responses.
  // In that case verify the actual encrypted bytes instead of weakening the
  // certification contract or failing a valid upload on metadata alone.
  const content = await destination.hashObject(bucket, key)
  if (content.size !== expected.size || content.sha256 !== expected.sha256) {
    throw new Error('Cloudflare R2 upload content verification failed.')
  }
  return head
}

function retentionSelection(indexes, { now = new Date(), dailyDays = 14, weeklyDays = 90 } = {}) {
  if (!Number.isFinite(dailyDays) || dailyDays < 0 || !Number.isFinite(weeklyDays) || weeklyDays < dailyDays) throw new Error('Storage retention windows are invalid.')
  const ordered = [...indexes].sort((left, right) => Date.parse(right.index.createdAt) - Date.parse(left.index.createdAt))
  const keep = []
  const trash = []
  const weeks = new Set()
  const dayMs = 86_400_000
  for (const item of ordered) {
    const created = Date.parse(item.index.createdAt)
    if (!Number.isFinite(created)) throw new Error('Storage backup index has an invalid creation time.')
    const age = Math.max(0, (now.getTime() - created) / dayMs)
    if (age <= dailyDays) { keep.push(item); continue }
    if (age > weeklyDays) { trash.push(item); continue }
    const date = new Date(created)
    const weekday = date.getUTCDay() || 7
    date.setUTCDate(date.getUTCDate() - weekday + 1)
    const week = date.toISOString().slice(0, 10)
    if (weeks.has(week)) trash.push(item)
    else { weeks.add(week); keep.push(item) }
  }
  if (keep.length === 0 && trash.length > 0) keep.push(trash.shift())
  return { keep, trash }
}

async function loadIndexes(destination, bucket, prefix) {
  const indexPrefix = `${prefix}indexes/`
  const manifestPrefix = `${prefix}manifests/`
  const [indexObjects, manifestObjects] = await Promise.all([
    destination.listObjects(bucket, indexPrefix), destination.listObjects(bucket, manifestPrefix),
  ])
  const loaded = []
  const manifestKeys = new Set(manifestObjects.map((object) => object.key))
  for (const object of indexObjects) {
    validateOpaqueKey(object.key, prefix, 'index')
    const index = validatePublicIndex(await destination.getJson(bucket, object.key), prefix)
    if (object.key !== `${prefix}indexes/${index.snapshotId}.json`) throw new Error('Storage backup index identity does not match its key.')
    const canonicalIndexBody = Buffer.from(`${canonicalJson(index)}\n`, 'utf8')
    await verifyDestinationObject(destination, bucket, object.key, { size: canonicalIndexBody.length, sha256: sha256(canonicalIndexBody) })
    if (!manifestKeys.has(index.manifest.key)) throw new Error('Storage retention stopped: an index references a missing manifest.')
    try {
      await verifyDestinationObject(destination, bucket, index.manifest.key, index.manifest)
    } catch {
      throw new Error('Storage retention stopped: a manifest failed verification.')
    }
    loaded.push({ object, index })
    manifestKeys.delete(index.manifest.key)
  }
  if (manifestKeys.size > 0) throw new Error('Storage retention stopped: a manifest has no public index.')
  return loaded
}

export async function applyStorageRetention({ destination, bucket, prefix = DEFAULT_PREFIX, now = new Date(), dailyDays = 14, weeklyDays = 90 }) {
  const normalizedPrefix = normalizePrefix(prefix)
  const loaded = await loadIndexes(destination, bucket, normalizedPrefix)
  if (loaded.length === 0) return { kept: 0, deletedSnapshots: 0, deletedBlobs: 0 }
  const policy = retentionSelection(loaded, { now, dailyDays, weeklyDays })
  const referenced = new Map()
  for (const item of policy.keep) {
    for (const object of item.index.objects) referenced.set(object.blobKey, object)
  }
  // Verify every retained reference before any destructive request. Missing or
  // malformed index, manifest, or blob state therefore turns retention into a
  // no-delete failure.
  for (const [key, object] of referenced) {
    await verifyDestinationObject(destination, bucket, key, { size: object.encryptedSize, sha256: object.encryptedSha256 })
  }
  const blobs = await destination.listObjects(bucket, `${normalizedPrefix}blobs/`)
  for (const object of blobs) validateOpaqueKey(object.key, normalizedPrefix, 'blob')
  for (const item of policy.trash) {
    await destination.deleteObject(bucket, item.object)
    await destination.deleteObject(bucket, { key: item.index.manifest.key })
  }
  let deletedBlobs = 0
  for (const object of blobs) {
    if (!referenced.has(object.key)) {
      await destination.deleteObject(bucket, object)
      deletedBlobs += 1
    }
  }
  return { kept: policy.keep.length, deletedSnapshots: policy.trash.length, deletedBlobs }
}

export async function backupSupabaseStorage({
  source, destination, destinationBucket, publicKeyPem, tempDirectory, prefix = DEFAULT_PREFIX,
  runId, clock = () => new Date(), dailyDays = 14, weeklyDays = 90,
}) {
  required(publicKeyPem, 'Backup public key')
  const normalizedPrefix = normalizePrefix(prefix)
  const safeRunId = required(runId, 'Backup run ID').replace(/[^A-Za-z0-9_-]/g, '-')
  const first = await enumerateStorage(source, clock)
  const stamp = first.startedAt.replaceAll(':', '-').replaceAll('.', '-').replace(/-000Z$/, 'Z')
  const snapshotId = `${stamp}-${safeRunId}`
  const work = tempDirectory || await fs.mkdtemp(path.join(os.tmpdir(), 'tsa-storage-backup-'))
  await fs.mkdir(work, { recursive: true })
  try {
    const previousIndexes = await loadIndexes(destination, destinationBucket, normalizedPrefix)
    const reusable = new Map(previousIndexes.flatMap(({ index }) => index.objects.map((object) => [object.sourceFingerprint, object])))
    const reusableContent = new Map(previousIndexes.flatMap(({ index }) => index.objects.map((object) => [object.plaintextSha256, object])))
    const manifestObjects = []
    const publicObjects = []
    for (const bucket of first.buckets) {
      for (const object of bucket.objects) {
        const fingerprint = sourceFingerprint(bucket.name, object)
        const cached = reusable.get(fingerprint)
        if (cached) {
          await verifyDestinationObject(destination, destinationBucket, cached.blobKey, { size: cached.encryptedSize, sha256: cached.encryptedSha256 })
          publicObjects.push(cached)
          manifestObjects.push({ bucket: bucket.name, key: object.key, listed: object.listed, head: object.head, ...cached })
          continue
        }
        const plainPath = path.join(work, `${fingerprint}.source`)
        const encryptedPath = path.join(work, `${fingerprint}.tbbackup`)
        const downloaded = await source.downloadObject(bucket.name, object.key, plainPath, object.head.eTag || object.listed.eTag)
        if (downloaded.size !== object.head.size) throw new Error('Supabase Storage object changed while it was downloaded.')
        const blobKey = `${normalizedPrefix}blobs/${downloaded.sha256}.tbbackup`
        const contentCached = reusableContent.get(downloaded.sha256)
        if (contentCached && contentCached.blobKey === blobKey && contentCached.plaintextSize === downloaded.size) {
          await verifyDestinationObject(destination, destinationBucket, blobKey, { size: contentCached.encryptedSize, sha256: contentCached.encryptedSha256 })
          await fs.rm(plainPath, { force: true })
          const publicObject = { ...contentCached, sourceFingerprint: fingerprint }
          publicObjects.push(publicObject)
          manifestObjects.push({ bucket: bucket.name, key: object.key, listed: object.listed, head: object.head, ...publicObject })
          continue
        }
        await encryptBackupFile({ inputPath: plainPath, outputPath: encryptedPath, publicKeyPem, allowEmpty: true })
        await fs.rm(plainPath, { force: true })
        const encrypted = { size: (await fs.stat(encryptedPath)).size, sha256: await sha256File(encryptedPath) }
        await destination.putFile(destinationBucket, blobKey, encryptedPath, encrypted)
        await verifyDestinationObject(destination, destinationBucket, blobKey, encrypted)
        await fs.rm(encryptedPath, { force: true })
        const publicObject = {
          sourceFingerprint: fingerprint, blobKey,
          plaintextSize: downloaded.size, plaintextSha256: downloaded.sha256,
          encryptedSize: encrypted.size, encryptedSha256: encrypted.sha256,
        }
        publicObjects.push(publicObject)
        reusableContent.set(downloaded.sha256, publicObject)
        manifestObjects.push({ bucket: bucket.name, key: object.key, listed: object.listed, head: object.head, ...publicObject })
      }
    }
    const second = await enumerateStorage(source, clock)
    if (second.fingerprint !== first.fingerprint) {
      throw new Error('Supabase Storage changed during backup; no snapshot index or manifest was published.')
    }
    const manifest = {
      formatVersion: FORMAT_VERSION,
      kind: 'tsa-bonno-supabase-storage-manifest',
      snapshotId,
      createdAt: first.startedAt,
      certification: {
        certified: true,
        nonAtomic: true,
        disclosure: 'Supabase Storage has no atomic whole-bucket snapshot API. Certification means two complete paginated bucket/object/HEAD inventories matched before publication.',
        initialEnumerationStartedAt: first.startedAt,
        initialEnumerationCompletedAt: first.completedAt,
        finalEnumerationStartedAt: second.startedAt,
        finalEnumerationCompletedAt: second.completedAt,
        inventorySha256: first.fingerprint,
      },
      buckets: first.buckets.map((bucket) => ({ name: bucket.name, creationDate: bucket.creationDate, location: bucket.location, objectCount: bucket.objects.length })),
      objects: manifestObjects,
    }
    const manifestPlainPath = path.join(work, `manifest-${sha256(snapshotId)}.json`)
    const manifestEncryptedPath = `${manifestPlainPath}.tbbackup`
    await fs.writeFile(manifestPlainPath, `${canonicalJson(manifest)}\n`, { flag: 'wx', mode: 0o600 })
    await encryptBackupFile({ inputPath: manifestPlainPath, outputPath: manifestEncryptedPath, publicKeyPem })
    await fs.rm(manifestPlainPath, { force: true })
    const encryptedManifest = { size: (await fs.stat(manifestEncryptedPath)).size, sha256: await sha256File(manifestEncryptedPath) }
    const manifestKey = `${normalizedPrefix}manifests/${snapshotId}.tbbackup`
    const indexKey = `${normalizedPrefix}indexes/${snapshotId}.json`
    validateOpaqueKey(manifestKey, normalizedPrefix, 'manifest')
    validateOpaqueKey(indexKey, normalizedPrefix, 'index')
    await destination.putFile(destinationBucket, manifestKey, manifestEncryptedPath, encryptedManifest)
    await verifyDestinationObject(destination, destinationBucket, manifestKey, encryptedManifest)
    const publicIndex = {
      formatVersion: FORMAT_VERSION,
      kind: 'tsa-bonno-supabase-storage-index',
      complete: true,
      snapshotId,
      createdAt: first.startedAt,
      certifiedInventorySha256: first.fingerprint,
      certification: {
        certified: true,
        nonAtomic: true,
        initialEnumerationStartedAt: first.startedAt,
        initialEnumerationCompletedAt: first.completedAt,
        finalEnumerationStartedAt: second.startedAt,
        finalEnumerationCompletedAt: second.completedAt,
      },
      bucketCount: first.buckets.length,
      objectCount: publicObjects.length,
      manifest: { key: manifestKey, size: encryptedManifest.size, sha256: encryptedManifest.sha256 },
      objects: publicObjects.sort((left, right) => left.sourceFingerprint.localeCompare(right.sourceFingerprint)),
    }
    validatePublicIndex(publicIndex, normalizedPrefix)
    const uploadedIndex = await destination.putJson(destinationBucket, indexKey, publicIndex)
    await verifyDestinationObject(destination, destinationBucket, indexKey, uploadedIndex)
    const visible = await destination.getJson(destinationBucket, indexKey)
    if (canonicalJson(visible) !== canonicalJson(publicIndex)) throw new Error('Cloudflare R2 index read-after-write verification failed.')
    await fs.rm(manifestEncryptedPath, { force: true })
    const retention = await applyStorageRetention({ destination, bucket: destinationBucket, prefix: normalizedPrefix, now: clock(), dailyDays, weeklyDays })
    return { snapshotId, bucketCount: first.buckets.length, objectCount: publicObjects.length, indexKey, manifestKey, retention }
  } finally {
    await fs.rm(work, { recursive: true, force: true })
  }
}

async function runCli() {
  const publicKeyPem = Buffer.from(required(process.env.BACKUP_ENCRYPTION_PUBLIC_KEY_B64, 'BACKUP_ENCRYPTION_PUBLIC_KEY_B64'), 'base64').toString('utf8')
  if (!publicKeyPem.includes('BEGIN PUBLIC KEY')) throw new Error('Backup public key is invalid.')
  const source = new S3Client({
    endpoint: process.env.SUPABASE_STORAGE_S3_ENDPOINT,
    region: process.env.SUPABASE_STORAGE_S3_REGION,
    accessKeyId: process.env.SUPABASE_STORAGE_S3_ACCESS_KEY_ID,
    secretAccessKey: process.env.SUPABASE_STORAGE_S3_SECRET_ACCESS_KEY,
    label: 'Supabase Storage S3',
  })
  const accountId = required(process.env.CLOUDFLARE_R2_ACCOUNT_ID, 'CLOUDFLARE_R2_ACCOUNT_ID')
  if (!/^[A-Za-z0-9_-]+$/.test(accountId)) throw new Error('Cloudflare R2 account ID is invalid.')
  const destination = new S3Client({
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`, region: 'auto',
    accessKeyId: process.env.CLOUDFLARE_R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY,
    label: 'Cloudflare R2',
  })
  const result = await backupSupabaseStorage({
    source, destination,
    destinationBucket: required(process.env.CLOUDFLARE_R2_BUCKET, 'CLOUDFLARE_R2_BUCKET'),
    publicKeyPem,
    tempDirectory: process.env.RUNNER_TEMP ? path.join(process.env.RUNNER_TEMP, `supabase-storage-${process.env.GITHUB_RUN_ID || 'manual'}`) : undefined,
    prefix: process.env.BACKUP_STORAGE_R2_PREFIX || DEFAULT_PREFIX,
    runId: process.env.GITHUB_RUN_ID || `manual-${Date.now()}`,
    dailyDays: Number(process.env.BACKUP_DAILY_RETENTION_DAYS || 14),
    weeklyDays: Number(process.env.BACKUP_WEEKLY_RETENTION_DAYS || 90),
  })
  console.log(`Encrypted Supabase Storage snapshot certified: ${result.snapshotId}; ${result.bucketCount} buckets, ${result.objectCount} objects; ${result.retention.deletedSnapshots} expired snapshots and ${result.retention.deletedBlobs} unreferenced blobs deleted.`)
}

const isCli = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url
if (isCli) {
  runCli().catch((error) => {
    console.error(`Supabase Storage backup failed: ${redact(error.message, [process.env.SUPABASE_STORAGE_S3_ACCESS_KEY_ID, process.env.SUPABASE_STORAGE_S3_SECRET_ACCESS_KEY, process.env.CLOUDFLARE_R2_ACCESS_KEY_ID, process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY])}`)
    process.exitCode = 1
  })
}

export { DEFAULT_PREFIX, canonicalJson, retentionSelection, sourceFingerprint }
