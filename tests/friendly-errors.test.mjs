import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { friendlyErrorMessage } from '../src/renderer/src/components/shared/friendlyError.js'

test('database permission denials become plain recovery guidance', () => {
  const message = friendlyErrorMessage('permission denied for function clock_out_staff_with_attendance_pin')
  assert.doesNotMatch(message, /clock_out_staff_with_attendance_pin/)
  assert.doesNotMatch(message, /permission denied/i)
  assert.match(message, /kept|keeps/i)
})

test('transport wrapping is peeled before classification', () => {
  assert.match(
    friendlyErrorMessage(`Error invoking remote method 'pos:clockOut': fetch failed`),
    /no connection|offline|internet/i,
  )
  assert.match(friendlyErrorMessage('canceling statement due to statement timeout'), /stopped safely|try again/i)
  assert.match(
    friendlyErrorMessage('duplicate key value violates unique constraint "pos_orders_key"'),
    /already recorded/i,
  )
  assert.match(
    friendlyErrorMessage('update or delete violates foreign key "fk_shift"'),
    /still in use/i,
  )
})

test('friendly messages and useful specifics pass through untouched', () => {
  assert.equal(friendlyErrorMessage('Submit My Cash-up before clocking out.'), 'Submit My Cash-up before clocking out.')
  assert.equal(friendlyErrorMessage('Incorrect staff PIN.'), 'Incorrect staff PIN.')
  assert.equal(
    friendlyErrorMessage('Cash-up P25.00 submitted for review, ref A1B2C3.'),
    'Cash-up P25.00 submitted for review, ref A1B2C3.',
  )
  assert.equal(friendlyErrorMessage(''), 'Something did not work. Try again.')
  assert.equal(friendlyErrorMessage(null), 'Something did not work. Try again.')
})

test('the shared banners apply plain language automatically', () => {
  const notice = readFileSync('src/renderer/src/components/shared/ErrorNotice.jsx', 'utf8')
  const hposUi = readFileSync('src/renderer/src/components/hospitality-pos/HposUi.jsx', 'utf8')
  assert.match(notice, /friendlyErrorMessage/)
  assert.match(notice, /typeof children === 'string'/)
  // Every HposNotice error already routes through the shared banner.
  assert.match(hposUi, /ErrorNotice/)
  assert.match(hposUi, /tone === 'error'/)
})
