import { readFileSync } from 'node:fs'
import test from 'node:test'
import assert from 'node:assert/strict'

const combined = readFileSync('src/renderer/src/components/hospitality-pos/HposSharedShiftClose.jsx', 'utf8')
const drawerCard = readFileSync('src/renderer/src/components/hospitality-pos/HposDrawerMovements.jsx', 'utf8')
const app = readFileSync('src/renderer/src/App.jsx', 'utf8')
const layout = readFileSync('src/renderer/src/components/hospitality-pos/HposLayout.jsx', 'utf8')

test('shared shift-close combines clock in/out and staff cash-up with one name and one PIN', () => {
  assert.match(combined, /Staff shift close/)
  assert.match(combined, /Choose staff member/)
  assert.match(combined, /Staff PIN/)
  assert.match(combined, /clockInStaffWithAttendancePin/)
  assert.match(combined, /clockOutStaffWithAttendancePin/)
  assert.match(combined, /submitCashupWithAttendancePin/)
  assert.match(combined, /getStaffOpenShift/)
  assert.match(combined, /getStaffCashupSubmission/)
  assert.match(combined, /getCashupSubmissionRound/)
  assert.match(combined, /clearCashupSubmissionRound/)
  assert.match(combined, /shared_terminal/)
})

test('shared shift-close allows clock-out without cash-up only when no Till sales exist', () => {
  assert.match(combined, /Clock out without cash-up/)
  assert.match(combined, /No open Till sales found/)
  assert.match(combined, /clock out without a cash-up/)
  // Till-shift cash-up stays mandatory while sales exist: clock-out is gated
  // on the submitted state, matching the server cash-up guard.
  assert.match(combined, /Submit cash-up first/)
  assert.match(combined, /clock-out stays blocked until the cash-up is submitted/)
})

test('shared shift-close preserves blind cash-up and correction notes', () => {
  assert.match(combined, /Cash tips kept/)
  assert.match(combined, /Expected totals and variances are intentionally withheld/)
  assert.match(combined, /Cash-up returned for correction\. Manager note:/)
  assert.match(combined, /Loading this person’s Till shift/)
  assert.doesNotMatch(combined, /expected_cash_drawer/)
})

test('legacy shared routes redirect to the combined screen', () => {
  assert.match(app, /path="hpos\/shift-close"/)
  assert.match(app, /path="hpos\/attendance"/)
  assert.match(app, /path="hpos\/shared-cashup"/)
  assert.match(layout, /route: '\/hpos\/shift-close'/)
  assert.match(layout, /Staff shift close/)
})

test('shared drawer opens without a Till shift on a shared outlet', () => {
  // The drawer is per-outlet, so the Till shift was only ever outlet context:
  // a person on shift with no Till sales gets the drawer card directly.
  assert.match(combined, /showDrawerWithoutTill/)
  assert.match(combined, /outlets\.length === 1/)
  assert.match(combined, /Shared drawer outlet/)
  assert.match(combined, /HposDrawerMovements outletId=\{drawerOutletId\} staffId=\{staffId\} \/>/)
  // Personal outlets keep the old path: no drawer card without a Till shift,
  // and a failed outlet read hides the card instead of guessing.
  assert.match(combined, /drawerOutlet\?\.cash_model === 'shared_drawer'/)
})

test('clock-in keeps the person selected so the drawer prompt follows immediately', () => {
  // First person on shift must not pick their name twice: after clock-in the
  // screen stays on them and the drawer card appears below the notice.
  const start = combined.indexOf('const clockIn = async')
  assert.ok(start >= 0)
  const end = combined.indexOf('const submitCashup = async', start)
  const clockIn = combined.slice(start, end > start ? end : undefined)
  assert.doesNotMatch(clockIn, /setStaffId\(''\)/)
  // The PIN is still cleared: a selected-but-idle terminal cannot move money
  // or close anyone out without re-proving.
  assert.match(clockIn, /setPin\(''\)/)
  assert.match(combined, /Keep the person selected/)
})

test('the drawer card scrolls into view when it appears', () => {
  // The clock-in notice renders at the top while the card sits below the
  // fold: it must come to the operator exactly once on appearance, never on
  // every render.
  assert.match(combined, /drawerAnchorRef/)
  assert.match(combined, /shared-shift-close-drawer-anchor/)
  assert.match(combined, /drawerWasVisibleRef/)
  assert.match(combined, /scrollIntoView/)
  // Settles before scrolling: shift resolution remounts the card, and a
  // scroll mid-remount aborts and reads as down-then-back-up.
  assert.match(combined, /clearTimeout/)
})

test('drawer lives on its own tab with its own operator PIN', () => {
  // The drawer is a separate tab sharing the picked person: the header PIN
  // serves clock-out + cash-up, while each drawer move is proven by an
  // operator PIN entered on the drawer card itself — exactly two PIN fields,
  // each labelled with what it proves.
  assert.match(combined, /Shift & cash-up/)
  assert.match(combined, /role="tablist"/)
  assert.match(combined, /drawerTabAvailable/)
  assert.match(combined, /setActiveTab\('drawer'\)/)
  // Exactly one PIN field per surface, each labelled with what it proves:
  // the header PIN serves clock-out + cash-up, the drawer card PIN serves
  // each money move.
  assert.equal((combined.match(/type="password"/g) || []).length, 1)
  assert.equal((drawerCard.match(/type="password"/g) || []).length, 1)
  assert.match(drawerCard, /Operator Staff PIN/)
  assert.match(combined, /drawer moves ask for the operator PIN on the drawer card itself/)
})
