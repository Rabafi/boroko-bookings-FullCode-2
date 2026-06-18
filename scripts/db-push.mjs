import { execFileSync } from 'child_process'
import { existsSync, readFileSync } from 'fs'
import { resolve } from 'path'

const PROJECT_REF = 'oicgpknsmtvcsjacymum'

function readEnvFileValue(filePath, key) {
  if (!existsSync(filePath)) return ''
  const lines = readFileSync(filePath, 'utf8').split(/\r?\n/)
  for (const line of lines) {
    const trimmed = String(line || '').trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const separatorIndex = trimmed.indexOf('=')
    if (separatorIndex <= 0) continue
    const entryKey = trimmed.slice(0, separatorIndex).trim()
    if (entryKey !== key) continue
    return trimmed.slice(separatorIndex + 1).trim()
  }
  return ''
}

function readTextFile(filePath) {
  if (!existsSync(filePath)) return ''
  return readFileSync(filePath, 'utf8').trim()
}

function connectionUrlWithPassword(connectionUrl, password) {
  const url = new URL(connectionUrl)
  url.password = password
  return url.toString()
}

const password = process.env.SUPABASE_DB_PASSWORD || readEnvFileValue('.env.db', 'SUPABASE_DB_PASSWORD')
if (!password) {
  console.log('⚠️  SUPABASE_DB_PASSWORD not set — skipping migration push.')
  console.log('   Set it: $env:SUPABASE_DB_PASSWORD="your-password" (PowerShell)')
  console.log('   Or:     set SUPABASE_DB_PASSWORD=your-password (cmd)')
  console.log('   Or add: SUPABASE_DB_PASSWORD=your-password to .env.db')
  console.log('   Then run: npm run db:push')
  process.exit(0)
}

const configuredUrl = process.env.SUPABASE_DB_URL
  || process.env.SUPABASE_POOLER_URL
  || readEnvFileValue('.env.db', 'SUPABASE_DB_URL')
  || readEnvFileValue('.env.db', 'SUPABASE_POOLER_URL')
  || readTextFile('supabase/.temp/pooler-url')
  || `postgresql://postgres@db.${PROJECT_REF}.supabase.co:5432/postgres`
const dbUrl = connectionUrlWithPassword(configuredUrl, password)
const connectionLabel = configuredUrl.includes('.pooler.supabase.com') ? 'Supabase pooler' : 'direct database'
const supabaseArgs = ['db', 'push', '--yes', '--db-url', dbUrl]

function runSupabaseCli(args) {
  const localCli = process.platform === 'win32'
    ? resolve('node_modules', 'supabase', 'bin', 'supabase.exe')
    : resolve('node_modules', '.bin', 'supabase')
  const candidates = process.platform === 'win32'
    ? [
        { command: localCli, args },
        { command: process.env.SUPABASE_CLI_BIN || 'supabase.exe', args }
      ]
    : [
        { command: localCli, args },
        { command: process.env.SUPABASE_CLI_BIN || 'supabase', args }
      ]

  let lastError = null
  for (const candidate of candidates) {
    try {
      execFileSync(candidate.command, candidate.args, {
        stdio: 'inherit',
        cwd: process.cwd()
      })
      return
    } catch (error) {
      lastError = error
      if (!['ENOENT', 'EINVAL'].includes(error?.code)) throw error
    }
  }
  throw lastError
}

console.log(`📦 Pushing Supabase migrations via ${connectionLabel}...`)
try {
  runSupabaseCli(supabaseArgs)
  console.log('✅ Migrations pushed successfully.')
} catch (error) {
  console.log('❌ Migration push failed.')
  if (error?.message) console.log(`   ${error.message}`)
  process.exit(1)
}
