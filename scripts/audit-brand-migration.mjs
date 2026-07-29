#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')
const jsonMode = process.argv.includes('--json')
const strictMode = process.argv.includes('--strict')

const ignoredDirectories = new Set([
  '.git',
  '.claude',
  '.codex-temp',
  '.tmp',
  'node_modules',
  'out',
  'dist',
  'release',
  'test-results',
  'playwright-report',
  'coverage'
])

const ignoredExtensions = new Set([
  '.7z', '.avi', '.bin', '.bmp', '.docx', '.exe', '.gif', '.ico', '.jpeg', '.jpg',
  '.lock', '.mov', '.mp3', '.mp4', '.pdf', '.png', '.svgz', '.webm', '.webp', '.xlsx', '.zip'
])

const legacyPatterns = [
  { key: 'boroko-title', expression: /Boroko/g },
  { key: 'boroko-lower', expression: /boroko/g },
  { key: 'boroko-upper', expression: /BOROKO/g },
  { key: 'lodge-camp-label', expression: /Lodge\s*&\s*Camp/g },
  { key: 'hotel-label', expression: /Boroko\s+Hotel/g },
  { key: 'restaurant-pos-label', expression: /Boroko\s+Restaurant\s*&\s*Bar\s+POS/g },
  { key: 'hospitality-pos-label', expression: /Hospitality[ -]POS/g }
]

function normalize(relativePath) {
  return relativePath.split(path.sep).join('/')
}

function shouldIgnoreDirectory(name) {
  return ignoredDirectories.has(name) || name.startsWith('dist-')
}

function collectFiles(directory, files = []) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && shouldIgnoreDirectory(entry.name)) continue
    const absolutePath = path.join(directory, entry.name)
    if (entry.isDirectory()) collectFiles(absolutePath, files)
    else if (entry.isFile() && !ignoredExtensions.has(path.extname(entry.name).toLowerCase())) files.push(absolutePath)
  }
  return files
}

function classify(relativePath, line) {
  if (relativePath.startsWith('supabase/migrations/') || relativePath.startsWith('supabase/migrations_archive/')) {
    return 'database-history-review'
  }
  if (relativePath.startsWith('tests/') || relativePath.startsWith('Playwright tests/')) return 'test-contract'
  if (relativePath.startsWith('docs/') || /(^|\/)(README|CHANGELOG|PROJECT_STATE|AGENTS|NEW_PC_SETUP_AND_MIGRATION)\.md$/i.test(relativePath)) {
    return 'documentation'
  }
  if (/electron-builder|package\.json$|product\.json$|latest\.ya?ml$|release/i.test(relativePath)) {
    return 'installer-update-identity'
  }
  if (/netlify|vercel|\.github|sitemap|robots|manifest/i.test(relativePath)) return 'deployment-metadata'
  if (/https?:\/\/|github\.com|netlify\.app|vercel\.app|supabase\.co/i.test(line)) return 'external-reference'
  if (/appId|product_family|database_product|BOROKO_PRODUCT|hospitality_pos|lodge_camp|lodge-camp|hospitality-pos/i.test(line)) {
    return 'compatibility-identifier'
  }
  if (relativePath.startsWith('marketing-site/') || relativePath.startsWith('booking-site/')) return 'public-copy'
  if (relativePath.startsWith('src/') || relativePath.startsWith('manager-pwa/') || relativePath.startsWith('legacy-pos/')) {
    return 'application-copy-or-code'
  }
  return 'manual-review'
}

const liveExternalReference = /(?:borokobookings\.com|borokobookings\.netlify\.app|borokoonlinebookings\.netlify\.app|boroko-bookings\.vercel\.app|(?:facebook|instagram)\.com\/borokobookings|linkedin\.com\/company\/borokobookings|@borokobookings|support@boroko\.io|github\.com\/[^\s"']*boroko|Rabafi\/boroko)/i
const compatibilityContract = /(?:\b(?:MAIN_VITE_)?BOROKO_[A-Z0-9_]+\b|__BOROKO_PRODUCT__|x-boroko(?:-[a-z0-9-]+)?|com\.boroko\.[a-z0-9.]+|BorokoSession|boroko(?:[-_.:]|_)(?:bookings?|hotel|hospitality|legacy|manager|pwa|desktop|mesh|cache|session|enterprise|upgrade|crm|cookie|local|ai|push|chat|last|installed|dev|pending|backups)|boroko_mesh_hello|Boroko Restaurant & Bar POS Dev Desk|boroko-bookings-releases|boroko-hotel-releases|boroko-hospitality-pos-releases|boroko-pos-legacy-releases)/i
const localEvidencePath = /^(?:scratch\/|tmp[^/]*\.log$|.*\.err\.log$|generate_(?:qa_)?pdf\.py$|build\/|electron\.vite\.config\.\d+\.mjs$|AUDIT_REPORT\.md$|COMMAND_CENTRAL_REPORT\.md$|todo\.txt$)/i

function resolveDisposition(relativePath, line, classification) {
  if (relativePath === 'supabase/.temp/linked-project.json') {
    return {
      disposition: 'pending-authenticated-external-rename',
      rationale: 'This linked-project cache mirrors the current Supabase dashboard display name and clears only after an authenticated owner update.'
    }
  }
  if (relativePath.startsWith('supabase/migrations/') || relativePath.startsWith('supabase/migrations_archive/')) {
    return {
      disposition: 'retained-immutable-history',
      rationale: 'Applied or archived database history must remain byte-truthful; forward migrations carry the new public labels.'
    }
  }
  if (liveExternalReference.test(line)) {
    return {
      disposition: 'retained-live-external-endpoint',
      rationale: 'The endpoint, mailbox, social handle, domain, or repository is currently live and remains until a replacement plus redirect or updater bridge exists.'
    }
  }
  if (compatibilityContract.test(line)) {
    return {
      disposition: 'retained-compatibility-contract',
      rationale: 'Changing this app id, protocol/header, environment key, storage/cache key, package key, or updater identity would break installed clients or integrations.'
    }
  }
  if (relativePath === 'manager-pwa/public/sw.js' && line.includes("LEGACY_PUSH_TAG = 'boroko'")) {
    return {
      disposition: 'retained-compatibility-contract',
      rationale: 'The pre-rename push tag remains accepted so queued notifications preserve deduplication behavior.'
    }
  }
  if (localEvidencePath.test(relativePath)) {
    return {
      disposition: 'retained-local-evidence',
      rationale: 'Local diagnostic, scratch, generated, or historical evidence is not shipped customer-facing branding.'
    }
  }
  if (classification === 'test-contract') {
    return {
      disposition: 'retained-test-contract',
      rationale: 'The test names or asserts a deliberately retained compatibility contract or historical migration behavior.'
    }
  }
  if (relativePath.startsWith('legacy-pos/tests/') && line.includes('migration.includes(')) {
    return {
      disposition: 'retained-test-contract',
      rationale: 'The assertion intentionally verifies immutable historical migration text.'
    }
  }
  if (classification === 'documentation') {
    return {
      disposition: 'retained-documented-history',
      rationale: 'The document records former-brand history, compatibility identities, migration evidence, or a dated audit/plan.'
    }
  }
  if (classification === 'installer-update-identity') {
    return {
      disposition: 'retained-installer-update-bridge',
      rationale: 'The internal package name, app id, release repository, or historical release artifact remains for safe in-place updates.'
    }
  }
  if (classification === 'deployment-metadata') {
    return {
      disposition: 'retained-deployment-compatibility',
      rationale: 'The existing deployment site id, hostname, redirect, or generated deployment linkage remains active during the domain transition.'
    }
  }
  if (/\bboroko\b/i.test(line) && /(?:malod[zž]ana|sistimi|dipeeletso|lot[sš]ha)/i.test(line)) {
    return {
      disposition: 'retained-language-content',
      rationale: 'This is ordinary Setswana prose rather than the former product name.'
    }
  }
  return {
    disposition: 'unresolved',
    rationale: 'No approved compatibility, history, external-endpoint, language, or evidence rule accounts for this reference.'
  }
}

const findings = []
for (const absolutePath of collectFiles(root)) {
  const relativePath = normalize(path.relative(root, absolutePath))
  if (relativePath === 'scripts/audit-brand-migration.mjs') continue
  let content
  try {
    content = fs.readFileSync(absolutePath, 'utf8')
  } catch {
    continue
  }
  if (content.includes('\u0000')) continue

  for (const [index, line] of content.split(/\r?\n/).entries()) {
    for (const pattern of legacyPatterns) {
      pattern.expression.lastIndex = 0
      const matches = [...line.matchAll(pattern.expression)]
      if (matches.length === 0) continue
      const classification = classify(relativePath, line)
      findings.push({
        file: relativePath,
        line: index + 1,
        pattern: pattern.key,
        occurrences: matches.length,
        classification,
        ...resolveDisposition(relativePath, line, classification),
        preview: line.trim().slice(0, 240)
      })
    }
  }
}

const byClassification = Object.fromEntries(
  [...new Set(findings.map((finding) => finding.classification))]
    .sort()
    .map((classification) => [
      classification,
      findings.filter((finding) => finding.classification === classification).reduce((sum, finding) => sum + finding.occurrences, 0)
    ])
)

const byDisposition = Object.fromEntries(
  [...new Set(findings.map((finding) => finding.disposition))]
    .sort()
    .map((disposition) => [
      disposition,
      findings.filter((finding) => finding.disposition === disposition).reduce((sum, finding) => sum + finding.occurrences, 0)
    ])
)

const report = {
  generatedAt: new Date().toISOString(),
  root,
  scannedFiles: collectFiles(root).length,
  filesWithFindings: new Set(findings.map((finding) => finding.file)).size,
  totalOccurrences: findings.reduce((sum, finding) => sum + finding.occurrences, 0),
  byClassification,
  byDisposition,
  unresolvedOccurrences: findings
    .filter((finding) => finding.disposition === 'unresolved')
    .reduce((sum, finding) => sum + finding.occurrences, 0),
  blockingOccurrences: findings
    .filter((finding) => finding.disposition === 'unresolved' || finding.disposition.startsWith('pending-'))
    .reduce((sum, finding) => sum + finding.occurrences, 0),
  findings
}

if (jsonMode) {
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
} else {
  console.log(`Scanned files: ${report.scannedFiles}`)
  console.log(`Files with legacy brand references: ${report.filesWithFindings}`)
  console.log(`Legacy brand occurrences: ${report.totalOccurrences}`)
  for (const [classification, count] of Object.entries(byClassification)) {
    console.log(`${classification}: ${count}`)
  }
  console.log('\nDispositions:')
  for (const [disposition, count] of Object.entries(byDisposition)) {
    console.log(`${disposition}: ${count}`)
  }
  console.log(`unresolved occurrences: ${report.unresolvedOccurrences}`)
  console.log(`blocking occurrences: ${report.blockingOccurrences}`)
  console.log('\nUse --json for the complete file-and-line inventory. Use --strict to fail when unresolved references remain.')
}

if (strictMode && report.blockingOccurrences > 0) process.exitCode = 1
