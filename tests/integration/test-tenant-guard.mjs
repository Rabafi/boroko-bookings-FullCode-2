import fs from 'node:fs'
import path from 'node:path'

/**
 * Phase 0 integration-test safety contract.
 *
 * This module is deliberately independent of the application runtime. It is
 * safe to import from a unit test without loading .env, starting Supabase, or
 * opening a network connection. The seed/reset CLI loads .env explicitly and
 * passes the resulting values to these guards before it creates a client.
 */

export const TEST_TENANT_FLAG = 'BOROKO_TEST_TENANT'
export const TEST_LODGE_ENV_KEYS = [
  'BOROKO_TEST_LODGE_ID',
  'TEST_LODGE_ID',
  'SQL_USAGE_TEST_LODGE_ID'
]
export const PRODUCTION_URL_ENV_KEYS = [
  'BOROKO_PRODUCTION_SUPABASE_URLS',
  'BOROKO_KNOWN_PRODUCTION_SUPABASE_URLS'
]
export const PRODUCTION_LODGE_ENV_KEYS = [
  'BOROKO_PRODUCTION_LODGE_IDS',
  'BOROKO_KNOWN_PRODUCTION_LODGE_IDS'
]

// This is the Supabase project currently configured by the checked-in local
// .env. Keep it blocked even when a caller accidentally sets the opt-in flag.
// Additional production projects/lodges can be supplied through the explicit
// BOROKO_PRODUCTION_* environment variables below without committing secrets.
export const KNOWN_PRODUCTION_SUPABASE_HOSTS = Object.freeze([
  'oicgpknsmtvcsjacymum.supabase.co'
])

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const TRUE_VALUES = new Set(['true', '1', 'yes'])
const RESET_CONFIRMATION = 'RESET TEST DATA'
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1'])

function valueOf(env, name) {
  const value = env?.[name]
  return typeof value === 'string' ? value.trim() : ''
}

function firstValue(env, names) {
  for (const name of names) {
    const value = valueOf(env, name)
    if (value) return value
  }
  return ''
}

export function parseCsv(value) {
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean)
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}

export function isTestTenantOptedIn(env = process.env) {
  return TRUE_VALUES.has(valueOf(env, TEST_TENANT_FLAG).toLowerCase())
}

export function resolveSupabaseUrl(env = process.env) {
  return firstValue(env, ['SUPABASE_URL', 'VITE_SUPABASE_URL'])
}

export function resolveTestLodgeId(env = process.env) {
  return firstValue(env, TEST_LODGE_ENV_KEYS)
}

function parseUrl(rawUrl) {
  try {
    const parsed = new URL(rawUrl)
    return parsed
  } catch {
    throw new Error('The integration target Supabase URL is not a valid URL.')
  }
}

function normalizedUrl(rawUrl) {
  const parsed = parseUrl(rawUrl)
  const pathname = parsed.pathname.replace(/\/+$/, '')
  return `${parsed.protocol}//${parsed.host}${pathname}${parsed.search}${parsed.hash}`
}

function normalizedOrigin(rawUrl) {
  const parsed = parseUrl(rawUrl)
  return parsed.origin.toLowerCase()
}

export function isLocalSupabaseHost(hostname) {
  return LOCAL_HOSTS.has(String(hostname || '').toLowerCase())
}

export function isUuid(value) {
  return UUID_RE.test(String(value || '').trim())
}

function productionUrlSet(env, additionalUrls = []) {
  const urls = [
    ...PRODUCTION_URL_ENV_KEYS.flatMap((name) => parseCsv(valueOf(env, name))),
    ...parseCsv(additionalUrls)
  ]
  const origins = new Set()
  const hosts = new Set(KNOWN_PRODUCTION_SUPABASE_HOSTS)
  for (const rawUrl of urls) {
    try {
      const parsed = parseUrl(rawUrl)
      origins.add(parsed.origin.toLowerCase())
      hosts.add(parsed.hostname.toLowerCase())
    } catch {
      // Invalid entries are reported by assertDisposableTarget rather than
      // being silently treated as a safe target.
    }
  }
  return { origins, hosts, urls }
}

function productionLodgeSet(env, additionalLodgeIds = []) {
  return new Set([
    ...PRODUCTION_LODGE_ENV_KEYS.flatMap((name) => parseCsv(valueOf(env, name))),
    ...parseCsv(additionalLodgeIds)
  ].map((id) => id.toLowerCase()))
}

/**
 * Fail closed unless the caller has explicitly selected a disposable test
 * tenant. This must run before a Supabase client is created or any mutation is
 * attempted.
 */
export function assertDisposableTarget(env = process.env, options = {}) {
  const errors = []
  const testFlag = valueOf(env, TEST_TENANT_FLAG)
  const rawUrl = resolveSupabaseUrl(env)
  const lodgeId = resolveTestLodgeId(env)
  let parsedUrl = null

  if (!TRUE_VALUES.has(testFlag.toLowerCase())) {
    errors.push(`${TEST_TENANT_FLAG}=true is required; refusing to use a customer or production tenant.`)
  }

  if (!rawUrl) {
    errors.push('Set SUPABASE_URL or VITE_SUPABASE_URL to the disposable test backend.')
  } else {
    try {
      parsedUrl = parseUrl(rawUrl)
      const isLocal = isLocalSupabaseHost(parsedUrl.hostname)
      if (parsedUrl.protocol !== 'https:' && !isLocal) {
        errors.push('The integration backend must use HTTPS, except for an explicitly local Supabase stack.')
      }
      if (!parsedUrl.hostname.toLowerCase().endsWith('supabase.co') && !isLocal) {
        errors.push('The integration backend host must be a Supabase project or a local Supabase stack.')
      }
    } catch (error) {
      errors.push(error.message)
    }
  }

  if (!lodgeId) {
    errors.push('Set BOROKO_TEST_LODGE_ID (outside .env) to the dedicated disposable lodge UUID.')
  } else if (!isUuid(lodgeId)) {
    errors.push('BOROKO_TEST_LODGE_ID must be a UUID.')
  }

  const production = productionUrlSet(env, options.productionUrls)
  const productionLodges = productionLodgeSet(env, options.productionLodgeIds)
  if (parsedUrl) {
    const host = parsedUrl.hostname.toLowerCase()
    if (production.hosts.has(host) || production.origins.has(parsedUrl.origin.toLowerCase())) {
      errors.push('The selected Supabase backend is a known production backend; choose an isolated test project.')
    }
  }
  if (lodgeId && productionLodges.has(lodgeId.toLowerCase())) {
    errors.push('The selected lodge ID is listed as production; choose a dedicated disposable lodge.')
  }

  if (valueOf(env, 'NODE_ENV').toLowerCase() === 'production') {
    errors.push('Integration tests cannot run with NODE_ENV=production.')
  }

  if (errors.length > 0) {
    throw new Error(`Integration target rejected:\n- ${errors.join('\n- ')}`)
  }

  return Object.freeze({
    url: normalizedUrl(rawUrl),
    origin: normalizedOrigin(rawUrl),
    host: parsedUrl.hostname.toLowerCase(),
    lodgeId
  })
}

export function requireServiceRoleKey(env = process.env) {
  const key = valueOf(env, 'SUPABASE_SERVICE_ROLE_KEY')
  if (!key) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY must be set in the process environment; never place it in .env or source control.')
  }
  return key
}

export function requireResetConfirmation({ env = process.env, confirmed = false } = {}) {
  const envConfirmation = valueOf(env, 'BOROKO_TEST_RESET_CONFIRMATION')
  if (confirmed || envConfirmation === RESET_CONFIRMATION) return RESET_CONFIRMATION
  throw new Error(`Reset is destructive and requires --confirm-reset or BOROKO_TEST_RESET_CONFIRMATION="${RESET_CONFIRMATION}".`)
}

export function redactSecrets(message) {
  return String(message || '')
    .replace(/Bearer\s+[A-Za-z0-9._~-]+/gi, 'Bearer [REDACTED]')
    .replace(/(service[_-]?role|anon|secret|token|password|api[_-]?key)\s*[:=]\s*[^\s,;]+/gi, '$1=[REDACTED]')
    .replace(/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, '[REDACTED_JWT]')
  // Do not include raw environment values in errors or diagnostics.
}

export function formatSafeTarget(target) {
  const lodgeSuffix = target?.lodgeId ? String(target.lodgeId).slice(0, 8) : 'unknown'
  return `${target?.host || 'unknown'} / lodge ${lodgeSuffix}…`
}

/**
 * Tiny .env reader used only by the test CLI. Process environment values are
 * merged over file values, so CI or a one-shot command can safely override the
 * checked-in BOROKO_TEST_TENANT=false default without modifying .env.
 */
export function readEnvFile(filePath) {
  const result = {}
  if (!filePath) return result
  let raw
  try {
    raw = fs.readFileSync(filePath, 'utf8')
  } catch {
    return result
  }
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/)
    if (!match) continue
    let value = match[2].trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    result[match[1]] = value
  }
  return result
}

export function loadTestEnv({ cwd = process.cwd(), envFile = '.env', env = process.env } = {}) {
  const filePath = path.isAbsolute(envFile) ? envFile : path.resolve(cwd, envFile)
  return Object.freeze({ ...readEnvFile(filePath), ...env })
}

export const RESET_DATA_CONFIRMATION = RESET_CONFIRMATION
