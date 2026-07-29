import { readFileSync } from 'node:fs'
import test from 'node:test'
import assert from 'node:assert/strict'

const app = readFileSync('src/renderer/src/App.jsx', 'utf8')
const layout = readFileSync('src/renderer/src/components/hospitality-pos/HposLayout.jsx', 'utf8')
const myShift = readFileSync('src/renderer/src/components/hospitality-pos/HposMyShift.jsx', 'utf8')
const myCashup = readFileSync('src/renderer/src/components/hospitality-pos/HposMyCashup.jsx', 'utf8')
const posDomain = readFileSync('src/main/domains/pos.js', 'utf8')
const posCashupSql = readFileSync('supabase/migrations/20260715017000_pos_cashup_submission_review.sql', 'utf8')
const attendanceHandoffSql = readFileSync('supabase/migrations/20260715019000_restaurant_attendance_cashup_handoff.sql', 'utf8')
const selfAttendanceSql = readFileSync('supabase/migrations/20260715020000_restaurant_self_attendance_on_till_start.sql', 'utf8')
const cashTipRetentionSql = readFileSync('supabase/migrations/20260715021000_cash_tip_retention_cashup.sql', 'utf8')
const cashClose = readFileSync('src/renderer/src/components/hospitality-pos/HposCashClose.jsx', 'utf8')
const sharedCashup = readFileSync('src/renderer/src/components/hospitality-pos/HposSharedCashup.jsx', 'utf8')
const cashupRejectionSql = readFileSync('supabase/migrations/20260715027000_cashup_rejection_note_required.sql', 'utf8')
const cashupManagerPinSql = readFileSync('supabase/migrations/20260715029000_cashup_review_manager_pin.sql', 'utf8')
const terminal = readFileSync('src/renderer/src/components/hospitality-pos/HposTerminal.jsx', 'utf8')
const tillOperatorDialog = readFileSync('src/renderer/src/components/hospitality-pos/HposTillOperatorDialog.jsx', 'utf8')
const sharedTillAttendanceSql = readFileSync('supabase/migrations/20260715026000_restaurant_shared_till_requires_attendance.sql', 'utf8')

test('service staff receive a dedicated self-shift workspace', () => {
  assert.match(app, /path="hpos\/my-shift"/)
  assert.match(layout, /route: '\/hpos\/my-shift'/)
  assert.match(myShift, /Start my shift/)
  assert.match(myShift, /clockInSelfForPos/)
  assert.match(myShift, /Cash-up submitted\. You can clock out attendance/)
  assert.match(myShift, /Clock out attendance/)
})

test('starting a Till shift records the employee attendance before payments begin', () => {
  assert.match(selfAttendanceSql, /clock_in_self_for_pos/)
  assert.match(selfAttendanceSql, /staff_user_id=v_actor/)
  assert.match(selfAttendanceSql, /app_require_restaurant_lodge/)
})

test('a submitted cash-up permits attendance clock-out while preserving managerial review', () => {
  assert.match(attendanceHandoffSql, /not in \('submitted','approved'\)/)
  assert.match(attendanceHandoffSql, /Submit My Cash-up before clocking out/)
  assert.match(attendanceHandoffSql, /cashup_pending_review/)
})

test('cashier cash-up is submitted for an independently authorised review', () => {
  assert.match(app, /path="hpos\/my-cashup"/)
  assert.match(layout, /route: '\/hpos\/my-cashup'/)
  assert.match(myCashup, /Submit cash-up for review/)
  assert.match(myCashup, /Clock out attendance/)
  assert.match(myCashup, /does not keep you clocked in/)
  assert.match(posDomain, /rpc\('submit_pos_shift_cashup'/)
  assert.match(posCashupSql, /app_require_lodge_role\(v_lodge_id, array\['cashier','supervisor','manager','admin','super_admin'\]\)/)
  assert.match(posCashupSql, /app_require_lodge_role\(v_lodge_id, array\['supervisor','manager','admin','super_admin'\]\)/)
  assert.match(posCashupSql, /finalize_pos_shift_cashup_v2/)
})

test('a manager must provide a correction note when returning a cash-up', () => {
  assert.match(cashClose, /Confirm manager decision/)
  assert.match(cashClose, /Correction note/)
  assert.match(cashClose, /reviewCashupSubmission\?\.\(\{ submission_id: submission\.id, decision, notes/)
  assert.match(cashupRejectionSql, /Enter a return-for-correction note/)
})

test('each cash-up review requires the signed-in manager PIN', () => {
  assert.match(cashClose, /Manager PIN/)
  assert.match(cashClose, /manager_pin: managerPin/)
  assert.match(cashupManagerPinSql, /_restaurant_validate_manager_cashup_pin/)
  assert.match(cashupManagerPinSql, /v_actor/)
  assert.match(cashupManagerPinSql, /Incorrect manager PIN/)
  assert.match(cashupManagerPinSql, /'cashup\.review'/)
})

test('shared-terminal cash-up shows a returned correction note before resubmission', () => {
  assert.match(sharedCashup, /getStaffCashupSubmission/)
  assert.match(sharedCashup, /Cash-up returned for correction\. Manager note:/)
  assert.match(cashupRejectionSql, /review_notes/)
})

test('cash tips retained from all-cash sales lower the drawer handover without becoming payable twice', () => {
  assert.match(cashTipRetentionSql, /cash_tip_retained numeric not null default 0/)
  assert.match(cashTipRetentionSql, /lower\(coalesce\(new\.payment_method, ''\)\) = 'cash'/)
  assert.match(cashTipRetentionSql, /cash_tips_retained/)
  assert.match(cashTipRetentionSql, /expected_cash_drawer := round\(v_opening_float \+ coalesce\(\(new\.expected_by_method->>'cash'\)::numeric, 0\) - v_cash_tips_retained, 2\)/)
  assert.match(cashTipRetentionSql, /'available',greatest\(coalesce\(e\.earned,0\)-coalesce\(e\.cash_retained,0\)-coalesce\(p\.paid,0\),0\)/)
  assert.match(myCashup, /Cash tips kept/)
  assert.match(cashClose, /Cash tips retained/)
  assert.match(sharedCashup, /Cash tips kept/)
  assert.match(sharedCashup, /Loading this person’s Till shift/)
})

test('supervisors and managers get a visible attendance kiosk without exposing team management', () => {
  assert.match(layout, /label: 'Clock in\/out'/)
  assert.match(layout, /route: '\/hpos\/attendance'/)
})

test('opening a service shift is server-authoritative when online', () => {
  assert.match(posDomain, /rpc\('open_pos_shift_with_id'/)
  assert.match(posDomain, /create_idempotency_key/)
  assert.match(posDomain, /outlet_id: row\.outlet_id/)
  assert.match(posDomain, /A successful server read with no matching open shift is authoritative/)
  assert.match(posDomain, /return null;/)
})

test('a shared Till cannot be unlocked before attendance is active', () => {
  assert.match(terminal, /activateSharedTillOperator/)
  assert.doesNotMatch(terminal, /selectStaffWithPin\?\.\(\{ staff_id: operatorStaffId, pin: operatorPin \}\)/)
  assert.match(sharedTillAttendanceSql, /_restaurant_validate_attendance_pin/)
  assert.match(sharedTillAttendanceSql, /status = 'active'/)
  assert.match(sharedTillAttendanceSql, /Clock in at Clock in\/out before unlocking Till/)
  assert.match(sharedTillAttendanceSql, /attendance_shift_id = v_attendance\.id/)
  assert.match(terminal, /error=\{submitError\}/)
  assert.match(tillOperatorDialog, /hpos-till-unlock-error/)
  assert.match(tillOperatorDialog, /role="alert"/)
})
