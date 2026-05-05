import { execSync } from 'child_process'

const password = process.env.SUPABASE_DB_PASSWORD
if (!password) {
  console.log('⚠️  SUPABASE_DB_PASSWORD not set — skipping migration push.')
  console.log('   Set it: $env:SUPABASE_DB_PASSWORD="your-password" (PowerShell)')
  console.log('   Or:     set SUPABASE_DB_PASSWORD=your-password (cmd)')
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
