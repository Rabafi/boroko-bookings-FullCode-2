import { Pool } from 'pg'
import { startOwnerReceiver } from './ownerReceiver.js'

function required(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`Missing required owner receiver setting ${name}.`)
  return value
}

function port(name: string, fallback: number): number {
  const value = process.env[name]
  if (!value) return fallback
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) throw new Error(`${name} must be a valid TCP port.`)
  return parsed
}

async function deliverVerification(email: string, verificationUrl: string): Promise<void> {
  const endpoint = new URL(required('BAR_OWNER_EMAIL_WEBHOOK_URL'))
  if (endpoint.protocol !== 'https:') throw new Error('Owner verification email delivery must use HTTPS.')
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 10000)
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      redirect: 'error',
      signal: controller.signal,
      headers: {
        authorization: `Bearer ${required('BAR_OWNER_EMAIL_WEBHOOK_TOKEN')}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify({ to: email, template: 'bar_owner_verification', verification_url: verificationUrl })
    })
    if (!response.ok) throw new Error(`Verification delivery returned HTTP ${response.status}.`)
    const reader = response.body?.getReader()
    if (reader) {
      let bytes = 0
      while (true) {
        const chunk = await reader.read()
        if (chunk.done) break
        bytes += chunk.value.byteLength
        if (bytes > 4096) { await reader.cancel(); throw new Error('Verification delivery response exceeded its size limit.') }
      }
    }
  } finally { clearTimeout(timer) }
}

const host = process.env.BAR_OWNER_HOST?.trim() || '127.0.0.1'
const tlsCert = process.env.BAR_OWNER_TLS_CERT?.trim()
const tlsKey = process.env.BAR_OWNER_TLS_KEY?.trim()
if (Boolean(tlsCert) !== Boolean(tlsKey)) throw new Error('Configure both BAR_OWNER_TLS_CERT and BAR_OWNER_TLS_KEY, or neither for loopback development.')
if (!['127.0.0.1', '::1', 'localhost'].includes(host.replace(/^\[|\]$/g, '').toLowerCase()) && !tlsCert) {
  throw new Error('A non-loopback owner receiver must be configured with TLS certificate and key files.')
}

const dbHost = required('BAR_OWNER_DB_HOST')
const loopbackDb = ['127.0.0.1', '::1', 'localhost'].includes(dbHost.replace(/^\[|\]$/g, '').toLowerCase())
const pool = new Pool({
  host: dbHost,
  port: port('BAR_OWNER_DB_PORT', 5432),
  database: required('BAR_OWNER_DB_NAME'),
  user: required('BAR_OWNER_DB_USER'),
  password: required('BAR_OWNER_DB_PASSWORD'),
  ssl: loopbackDb ? false : { rejectUnauthorized: true },
  max: 12,
  connectionTimeoutMillis: 5000,
  idleTimeoutMillis: 30000,
  application_name: 'bar-owner-receiver'
})

const masterKey = required('BAR_OWNER_MASTER_KEY')
if (masterKey.length < 32) throw new Error('BAR_OWNER_MASTER_KEY must contain at least 32 characters.')

const receiver = await startOwnerReceiver({
  pool,
  masterKey,
  publicUrl: required('BAR_OWNER_PUBLIC_URL'),
  pwaOrigin: required('BAR_OWNER_PWA_ORIGIN'),
  host,
  port: port('BAR_OWNER_PORT', 8792),
  ...(tlsCert && tlsKey ? { tls: { certFile: tlsCert, keyFile: tlsKey } } : {}),
  deliverVerification
})

console.info(JSON.stringify({ event: 'owner_receiver_started', host, port: port('BAR_OWNER_PORT', 8792), tls: Boolean(tlsCert) }))

let closing = false
const close = async () => {
  if (closing) return
  closing = true
  await receiver.close()
  await pool.end()
}
process.once('SIGINT', () => { void close().then(() => process.exit(0), () => process.exit(1)) })
process.once('SIGTERM', () => { void close().then(() => process.exit(0), () => process.exit(1)) })
