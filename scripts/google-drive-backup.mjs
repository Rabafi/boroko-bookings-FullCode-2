import { createReadStream, promises as fs } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { pathToFileURL } from 'node:url'

const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file'
const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const DRIVE_FILES_URL = 'https://www.googleapis.com/drive/v3/files'
const DRIVE_UPLOAD_URL = 'https://www.googleapis.com/upload/drive/v3/files'

function requireValue(value, label) {
  if (!value) throw new Error(`${label} is required.`)
  return value
}

export async function refreshGoogleAccessToken({ clientId, clientSecret, refreshToken }) {
  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: requireValue(clientId, 'Google OAuth client ID'),
      client_secret: requireValue(clientSecret, 'Google OAuth client secret'),
      refresh_token: requireValue(refreshToken, 'Google OAuth refresh token'),
      grant_type: 'refresh_token'
    })
  })
  const body = await response.json().catch(() => ({}))
  if (!response.ok || !body.access_token) {
    throw new Error(`Google OAuth refresh failed (${response.status}): ${body.error_description || body.error || 'unknown error'}`)
  }
  return body.access_token
}

export async function uploadEncryptedBackup({ accessToken, folderId, filePath }) {
  const stat = await fs.stat(filePath)
  if (!stat.isFile() || stat.size <= 0) throw new Error('Encrypted backup must be a non-empty file.')
  const name = path.basename(filePath)
  const initialize = await fetch(`${DRIVE_UPLOAD_URL}?uploadType=resumable&supportsAllDrives=true`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${accessToken}`,
      'content-type': 'application/json; charset=UTF-8',
      'x-upload-content-length': String(stat.size),
      'x-upload-content-type': 'application/octet-stream'
    },
    body: JSON.stringify({
      name,
      parents: [requireValue(folderId, 'Google Drive folder ID')],
      description: 'Encrypted Tsa Bonno Supabase disaster-recovery backup.'
    })
  })
  if (!initialize.ok) {
    throw new Error(`Google Drive upload initialization failed (${initialize.status}): ${await initialize.text()}`)
  }
  const uploadUrl = initialize.headers.get('location')
  if (!uploadUrl) throw new Error('Google Drive did not return a resumable upload URL.')

  const uploaded = await fetch(uploadUrl, {
    method: 'PUT',
    headers: {
      'content-length': String(stat.size),
      'content-type': 'application/octet-stream'
    },
    body: createReadStream(filePath),
    duplex: 'half'
  })
  const body = await uploaded.json().catch(() => ({}))
  if (!uploaded.ok || !body.id) {
    throw new Error(`Google Drive upload failed (${uploaded.status}): ${body.error?.message || 'unknown error'}`)
  }
  return body
}

export async function listManagedBackups({ accessToken, folderId, prefix }) {
  const query = `'${String(folderId).replaceAll("'", "\\'")}' in parents and trashed = false and name contains '${String(prefix).replaceAll("'", "\\'")}'`
  const files = []
  let pageToken = ''
  do {
    const url = new URL(DRIVE_FILES_URL)
    url.searchParams.set('q', query)
    url.searchParams.set('spaces', 'drive')
    url.searchParams.set('orderBy', 'createdTime desc')
    url.searchParams.set('pageSize', '1000')
    url.searchParams.set('fields', 'nextPageToken,files(id,name,createdTime,size,md5Checksum)')
    url.searchParams.set('supportsAllDrives', 'true')
    url.searchParams.set('includeItemsFromAllDrives', 'true')
    if (pageToken) url.searchParams.set('pageToken', pageToken)
    const response = await fetch(url, { headers: { authorization: `Bearer ${accessToken}` } })
    const body = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(`Google Drive listing failed (${response.status}): ${body.error?.message || 'unknown error'}`)
    files.push(...(body.files || []))
    pageToken = body.nextPageToken || ''
  } while (pageToken)
  return files
}

function startOfIsoWeekKey(value) {
  const date = new Date(value)
  const day = date.getUTCDay() || 7
  date.setUTCDate(date.getUTCDate() - day + 1)
  return date.toISOString().slice(0, 10)
}

export function selectBackupRetention(files, {
  now = new Date(),
  dailyRetentionDays = 14,
  weeklyRetentionDays = 90
} = {}) {
  const dayMs = 24 * 60 * 60 * 1000
  const ordered = [...files].sort((left, right) => Date.parse(right.createdTime) - Date.parse(left.createdTime))
  const retainedWeeks = new Set()
  const keep = []
  const trash = []
  for (const file of ordered) {
    const createdAt = Date.parse(file.createdTime)
    if (!Number.isFinite(createdAt)) {
      keep.push(file)
      continue
    }
    const ageDays = Math.max(0, (now.getTime() - createdAt) / dayMs)
    if (ageDays <= dailyRetentionDays) {
      keep.push(file)
      continue
    }
    if (ageDays > weeklyRetentionDays) {
      trash.push(file)
      continue
    }
    const week = startOfIsoWeekKey(file.createdTime)
    if (!retainedWeeks.has(week)) {
      retainedWeeks.add(week)
      keep.push(file)
    } else {
      trash.push(file)
    }
  }
  return { keep, trash }
}

export async function trashDriveFile({ accessToken, fileId }) {
  const response = await fetch(`${DRIVE_FILES_URL}/${encodeURIComponent(fileId)}?supportsAllDrives=true`, {
    method: 'PATCH',
    headers: {
      authorization: `Bearer ${accessToken}`,
      'content-type': 'application/json'
    },
    body: JSON.stringify({ trashed: true })
  })
  if (!response.ok) {
    const body = await response.json().catch(() => ({}))
    throw new Error(`Could not move expired backup ${fileId} to Google Drive trash (${response.status}): ${body.error?.message || 'unknown error'}`)
  }
}

async function runCli() {
  const filePath = requireValue(process.argv[2], 'Encrypted backup path argument')
  const accessToken = await refreshGoogleAccessToken({
    clientId: process.env.GOOGLE_DRIVE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_DRIVE_CLIENT_SECRET,
    refreshToken: process.env.GOOGLE_DRIVE_REFRESH_TOKEN
  })
  const folderId = requireValue(process.env.GOOGLE_DRIVE_FOLDER_ID, 'GOOGLE_DRIVE_FOLDER_ID')
  const prefix = process.env.BACKUP_FILE_PREFIX || 'tsa-bonno-supabase-'
  const uploaded = await uploadEncryptedBackup({ accessToken, folderId, filePath })
  console.log(`Encrypted backup uploaded to Google Drive: ${uploaded.name || path.basename(filePath)} (${uploaded.id})`)

  const files = await listManagedBackups({ accessToken, folderId, prefix })
  const policy = selectBackupRetention(files, {
    dailyRetentionDays: Number(process.env.BACKUP_DAILY_RETENTION_DAYS || 14),
    weeklyRetentionDays: Number(process.env.BACKUP_WEEKLY_RETENTION_DAYS || 90)
  })
  for (const file of policy.trash) {
    await trashDriveFile({ accessToken, fileId: file.id })
  }
  console.log(`Google Drive retention complete: ${policy.keep.length} retained, ${policy.trash.length} moved to trash.`)
}

const isCli = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url
if (isCli) {
  runCli().catch((error) => {
    console.error(`Google Drive backup failed: ${error.message}`)
    process.exitCode = 1
  })
}

export { DRIVE_SCOPE }
