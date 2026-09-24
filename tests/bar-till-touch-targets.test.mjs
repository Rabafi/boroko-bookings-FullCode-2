import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8')

const terminal = () => read('src/renderer/src/components/hospitality-pos/HposTerminal.jsx')

test('basket quantity and remove controls meet the 44px touch target', () => {
  const source = terminal()
  assert.match(source, /Decrease \$\{line\.item_name\} quantity/)
  assert.match(source, /Increase \$\{line\.item_name\} quantity/)
  assert.match(source, /Remove \$\{line\.item_name\}/)
  const qtySizes = source.match(/width: "44px",\s*\n\s*height: "44px",/g) || []
  assert.ok(qtySizes.length >= 2, `expected +/- buttons at 44px, found ${qtySizes.length}`)
  assert.match(source, /minWidth: "44px",\s*\n\s*height: "44px",/)
})

test('category and service-mode controls meet the 44px touch target', () => {
  const source = terminal()
  assert.match(source, /minHeight: "44px",\s*\n\s*padding: "12px 18px",/)
  assert.match(source, /fontSize: 14,\s*\n\s*fontWeight: 700,/)
  assert.match(source, /minHeight: "44px",\s*\n\s*padding: "10px 14px",/)
  assert.match(source, /aria-pressed=\{activeCategory === category\}/)
  assert.match(source, /aria-pressed=\{serviceMode === mode\.id\}/)
})

test('payment buttons are large primary targets without hover-only behavior', () => {
  const source = terminal()
  const largePay = source.match(/minHeight: "56px",/g) || []
  assert.ok(largePay.length >= 2, `expected Cash/Card/Mobile/Split at 56px, found ${largePay.length}`)
  assert.match(source, /minHeight: "60px",/)
  assert.match(source, /fontSize: "16px",\s*\n\s*fontWeight: 800,/)
  assert.equal(
    /currentTarget\.style\.background = `\$\{pm\.color\}15`/.test(source),
    false,
    'pay-method hover background mutation must not remain',
  )
})

test('product cards have readable labels and no hover-lift trap', () => {
  const source = terminal()
  assert.equal(
    source.includes('e.currentTarget.style.transform = "translateY(-3px)"'),
    false,
    'touch taps must not trigger a sticky hover lift',
  )
  assert.equal(
    source.includes('e.currentTarget.style.opacity = "1"'),
    false,
    'trash opacity hover handlers must not remain',
  )
  // The visible unavailable label stays high-contrast danger text — either
  // the literal hex or the --bb-danger token it equals (#b84a38), quoted
  // as a style-object string value.
  assert.match(
    source,
    /fontSize: "12px",\s*\n\s*fontWeight: 700,\s*\n\s*color: ["']?(?:#b84a38|var\(--bb-danger\))["']?,/,
  )
})

test('keyboard focus stays visible in the Bar product', () => {
  const css = read('src/renderer/src/styles/hospitality-pos.css')
  assert.match(css, /button:focus-visible/)
})

test('search field, favourite star, and charge-to-account meet the 44px touch target', () => {
  const source = terminal()
  assert.match(
    source,
    /minHeight: "44px",\s*\n\s*padding: search \? "10px 92px 10px 32px" : "10px 48px 10px 32px",/,
    'search input must be a 44px-tall touch target with room for clear + keyboard toggles',
  )
  assert.match(
    source,
    /aria-label=\{\s*showSearchKeyboard\s*\?\s*"Hide on-screen search keyboard"/,
    'keyboard toggle must be labelled and exposed via aria-expanded',
  )
  assert.match(source, /aria-expanded=\{showSearchKeyboard\}/)
  assert.match(
    source,
    /width: "44px",\s*\n\s*height: "44px",\s*\n\s*borderRadius: "10px",/,
    'favourite star must be a 44px touch target',
  )
  assert.match(
    source,
    /gridColumn: "1 \/ -1",\s*\n\s*minHeight: "44px",/,
    'charge-to-account button must be a 44px touch target',
  )
  assert.match(
    source,
    /aria-label="Clear search"/,
    'search field needs a clear (X) control when text is present',
  )
})

test('touch-only Sell search has an in-app on-screen keyboard', () => {
  const source = terminal()
  assert.match(source, /const \[showSearchKeyboard, setShowSearchKeyboard\]/)
  assert.match(source, /id="hpos-search-keyboard"/)
  assert.match(source, /role="dialog"/)
  assert.match(source, /aria-label="On-screen search keyboard"/)
  assert.match(source, /SEARCH_KEYBOARD_ROWS/)
  assert.match(
    source,
    /onMouseDown=\{\(e\) => e\.preventDefault\(\)\}/,
    'key taps must not steal focus from the search input (barcode wedge)',
  )
  assert.match(source, /onClose=\{\(\) => setShowSearchKeyboard\(false\)\}|setShowSearchKeyboard\(false\)/)
  // Escape closes the keyboard before clearing the search value.
  assert.match(
    source,
    /if \(showSearchKeyboard\) \{\s*\n\s*setShowSearchKeyboard\(false\);\s*\n\s*return;/,
  )
  // Every on-screen letter/number key is at least 44px tall (one style
  // object is mapped across SEARCH_KEYBOARD_ROWS, plus Space/backspace).
  assert.match(
    source,
    /minHeight: "44px",\s*\n\s*minWidth: 0,/,
    'mapped letter/number keys must be 44px tall and fluid-width',
  )
  const keyboard44 = source.match(/minHeight: "44px",/g) || []
  assert.ok(
    keyboard44.length >= 4,
    `expected search field, toggle, and keyboard chrome at 44px, found ${keyboard44.length}`,
  )
  // Blocking overlays close the keyboard so it never outlives their focus.
  assert.match(
    source,
    /showPayment \|\|\s*\n?\s*showShiftStart \|\|\s*\n?\s*showOperatorUnlock \|\|\s*\n?\s*modifierLineId != null \|\|\s*\n?\s*pendingConfirm != null/,
  )
  // Float on the right so the product grid stays visible while filtering.
  assert.match(source, /left: "auto",\s*\n\s*right: "16px",\s*\n\s*bottom: "16px",/)
  assert.match(
    source,
    /width: "min\(460px, calc\(100vw - 32px\)\)"/,
    'keyboard must float with a bounded width, not full-bleed',
  )
  assert.match(source, /borderRadius: "18px",/)
  // Pointerdown outside the panel (and outside search/toggle/clear) dismisses it.
  assert.match(
    source,
    /document\.addEventListener\("pointerdown", onPointerDown, true\)/,
    'clicking outside the keyboard must close it',
  )
  assert.match(
    source,
    /if \(searchKeyboardRef\.current\?\.contains\(target\)\) return;/,
  )
  assert.match(
    source,
    /if \(target === searchRef\.current\) return;/,
    'search field itself must not dismiss the keyboard mid-type',
  )
  assert.match(
    source,
    /if \(searchKeyboardToggleRef\.current\?\.contains\(target\)\) return;/,
    'toggle must stay clickable without a close/reopen race',
  )
})

test('15-item efficiency batch: receipt CTAs, multi-add, recent strip, pace, nudge, sound', () => {
  const source = terminal()
  const receipt = read('src/renderer/src/components/shared/POSReceipt.jsx')
  // Receipt next-sale CTAs (Till passes both; other callers keep Close alone).
  assert.match(receipt, /onNewSale = null, onRepeatSale = null/)
  assert.match(receipt, /New sale/)
  assert.match(receipt, /Same again/)
  assert.match(source, /onNewSale=\{\(\) =>/)
  assert.match(source, /onRepeatSale=\{\(\) =>/)
  // Receipt close returns focus to the search field (barcode/typing next sale).
  assert.match(
    source,
    /onClose=\{\(\) => \{\s*\n\s*setCompletedReceipt\(null\);\s*\n\s*requestAnimationFrame\(\(\) => searchRef\.current\?\.focus\(\)\);\s*\n\s*\}\}/,
    'closing the receipt must refocus search',
  )
  // Category counts + empty-grid shortcuts to Top sellers / Favourites.
  assert.match(source, /categoryCounts/)
  assert.match(source, /Show top sellers/)
  assert.match(source, /Show favourites/)
  // In-basket qty badge + undo add.
  assert.match(source, /inBasketQty/)
  assert.match(source, /already in basket/)
  assert.match(source, /undoLastAdd/)
  assert.match(source, /Undo/)
  // Multi-add long-press sheet.
  assert.match(source, /onAddQty/)
  assert.match(source, /multiAddItem/)
  assert.match(source, /Add multiple/)
  assert.match(source, /longPressFiredRef/)
  // Recently sold this shift strip.
  assert.match(source, /Recently sold this shift/)
  assert.match(source, /recentSold/)
  assert.match(source, /noteSaleForShift/)
  // Shift pace (device-local sold count on the open-shift pill).
  assert.match(source, /shiftPaceItems/)
  assert.match(source, /\$\{shiftPaceItems\} sold/)
  // Payment idle nudge after 90s.
  assert.match(source, /paymentIdleNudge/)
  assert.match(source, /Payment still open/)
  assert.match(source, /90000/)
  // Optional till sound (default off). Icon-only toggle sits in the top bar
  // next to LiveClock (date/time); Till beeps via the shared module.
  const tillSound = read('src/shared/tillSound.js')
  const nav = read('src/renderer/src/components/hospitality-pos/HposNav.jsx')
  assert.match(tillSound, /hpos-till-sound/)
  assert.match(tillSound, /export function playTillBeep/)
  assert.match(tillSound, /export async function toggleTillSound/)
  assert.match(source, /import \{ playTillBeep \} from "\.\.\/\.\.\/\.\.\/\.\.\/shared\/tillSound"/)
  assert.match(nav, /isTillSoundEnabled/)
  assert.match(nav, /toggleTillSound/)
  assert.match(nav, /Turn till sound/)
  assert.match(nav, /LiveClock/)
  // Icon-only: no "Sound on/off" text label beside the icon.
  assert.doesNotMatch(nav, /Sound on|Sound off/)
  assert.match(nav, /Volume2/)
  assert.match(nav, /VolumeX/)
  // Clear cart refocuses search (item 5).
  assert.match(
    source,
    /applyClearCart[\s\S]{0,400}searchRef\.current\?\.focus/,
    'clear sale must put the caret back in search',
  )
})
