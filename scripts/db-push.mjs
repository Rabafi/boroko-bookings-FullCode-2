import { execSync } from 'child_process'
import { existsSync, readFileSync } from 'fs'

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

const password = process.env.SUPABASE_DB_PASSWORD || readEnvFileValue('.env.db', 'SUPABASE_DB_PASSWORD')
if (!password) {
  console.log('⚠️  SUPABASE_DB_PASSWORD not set — skipping migration push.')
  console.log('   Set it: $env:SUPABASE_DB_PASSWORD="your-password" (PowerShell)')
  console.log('   Or:     set SUPABASE_DB_PASSWORD=your-password (cmd)')
  console.log('   Or add: SUPABASE_DB_PASSWORD=your-password to .env.db')
  console.log('   Then run: npm run db:push')
  process.exit(0)
}

const dbUrl = `postgresql://postgres:${password}@db.oicgpknsmtvcsjacymum.supabase.co:5432/postgres`

console.log('📦 Pushing Supabase migrations...')
try {
  execSync(`npx supabase db push --db-url "${dbUrl}"`, { stdio: 'inherit', cwd: process.cwd() })
  console.log('✅ Migrations pushed successfully.')
} catch {
  console.log('❌ Migration push failed.')
  process.exit(1)
}
