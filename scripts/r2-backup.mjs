import { createHash, createHmac } from 'node:crypto'
import { createReadStream, promises as fs } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { pathToFileURL } from 'node:url'

const AWS_REGION = 'auto'
const AWS_SERVICE = 's3'
const DEFAULT_PREFIX = 'tsa-bonno/supabase/'
const MAX_LIST_PAGES = 100
const BACKUP_FILE_PATTERN = /^tsa-bonno-supabase-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}Z-\d+\.tar\.gz\.tbbackup$/

function requireValue(value, label) {
  if (!value) throw new Error(`${label} is required.`)
  return String(value)
}

function validateAccountId(value) {
  const accountId = requireValue(value, 'Cloudflare R2 account ID')
  if (!/^[A-Za-z0-9_-]+$/.test(accountId)) throw new Error('Cloudflare R2 account ID is invalid.')
  return accountId
}

function validateBucket(value) {
  const bucket = requireValue(value, 'Cloudflare R2 bucket')
  if (!/^[A-Za-z0-9][A-Za-z0-9.-]{1,61}[A-Za-z0-9]$/.test(bucket)) throw new Error('Cloudflare R2 bucket name is invalid.')
  return bucket
}

function normalizePrefix(value = DEFAULT_PREFIX) {
  const prefix = String(value || '').replaceAll('\\', '/')
  if (!prefix || prefix.startsWith('/') || prefix.includes('\0') || prefix.split('/').some((part) => part === '..')) {
    throw new Error('Cloudflare R2 backup prefix is invalid.')
  }
  return prefix.endsWith('/') ? prefix : `${prefix}/`
}

function encodeRfc3986(value) {
  return encodeURIComponent(String(value)).replace(/[!'()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`)
}

function canonicalPath(bucket, key = '') {
  const encodedBucket = encodeRfc3986(bucket)
  const encodedKey = String(key)
    .split('/')
    .filter(Boolean)
    .map((part) => encodeRfc3986(part))
    .join('/')
  return `/${encodedBucket}${encodedKey ? `/${encodedKey}` : ''}`
}

function canonicalQuery(query = {}) {
  return Object.entries(query)
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .flatMap(([name, value]) => Array.isArray(value) ? value.map((item) => [name, item]) : [[name, value]])
    .sort(([leftName, leftValue], [rightName, rightValue]) => {
      const left = `${encodeRfc3986(leftName)}=${encodeRfc3986(leftValue)}`
      const right = `${encodeRfc3986(rightName)}=${encodeRfc3986(rightValue)}`
      return left < right ? -1 : left > right ? 1 : 0
    })
    .map(([name, value]) => `${encodeRfc3986(name)}=${encodeRfc3986(value)}`)
    .join('&')
}

function hmac(key, value) {
  return createHmac('sha256', key).update(value).digest()
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

async function sha256File(filePath) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(filePath)) hash.update(chunk)
  return hash.digest('hex')
}

function signingKey(secretAccessKey, dateStamp) {
  return hmac(hmac(hmac(hmac(`AWS4${secretAccessKey}`, dateStamp), AWS_REGION), AWS_SERVICE), 'aws4_request')
}

function r2Endpoint(accountId) {
  return new URL(`https://${validateAccountId(accountId)}.r2.cloudflarestorage.com`)
}

function redact(value, secrets = []) {
  let result = String(value || '')
  for (const secret of secrets) if (secret) result = result.replaceAll(String(secret), '[redacted]')
  return result.slice(0, 300)
}

async function responseError(response, operation, secrets) {
  const body = await response.text().catch(() => '')
  return new Error(`Cloudflare R2 ${operation} failed (${response.status}): ${redact(body || response.statusText || 'unknown error', secrets)}`)
}

async function signedR2Request({
  method,
  accountId,
  bucket,
  key = '',
  query,
  accessKeyId,
  secretAccessKey,
  headers = {},
  body,
  payloadHash,
  operation = method
}) {
  const access = requireValue(accessKeyId, 'Cloudflare R2 access key ID')
  const secret = requireValue(secretAccessKey, 'Cloudflare R2 secret access key')
  const endpoint = r2Endpoint(accountId)
  const host = endpoint.host
  const pathName = canonicalPath(validateBucket(bucket), key)
  const queryString = canonicalQuery(query)
  const amzDate = new Date().toISOString().replaceAll(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')
  const dateStamp = amzDate.slice(0, 8)
  const bodyHash = payloadHash || sha256('')
  const canonicalHeaders = {
    host,
    'x-amz-content-sha256': bodyHash,
    'x-amz-date': amzDate,
    ...Object.fromEntries(Object.entries(headers).map(([name, value]) => [name.toLowerCase(), String(value).trim()]))
  }
  const signedNames = Object.keys(canonicalHeaders).sort()
  const canonicalHeaderText = signedNames.map((name) => `${name}:${canonicalHeaders[name]}\n`).join('')
  const canonicalRequest = [method.toUpperCase(), pathName, queryString, canonicalHeaderText, signedNames.join(';'), bodyHash].join('\n')
  const scope = `${dateStamp}/${AWS_REGION}/${AWS_SERVICE}/aws4_request`
  const stringToSign = `AWS4-HMAC-SHA256\n${amzDate}\n${scope}\n${sha256(canonicalRequest)}`
  const signature = createHmac('sha256', signingKey(secret, dateStamp)).update(stringToSign).digest('hex')
  const requestHeaders = {
    ...canonicalHeaders,
    authorization: `AWS4-HMAC-SHA256 Credential=${access}/${scope}, SignedHeaders=${signedNames.join(';')}, Signature=${signature}`
  }
  const request = {
    method: method.toUpperCase(),
    headers: requestHeaders,
    body
  }
  if (body && typeof body === 'object' && typeof body.pipe === 'function') request.duplex = 'half'
  const response = await fetch(new URL(`${pathName}${queryString ? `?${queryString}` : ''}`, endpoint), request)
  if (!response.ok) throw await responseError(response, operation, [secret, access])
  return response
}

function xmlUnescape(value) {
  return String(value || '').replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&quot;', '"').replaceAll('&apos;', "'").replaceAll('&amp;', '&')
}

function xmlTag(fragment, name) {
  const match = String(fragment).match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`))
  return match ? xmlUnescape(match[1]) : ''
}

function parseListObjectsXml(xml, prefix) {
  if (!/<ListBucketResult(?:\s[^>]*)?>/.test(String(xml)) || !/<IsTruncated(?:\s[^>]*)?>/.test(String(xml))) {
    throw new Error('Cloudflare R2 listing returned malformed XML.')
  }
  const objects = []
  for (const match of String(xml).matchAll(/<Contents(?:\s[^>]*)?>([\s\S]*?)<\/Contents>/g)) {
    const fragment = match[1]
    const key = xmlTag(fragment, 'Key')
    if (!isManagedBackupObject({ key }, prefix)) continue
    const sizeText = xmlTag(fragment, 'Size')
    const size = Number(sizeText)
    objects.push({
      key,
      size: Number.isSafeInteger(size) && size >= 0 ? size : 0,
      lastModified: xmlTag(fragment, 'LastModified'),
      createdTime: xmlTag(fragment, 'LastModified'),
      etag: xmlTag(fragment, 'ETag')
    })
  }
  const truncated = xmlTag(String(xml), 'IsTruncated').toLowerCase() === 'true'
  return { objects, truncated, nextToken: xmlTag(String(xml), 'NextContinuationToken') }
}

export function isManagedBackupObject(object, prefix = DEFAULT_PREFIX) {
  const normalizedPrefix = normalizePrefix(prefix)
  const key = String(object?.key || object?.Key || '')
  const fileName = key.startsWith(normalizedPrefix) ? key.slice(normalizedPrefix.length) : ''
  return Boolean(fileName && !fileName.includes('/') && BACKUP_FILE_PATTERN.test(fileName))
}

export async function uploadEncryptedBackup({ accountId, bucket, accessKeyId, secretAccessKey, filePath, prefix = DEFAULT_PREFIX } = {}) {
  const source = requireValue(filePath, 'Encrypted backup path')
  const stat = await fs.stat(source)
  if (!stat.isFile() || stat.size <= 0) throw new Error('Encrypted backup must be a non-empty file.')
  const name = path.basename(source)
  const normalizedPrefix = normalizePrefix(prefix)
  if (!isManagedBackupObject({ key: `${normalizedPrefix}${name}` }, normalizedPrefix)) throw new Error('Encrypted backup filename is not managed by the R2 backup policy.')
  const checksum = await sha256File(source)
  await signedR2Request({
    method: 'PUT',
    accountId,
    bucket,
    key: `${normalizedPrefix}${name}`,
    accessKeyId,
    secretAccessKey,
    payloadHash: checksum,
    headers: {
      'content-type': 'application/octet-stream',
      'content-length': String(stat.size)
    },
    body: createReadStream(source),
    operation: 'upload'
  })
  return { key: `${normalizedPrefix}${name}`, size: stat.size, sha256: checksum }
}

export async function listManagedBackups({ accountId, bucket, accessKeyId, secretAccessKey, prefix = DEFAULT_PREFIX } = {}) {
  const normalizedPrefix = normalizePrefix(prefix)
  const objects = []
  let continuationToken = ''
  for (let page = 0; page < MAX_LIST_PAGES; page += 1) {
    const response = await signedR2Request({
      method: 'GET',
      accountId,
      bucket,
      accessKeyId,
      secretAccessKey,
      query: {
        'list-type': '2',
        prefix: normalizedPrefix,
        'max-keys': '1000',
        'continuation-token': continuationToken
      },
      operation: 'list'
    })
    const parsed = parseListObjectsXml(await response.text(), normalizedPrefix)
    objects.push(...parsed.objects)
    if (!parsed.truncated) return objects
    if (!parsed.nextToken) throw new Error('Cloudflare R2 listing was truncated without a continuation token.')
    continuationToken = parsed.nextToken
  }
  throw new Error(`Cloudflare R2 listing exceeded the ${MAX_LIST_PAGES}-page safety limit.`)
}

function objectTime(object) {
  return Date.parse(object?.lastModified || object?.createdTime || '')
}

function startOfIsoWeekKey(value) {
  const date = new Date(value)
  const day = date.getUTCDay() || 7
  date.setUTCDate(date.getUTCDate() - day + 1)
  return date.toISOString().slice(0, 10)
}

export function selectBackupRetention(objects, {
  now = new Date(),
  dailyRetentionDays = 14,
  weeklyRetentionDays = 90,
  prefix = DEFAULT_PREFIX
} = {}) {
  const dailyDays = Number(dailyRetentionDays)
  const weeklyDays = Number(weeklyRetentionDays)
  if (!Number.isFinite(dailyDays) || dailyDays < 0 || !Number.isFinite(weeklyDays) || weeklyDays < dailyDays) throw new Error('Backup retention windows are invalid.')
  const dayMs = 24 * 60 * 60 * 1000
  const normalizedPrefix = normalizePrefix(prefix)
  const ordered = [...objects].filter((object) => isManagedBackupObject(object, normalizedPrefix)).sort((left, right) => {
    const leftTime = objectTime(left)
    const rightTime = objectTime(right)
    if (Number.isFinite(leftTime) && Number.isFinite(rightTime)) return rightTime - leftTime || String(left.key).localeCompare(String(right.key))
    if (Number.isFinite(leftTime)) return -1
    if (Number.isFinite(rightTime)) return 1
    return String(left.key).localeCompare(String(right.key))
  })
  const retainedWeeks = new Set()
  const keep = []
  const trash = []
  for (const object of ordered) {
    const createdAt = objectTime(object)
    if (!Number.isFinite(createdAt)) {
      keep.push(object)
      continue
    }
    const ageDays = Math.max(0, (now.getTime() - createdAt) / dayMs)
    if (ageDays <= dailyDays) {
      keep.push(object)
      continue
    }
    if (ageDays > weeklyDays) {
      trash.push(object)
      continue
    }
    const week = startOfIsoWeekKey(createdAt)
    if (!retainedWeeks.has(week)) {
      retainedWeeks.add(week)
      keep.push(object)
    } else {
      trash.push(object)
    }
  }
  // A retention bug or an eventually-consistent listing must never remove the
  // only positively identified successful backup.
  if (keep.length === 0 && trash.length > 0) keep.push(trash.shift())
  return { keep, trash }
}

export async function deleteR2Object({ accountId, bucket, accessKeyId, secretAccessKey, object, prefix = DEFAULT_PREFIX } = {}) {
  const normalizedPrefix = normalizePrefix(prefix)
  if (!isManagedBackupObject(object, normalizedPrefix)) throw new Error('Refusing to delete an unmanaged R2 object.')
  const key = String(object.key || object.Key)
  const headers = object.etag ? { 'if-match': String(object.etag) } : {}
  await signedR2Request({
    method: 'DELETE',
    accountId,
    bucket,
    key,
    accessKeyId,
    secretAccessKey,
    headers,
    operation: 'delete'
  })
  return key
}

async function runCli() {
  const filePath = requireValue(process.argv[2], 'Encrypted backup path argument')
  const config = {
    accountId: process.env.CLOUDFLARE_R2_ACCOUNT_ID,
    bucket: process.env.CLOUDFLARE_R2_BUCKET,
    accessKeyId: process.env.CLOUDFLARE_R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY,
    prefix: process.env.BACKUP_R2_PREFIX || DEFAULT_PREFIX
  }
  const uploaded = await uploadEncryptedBackup({ ...config, filePath })
  console.log(`Encrypted backup uploaded to Cloudflare R2: ${uploaded.key} (${uploaded.size} bytes)`)
  const files = await listManagedBackups(config)
  if (!files.some((object) => object.key === uploaded.key)) {
    throw new Error('Uploaded backup was not visible in the Cloudflare R2 listing; retention was not attempted.')
  }
  const policy = selectBackupRetention(files, {
    dailyRetentionDays: Number(process.env.BACKUP_DAILY_RETENTION_DAYS || 14),
    weeklyRetentionDays: Number(process.env.BACKUP_WEEKLY_RETENTION_DAYS || 90)
  })
  for (const object of policy.trash) await deleteR2Object({ ...config, object })
  console.log(`Cloudflare R2 retention complete: ${policy.keep.length} retained, ${policy.trash.length} deleted.`)
}

const isCli = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url
if (isCli) {
  runCli().catch((error) => {
    console.error(`Cloudflare R2 backup failed: ${redact(error.message, [process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY, process.env.CLOUDFLARE_R2_ACCESS_KEY_ID])}`)
    process.exitCode = 1
  })
}

export {
  AWS_REGION,
  AWS_SERVICE,
  DEFAULT_PREFIX,
  BACKUP_FILE_PATTERN,
  canonicalPath,
  canonicalQuery,
  parseListObjectsXml,
  sha256File
}
