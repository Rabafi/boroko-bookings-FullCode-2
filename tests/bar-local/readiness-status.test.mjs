import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const read = (path) => readFileSync(join(root, path), 'utf8')
const accountingUi = read('src/renderer/src/components/restaurant-accounting/RestaurantAccountingUi.jsx')
const localShell = read('src/renderer/src/components/hospitality-pos/LocalBarHposShell.jsx')

test('original Accounting pages wait for current local authority readiness before exposing records', () => {
  assert.match(accountingUi, /window\.api\?\.barLocal\?\.refreshReadiness\?\./)
  assert.match(accountingUi, /result\?\.ready === true/)
  assert.match(accountingUi, /const releaseReady = readiness\?\.active === true && readiness\?\.ready === true && !readiness\?\.error/)
  assert.match(accountingUi, /localAuthorityReady/)
  assert.match(accountingUi, /No Accounting data or action is presented as financially usable/)
})

test('local readiness and addon access stay in the restored original Hpos shell', () => {
  assert.match(localShell, /function LocalBarAddonGate/)
  assert.match(localShell, /window\.api\.barLocal\.query\('bootstrap'/)
  assert.match(localShell, /<Route path="hpos\/setup-readiness" element=\{<HposSetupReadiness \/>\}/)
  assert.doesNotMatch(localShell, /BarLocalWorkspace/)
})
