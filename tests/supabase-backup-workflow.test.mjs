import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

const workflowPath = path.resolve('.github/workflows/supabase-backup.yml')
const workflow = await fs.readFile(workflowPath, 'utf8')

const requiredSecrets = [
  'SUPABASE_BACKUP_DB_URL',
  'BACKUP_ENCRYPTION_PUBLIC_KEY_B64',
  'CLOUDFLARE_R2_ACCOUNT_ID',
  'CLOUDFLARE_R2_BUCKET',
  'CLOUDFLARE_R2_ACCESS_KEY_ID',
  'CLOUDFLARE_R2_SECRET_ACCESS_KEY',
]

test('backup preflight names every real GitHub secret and reports all omissions together', () => {
  const preflightStart = workflow.indexOf('      - name: Verify backup secrets')
  const preflightEnd = workflow.indexOf('      - name: Create authoritative Supabase SQL dumps')
  assert.ok(preflightStart >= 0 && preflightEnd > preflightStart)
  const preflight = workflow.slice(preflightStart, preflightEnd)

  for (const secretName of requiredSecrets) {
    assert.match(
      preflight,
      new RegExp(`${secretName}: \\$\\{\\{ secrets\\.${secretName} \\}\\}`),
      `${secretName} must be wired by its actual GitHub secret name`,
    )
    assert.match(preflight, new RegExp(`\\b${secretName}\\b`), `${secretName} must be preflighted`)
  }
  assert.match(preflight, /missing_secrets=\(\)/)
  assert.match(preflight, /missing_secrets\+=\("\$\{secret_name\}"\)/)
  assert.match(preflight, /printf '::error::Missing required GitHub Actions secrets: %s\\n'/)
  assert.match(preflight, /\$\{missing_secrets\[\*\]\}/)
  assert.doesNotMatch(preflight, /Missing required GitHub Actions secret: \$\{?name\}?/)
  assert.doesNotMatch(preflight, /echo\s+"\$\{!?secret_name/) // values must never be logged
})

test('backup observability has scoped permissions, a safe summary, and deduplicated issue alerts', () => {
  assert.match(workflow, /permissions:\s*\n\s+contents: read\s*\n\s+actions: read\s*\n\s+issues: write/)

  const observabilityStart = workflow.indexOf('      - name: Write backup failure summary')
  const cleanupStart = workflow.indexOf('      - name: Remove runner backup material')
  assert.ok(observabilityStart >= 0 && cleanupStart > observabilityStart)
  const observability = workflow.slice(observabilityStart, cleanupStart)

  assert.match(observability, /if: failure\(\)/)
  assert.match(observability, /GITHUB_STEP_SUMMARY/)
  assert.match(observability, /No secret values are included/)
  assert.match(observability, /uses: actions\/github-script@v8/)
  assert.match(observability, /continue-on-error: true/)
  assert.match(observability, /tsa-bonno-supabase-backup-failure/)
  assert.match(observability, /issue\.title === title && issue\.body\?\.includes\(marker\)/)
  assert.match(observability, /github\.rest\.issues\.listForRepo/)
  assert.match(observability, /github\.rest\.issues\.(create|update)/)
  assert.match(observability, /tsa-bonno-supabase-backup-overdue/)
  assert.match(observability, /BACKUP_MAX_AGE_HOURS: '26'/)
  assert.match(observability, /github\.rest\.actions\.listWorkflowRuns/)
  assert.doesNotMatch(observability, /listWorkflowRunsForWorkflow/)
  assert.match(observability, /status: 'completed'/)
  assert.match(observability, /run\.conclusion === 'success'/)
  assert.doesNotMatch(observability, /secrets\./)
  assert.match(workflow, /- name: Retain encrypted GitHub recovery artifact\s+id: artifact_upload/)
  assert.match(workflow, /BACKUP_SUCCEEDED: \$\{\{ steps\.backup_gate\.outcome == 'success' \}\}/)
  assert.doesNotMatch(workflow, /Google Drive|GOOGLE_DRIVE|google-drive/i)
})

test('runner cleanup remains unconditional and removes plaintext and encrypted temporary material', () => {
  const cleanupStart = workflow.indexOf('      - name: Remove runner backup material')
  assert.ok(cleanupStart >= 0)
  const cleanup = workflow.slice(cleanupStart)
  assert.match(cleanup, /if: always\(\)/)
  assert.match(cleanup, /supabase-backup-\*/)
  assert.match(cleanup, /tsa-bonno-supabase-\*/)
  assert.match(cleanup, /backup-public\.pem/)
})

test('whole-project recovery is encrypted, isolated, and wired to a dedicated R2 prefix', () => {
  assert.match(workflow, /BACKUP_RECOVERY_R2_PREFIX: tsa-bonno\/supabase\/whole-project\//)
  const buildStart = workflow.indexOf('      - name: Build encrypted whole-project recovery bundle')
  const artifactStart = workflow.indexOf('      - name: Retain encrypted whole-project recovery artifact')
  const r2Start = workflow.indexOf('      - name: Upload encrypted whole-project recovery bundle to Cloudflare R2')
  const failureStart = workflow.indexOf('      - name: Write backup failure summary')
  assert.ok(buildStart >= 0 && artifactStart > buildStart && r2Start > artifactStart && failureStart > r2Start)

  const build = workflow.slice(buildStart, artifactStart)
  const artifact = workflow.slice(artifactStart, r2Start)
  const r2 = workflow.slice(r2Start, failureStart)
  assert.match(build, /SUPABASE_BACKUP_DB_URL: \$\{\{ secrets\.SUPABASE_BACKUP_DB_URL \}\}/)
  assert.match(build, /BACKUP_ENCRYPTION_PUBLIC_KEY_B64: \$\{\{ secrets\.BACKUP_ENCRYPTION_PUBLIC_KEY_B64 \}\}/)
  assert.match(build, /node scripts\/supabase-whole-project-recovery\.mjs/)
  assert.match(build, /supabase-whole-project-output/)
  assert.match(build, /encrypted_path=/)
  assert.doesNotMatch(build, /SUPABASE_ACCESS_TOKEN|SUPABASE_AUTH|SUPABASE_FUNCTION_SECRET|CLOUDFLARE_R2_SECRET_ACCESS_KEY/)

  assert.match(artifact, /uses: actions\/upload-artifact@v6/)
  assert.match(artifact, /steps\.recovery_bundle\.outputs\.encrypted_path/)
  assert.match(artifact, /compression-level: 0/)

  assert.match(r2, /CLOUDFLARE_R2_SECRET_ACCESS_KEY: \$\{\{ secrets\.CLOUDFLARE_R2_SECRET_ACCESS_KEY \}\}/)
  assert.match(r2, /BACKUP_R2_PREFIX: \$\{\{ env\.BACKUP_RECOVERY_R2_PREFIX \}\}/)
  assert.match(r2, /node scripts\/r2-backup\.mjs \"\$\{\{ steps\.recovery_bundle\.outputs\.encrypted_path \}\}\"/)
  assert.doesNotMatch(r2, /SUPABASE_BACKUP_DB_URL|BACKUP_ENCRYPTION_PUBLIC_KEY_B64/)

  assert.match(workflow, /RECOVERY_BUNDLE_OUTCOME: \$\{\{ steps\.recovery_bundle\.outcome \}\}/)
  assert.match(workflow, /RECOVERY_ARTIFACT_OUTCOME: \$\{\{ steps\.recovery_artifact_upload\.outcome \}\}/)
  assert.match(workflow, /RECOVERY_R2_OUTCOME: \$\{\{ steps\.recovery_r2_upload\.outcome \}\}/)
  assert.match(workflow, /supabase-whole-project-output/)
})

test('Storage failure remains fatal but does not skip whole-project recovery', () => {
  const storageStart = workflow.indexOf('      - name: Back up and certify encrypted Supabase Storage')
  const recoveryStart = workflow.indexOf('      - name: Build encrypted whole-project recovery bundle')
  const gateStart = workflow.indexOf('      - name: Enforce complete backup success')
  const summaryStart = workflow.indexOf('      - name: Write backup failure summary')
  assert.ok(storageStart >= 0 && recoveryStart > storageStart && gateStart > recoveryStart && summaryStart > gateStart)

  const storage = workflow.slice(storageStart, recoveryStart)
  const gate = workflow.slice(gateStart, summaryStart)
  assert.match(storage, /id: storage_backup\s+continue-on-error: true/)
  assert.match(gate, /id: backup_gate\s+if: always\(\)/)
  assert.match(gate, /STORAGE_BACKUP_OUTCOME: \$\{\{ steps\.storage_backup\.outcome \}\}/)
  assert.match(gate, /RECOVERY_R2_OUTCOME: \$\{\{ steps\.recovery_r2_upload\.outcome \}\}/)
  assert.match(gate, /require_success 'storage-backup'/)
  assert.match(gate, /require_success 'whole-project-r2'/)
  assert.match(gate, /Supabase backup incomplete:/)
  assert.match(gate, /exit 1/)
})

test('backup workflow uses Node 24 action releases', () => {
  assert.equal(workflow.match(/uses: actions\/upload-artifact@v6/g)?.length, 2)
  assert.equal(workflow.match(/uses: actions\/github-script@v8/g)?.length, 2)
  assert.doesNotMatch(workflow, /uses: actions\/(?:upload-artifact@v4|github-script@v7)/)
})
