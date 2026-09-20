import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import assert from 'node:assert/strict'

const here = dirname(fileURLToPath(import.meta.url))
const renderer = resolve(here, '../src/renderer/src')
const componentsDir = join(renderer, 'components')
const displayPath = (file) => relative(componentsDir, file).split(sep).join('/')

function walkJsx(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) walkJsx(full, out)
    else if (/\.jsx$/.test(entry.name)) out.push(full)
  }
  return out
}

// Files whose only `{*error* && ...}` renders are deliberately NOT shared
// banners: amber warning callouts (guidance, not failures) or an inline
// message sitting directly under the button that caused it.
const SHARED_PATH_SKIP = new Set([
  'Calendar.jsx',
  'EnterpriseWorkflowWorkspace.jsx',
  'fnb/FnbConsolidatedReport.jsx',
  'fnb/FnbDemandPlanning.jsx',
  'fnb/FnbModulePanel.jsx',
  'fnb/FnbTodayView.jsx',
  'hospitality-pos/HposManageHub.jsx',
  'hotel/VenueManagement.jsx',
  'restaurant/RestaurantFinanceOverview.jsx',
])

const SHARED_REFS = ['ErrorNotice', 'HposNotice', 'AccountingNotice', 'errorAnchorRef', 'useErrorAnchor']

test('every conditional error render uses the shared visible-error path', () => {
  const offenders = []
  for (const file of walkJsx(join(renderer, 'components'))) {
    const text = readFileSync(file, 'utf8')
    if (!/\{\s*[A-Za-z]*[Ee]rror\w*\s*&&/.test(text)) continue
    if (SHARED_REFS.some((ref) => text.includes(ref))) continue
    offenders.push(displayPath(file))
  }
  const unexpected = offenders.filter((file) => !SHARED_PATH_SKIP.has(file))
  assert.deepEqual(unexpected, [], `error banners without the shared visible-error path: ${unexpected.join(', ')}`)
  for (const file of SHARED_PATH_SKIP) {
    assert.ok(existsSync(join(componentsDir, file)), `skip-listed file still exists: ${file}`)
  }
})

test('no bare hpos-inline-error divs remain; shared banners own that class', () => {
  const bare = []
  for (const file of walkJsx(join(renderer, 'components'))) {
    const text = readFileSync(file, 'utf8')
    if (/<div className="hpos-inline-error"/.test(text)) {
      bare.push(displayPath(file))
    }
  }
  assert.deepEqual(bare, [], `bare hpos-inline-error divs (use HposNotice/ErrorNotice): ${bare.join(', ')}`)
})

test('every ErrorNotice import resolves to the shared component', () => {
  const target = join(renderer, 'components/shared/ErrorNotice.jsx')
  assert.ok(existsSync(target), 'shared ErrorNotice exists')
  const bad = []
  for (const file of walkJsx(join(renderer, 'components'))) {
    const text = readFileSync(file, 'utf8')
    for (const match of text.matchAll(/from\s+['"]([^'"]*ErrorNotice)['"]/g)) {
      const resolved = resolve(dirname(file), match[1])
      const withExt = resolved.endsWith('.jsx') ? resolved : `${resolved}.jsx`
      if (withExt !== target) bad.push(`${file}: ${match[1]}`)
    }
  }
  assert.deepEqual(bad, [], `ErrorNotice imports outside the shared component: ${bad.join(', ')}`)
})

test('error primitives route failures through the shared banner', () => {
  const notice = readFileSync(join(renderer, 'components/shared/ErrorNotice.jsx'), 'utf8')
  assert.match(notice, /scrollIntoView\(\{ behavior: 'smooth', block: 'nearest' \}\)/)
  assert.match(notice, /closest\('\[role="dialog"\], \.hpos-modal-backdrop'\)/)
  assert.match(notice, /scrollInDialog = false/)
  assert.match(notice, /tabIndex=\{-1\}/)
  assert.match(notice, /friendlyErrorMessage/)
  const hposUi = readFileSync(join(renderer, 'components/hospitality-pos/HposUi.jsx'), 'utf8')
  assert.match(hposUi, /if \(tone === 'error'\)/)
  assert.match(hposUi, /<ErrorNotice className="hpos-inline-error"/)
  const accountingUi = readFileSync(join(renderer, 'components/restaurant-accounting/RestaurantAccountingUi.jsx'), 'utf8')
  assert.match(accountingUi, /if \(type === 'error'\)/)
  assert.match(accountingUi, /<ErrorNotice/)
})
