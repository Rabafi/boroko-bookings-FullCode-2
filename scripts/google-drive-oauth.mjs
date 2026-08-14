import { createServer } from 'node:http'
import process from 'node:process'
import { randomBytes } from 'node:crypto'
import { DRIVE_SCOPE, refreshGoogleAccessToken } from './google-drive-backup.mjs'

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const DRIVE_FILES_URL = 'https://www.googleapis.com/drive/v3/files'

function requireValue(value, label) {
  if (!value) throw new Error(`${label} is required.`)
  return value
}

async function exchangeCode({ code, clientId, clientSecret, redirectUri }) {
  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code'
    })
  })
  const body = await response.json().catch(() => ({}))
  if (!response.ok || !body.refresh_token) {
    throw new Error(`Google authorization failed (${response.status}): ${body.error_description || body.error || 'no refresh token returned'}`)
  }
  return body
}

async function createBackupFolder(accessToken) {
  const response = await fetch(DRIVE_FILES_URL, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${accessToken}`,
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      name: 'Tsa Bonno Supabase Backups',
      mimeType: 'application/vnd.google-apps.folder'
    })
  })
  const body = await response.json().catch(() => ({}))
  if (!response.ok || !body.id) {
    throw new Error(`Could not create Google Drive backup folder (${response.status}): ${body.error?.message || 'unknown error'}`)
  }
  return body
}

async function run() {
  const clientId = requireValue(process.env.GOOGLE_DRIVE_CLIENT_ID, 'GOOGLE_DRIVE_CLIENT_ID')
  const clientSecret = requireValue(process.env.GOOGLE_DRIVE_CLIENT_SECRET, 'GOOGLE_DRIVE_CLIENT_SECRET')
  const state = randomBytes(24).toString('hex')
  let resolveCode
  let rejectCode
  const codeResult = new Promise((resolve, reject) => {
    resolveCode = resolve
    rejectCode = reject
  })
  const server = createServer((request, response) => {
    try {
      const url = new URL(request.url, 'http://127.0.0.1')
      if (url.pathname !== '/oauth2/callback') {
        response.writeHead(404).end('Not found')
        return
      }
      if (url.searchParams.get('state') !== state) throw new Error('OAuth state validation failed.')
      const oauthError = url.searchParams.get('error')
      if (oauthError) throw new Error(`Google authorization was declined: ${oauthError}`)
      const code = url.searchParams.get('code')
      if (!code) throw new Error('Google did not return an authorization code.')
      response.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' })
      response.end('Google Drive authorization succeeded. Return to the terminal to finish setup.')
      resolveCode(code)
    } catch (error) {
      response.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' })
      response.end(`Authorization failed: ${error.message}`)
      rejectCode(error)
    }
  })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  const redirectUri = `http://127.0.0.1:${address.port}/oauth2/callback`
  const authorize = new URL(AUTH_URL)
  authorize.searchParams.set('client_id', clientId)
  authorize.searchParams.set('redirect_uri', redirectUri)
  authorize.searchParams.set('response_type', 'code')
  authorize.searchParams.set('scope', DRIVE_SCOPE)
  authorize.searchParams.set('access_type', 'offline')
  authorize.searchParams.set('prompt', 'consent')
  authorize.searchParams.set('state', state)

  console.log('Open this URL in your browser and authorize your Google Drive account:')
  console.log(authorize.toString())
  try {
    const code = await codeResult
    const tokens = await exchangeCode({ code, clientId, clientSecret, redirectUri })
    const accessToken = tokens.access_token || await refreshGoogleAccessToken({
      clientId,
      clientSecret,
      refreshToken: tokens.refresh_token
    })
    const folder = await createBackupFolder(accessToken)
    console.log('\nAdd these values as GitHub Actions secrets. Treat the refresh token like a password:')
    console.log(`GOOGLE_DRIVE_REFRESH_TOKEN=${tokens.refresh_token}`)
    console.log(`GOOGLE_DRIVE_FOLDER_ID=${folder.id}`)
    console.log(`Created Drive folder: ${folder.name}`)
  } finally {
    server.close()
  }
}

run().catch((error) => {
  console.error(`Google Drive authorization setup failed: ${error.message}`)
  process.exitCode = 1
})
