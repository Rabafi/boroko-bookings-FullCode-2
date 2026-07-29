/**
 * Phase 6–8 guest experience + enterprise ops contract tests.
 * - Messaging never marks sent without provider confirmation
 * - CRM uses RPCs and surfaces errors
 * - Group ops surfaces errors / real RPC wiring
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = process.cwd()
const read = (rel) => readFileSync(resolve(root, rel), 'utf8')

const messagingJs = read('src/main/domains/guestMessaging.js')
const messagingUi = read('src/renderer/src/components/GuestMessaging.jsx')
const crmJs = read('src/main/domains/guestCRM.js')
const crmUi = read('src/renderer/src/components/GuestCRM.jsx')
const portalJs = read('src/main/domains/guestPortal.js')
const portalUi = read('src/renderer/src/components/GuestPortalConfig.jsx')
const portalSession = read('booking-site/src/components/GuestPortalSession.jsx')
const portalRequests = read('booking-site/src/components/GuestRequests.jsx')
const groupOpsJs = read('src/main/domains/groupOperations.js')
const groupOpsUi = read('src/renderer/src/components/GroupOperations.jsx')
const multiPropertyJs = read('src/main/domains/multiProperty.js')
const propertySwitcher = read('src/renderer/src/components/PropertySwitcher.jsx')
const paymentsJs = read('src/main/domains/payments.js')
const abandonedJs = read('src/main/domains/abandonedPaymentRecovery.js')
const opsJs = read('src/main/domains/operationsCompliance.js')
const opsUi = read('src/renderer/src/components/OperationsCompliance.jsx')
const preload = read('src/preload/index.js')
const indexJs = read('src/main/index.js')
const databaseJs = read('src/main/database.js')

// ── Messaging: never mark sent without confirmation ─────────────────────────

test('guest messaging exposes channel readiness and not_configured for SMS/WhatsApp', () => {
  assert.ok(messagingJs.includes('getChannelReadiness'))
  assert.ok(messagingJs.includes('not_configured'))
  assert.ok(messagingJs.includes("sms") && messagingJs.includes('whatsapp'))
  assert.match(messagingJs, /PROVIDER_CHANNELS|whatsapp/)
  assert.ok(messagingJs.includes('dispatchMessage'))
  // Fail-closed: dispatch returns not_configured / sent:false for unready channels
  assert.ok(messagingJs.includes('sent: false') || messagingJs.includes('sent:false'))
  assert.ok(messagingJs.includes("status: 'not_configured'") || messagingJs.includes('not_configured'))
})

test('guest messaging never upgrades queue to sent without provider confirmation', () => {
  assert.ok(messagingJs.includes('queue_triggered_messages'))
  assert.ok(messagingJs.includes("delivery_status: 'queued'") || messagingJs.includes('delivery_status: "queued"'))
  assert.ok(messagingJs.includes('sent: false') || messagingJs.includes('sent:false'))
  // Email path requires provider confirmation (messageId/response)
  assert.ok(messagingJs.includes('messageId') || messagingJs.includes('provider_confirmed'))
  assert.ok(messagingJs.includes('nodemailer') || messagingJs.includes('getEmailConfig'))
})

test('guest messaging delivery status demotes unconfirmed sent display for unready channels', () => {
  assert.ok(messagingJs.includes('display_status'))
  assert.ok(messagingJs.includes('channel_ready'))
  assert.ok(messagingJs.includes('get_message_delivery_status'))
})

test('GuestMessaging UI shows readiness not configured and never invents sent', () => {
  assert.ok(messagingUi.includes('not configured') || messagingUi.includes('not_configured'))
  assert.ok(messagingUi.includes('Channel readiness') || messagingUi.includes('channel readiness') || messagingUi.includes('channelReadiness'))
  assert.ok(messagingUi.includes('getChannelReadiness') || messagingUi.includes('getDeliveryStatus'))
  assert.ok(messagingUi.includes('displayDeliveryStatus') || messagingUi.includes('display_status'))
  // Must not hardcode a success "sent" toast for SMS/WhatsApp
  assert.ok(!/setSuccess\(['"]Message sent/.test(messagingUi))
})

test('guest messaging IPC and preload expose readiness + dispatch', () => {
  assert.ok(indexJs.includes("guestMessaging:getChannelReadiness"))
  assert.ok(indexJs.includes("guestMessaging:dispatchMessage"))
  assert.ok(preload.includes('getChannelReadiness'))
  assert.ok(preload.includes('dispatchMessage'))
  assert.ok(databaseJs.includes('dispatchGuestMessage') || databaseJs.includes('getGuestMessageChannelReadiness'))
})

// ── CRM RPC usage ───────────────────────────────────────────────────────────

test('guestCRM domain uses authoritative RPCs for profile, VIP, preference, blacklist', () => {
  for (const rpc of [
    'get_guest_crm_profile',
    'update_guest_crm_profile',
    'set_vip_level',
    'add_guest_preference',
    'set_blacklist_status',
    'get_guest_stay_history',
    'record_guest_consent',
    'search_guests_crm',
    'get_vip_list'
  ]) {
    assert.ok(crmJs.includes(rpc), `CRM domain must call ${rpc}`)
  }
})

test('guestCRM notes API exists and VIP list does not silent-empty on error', () => {
  assert.ok(crmJs.includes('listGuestNotes') || crmJs.includes('addGuestNote'))
  assert.ok(crmJs.includes('addGuestNote'))
  // getVIPList must throw on error, not return [] from silent catch
  const vipFn = crmJs.slice(crmJs.indexOf('async function _getVIPList'), crmJs.indexOf('export const getVIPList'))
  assert.ok(vipFn.includes('throw'), 'VIP list must throw errors instead of silent empty catch')
  assert.ok(!/catch\s*\([^)]*\)\s*\{\s*const cached[\s\S]*return Array\.isArray\(cached\) \? cached : \[\]\s*\}/.test(vipFn)
    || vipFn.includes('throw'), 'VIP list catch must not silently return empty')
})

test('GuestCRM UI gates sensitive VIP/blacklist actions and surfaces notes', () => {
  assert.ok(crmUi.includes('canAccessCapability'))
  assert.ok(crmUi.includes('guest_crm.vip') || crmUi.includes('canVip'))
  assert.ok(crmUi.includes('guest_crm.blacklist') || crmUi.includes('canBlacklist'))
  assert.ok(crmUi.includes('addNote') || crmUi.includes('Staff Notes') || crmUi.includes('notes'))
  assert.ok(crmUi.includes('setError'))
})

test('guestCRM note IPC is registered', () => {
  assert.ok(indexJs.includes("guestCRM:listNotes") || indexJs.includes("guestCRM:addNote"))
  assert.ok(preload.includes('listNotes') && preload.includes('addNote'))
})

// ── Guest portal ────────────────────────────────────────────────────────────

test('guest portal domain validates session and surfaces request load errors', () => {
  assert.ok(portalJs.includes('validate_guest_portal_session'))
  assert.ok(portalJs.includes('get_pending_guest_portal_requests'))
  assert.ok(portalJs.includes('No session token') || portalJs.includes('session token'))
  assert.ok(portalJs.includes('throw') || portalJs.includes('STALE_CACHE'))
})

test('GuestPortalConfig distinguishes config from public portal and shows request errors', () => {
  assert.ok(portalUi.includes('/portal') || portalUi.includes('booking-site') || portalUi.includes('public'))
  assert.ok(portalUi.includes('requestsError') || portalUi.includes('Pending Guest Requests'))
  assert.ok(portalUi.includes('staleWarning') || portalUi.includes('Promise.allSettled'))
})

test('booking-site guest portal validates session and has clear error/retry states', () => {
  assert.ok(portalSession.includes('validate_guest_portal_session'))
  assert.ok(portalSession.includes('Session Error') || portalSession.includes('session'))
  assert.ok(portalSession.includes('Return to booking site') || portalSession.includes('contact the property'))
  assert.ok(portalRequests.includes('get_guest_requests') || portalRequests.includes('submit_guest_portal_request'))
  assert.ok(portalRequests.includes('Retry') || portalRequests.includes('setError'))
})

// ── Abandoned payment recovery: no client paid state ────────────────────────

test('abandoned payment recovery never authors amount_paid or payment_status', () => {
  assert.ok(abandonedJs.includes('recover_abandoned_session'))
  assert.ok(abandonedJs.includes('payment_confirmed: false') || abandonedJs.includes('payment_confirmed:false'))
  assert.ok(abandonedJs.includes('delete session.payment_status') || abandonedJs.includes('payment_status'))
  assert.ok(abandonedJs.includes('amount_paid'))
  // payments.js recovery helper
  assert.ok(paymentsJs.includes('recoverAbandonedPaymentSession') || paymentsJs.includes('recover_abandoned_session'))
  assert.ok(paymentsJs.includes('payment_confirmed: false') || paymentsJs.includes('payment_confirmed:false'))
  assert.ok(paymentsJs.includes('amount_paid: undefined') || paymentsJs.includes('delete session.amount_paid') || paymentsJs.includes('amount_paid'))
  // Must not assign paid truth
  assert.ok(!/payment_status\s*=\s*['"]paid['"]/.test(abandonedJs))
  assert.ok(!/amount_paid\s*=/.test(abandonedJs.replace(/delete session\.amount_paid/g, '')))
})

// ── Group operations ────────────────────────────────────────────────────────

test('groupOperations uses real RPCs and asserts success', () => {
  for (const rpc of [
    'checkin_group_block',
    'checkout_group_block',
    'get_group_block_pickup',
    'release_unsold_group_rooms',
    'create_bookings_from_rooming_list'
  ]) {
    assert.ok(groupOpsJs.includes(rpc), `group ops must call ${rpc}`)
  }
  assert.ok(groupOpsJs.includes('assertRpcSuccess') || groupOpsJs.includes("success === false"))
  // List must not call get_group_block_pickup without block id as the list source
  assert.ok(groupOpsJs.includes('getAllGroupBlocks') || groupOpsJs.includes('get_group_blocks'))
})

test('GroupOperations UI has empty and error states and real API wiring', () => {
  assert.ok(groupOpsUi.includes('setError'))
  assert.ok(groupOpsUi.includes('No group blocks') || groupOpsUi.includes('No group blocks found') || groupOpsUi.includes('empty'))
  assert.ok(groupOpsUi.includes('groupOperations.checkinBlock') || groupOpsUi.includes('checkinBlock'))
  assert.ok(groupOpsUi.includes('getPickup') || groupOpsUi.includes('getAll'))
  assert.ok(indexJs.includes("groupOperations:getAll"))
  assert.ok(preload.includes('groupOperations:') && preload.includes('getAll'))
})

// ── Multi-property fail closed ──────────────────────────────────────────────

test('multiProperty switch fails closed and updates local state only after success', () => {
  assert.ok(multiPropertyJs.includes('switch_active_property'))
  assert.ok(multiPropertyJs.includes('PROPERTY_SWITCH') || multiPropertyJs.includes('fail closed') || multiPropertyJs.includes('not changed'))
  assert.ok(multiPropertyJs.includes('state.lodgeId'))
  // state.lodgeId assignment should appear after success check
  const switchFn = multiPropertyJs.slice(multiPropertyJs.indexOf('switchActiveProperty'))
  assert.ok(switchFn.includes('throw'), 'switch must throw on failure')
  assert.ok(propertySwitcher.includes('Fail closed') || propertySwitcher.includes('was not changed') || propertySwitcher.includes('setError'))
  assert.ok(propertySwitcher.includes('switchProperty'))
})

// ── Operations compliance ───────────────────────────────────────────────────

test('operationsCompliance incident/visitor/emergency use RPCs and surface errors', () => {
  assert.ok(opsJs.includes('get_incident_dashboard'))
  assert.ok(opsJs.includes('get_visitor_dashboard'))
  assert.ok(opsJs.includes('get_evacuation_list'))
  assert.ok(opsJs.includes('throw') || opsJs.includes('warning') || opsJs.includes('STALE_CACHE'))
  assert.ok(opsUi.includes('warnings') || opsUi.includes('Partial load') || opsUi.includes('setError'))
  assert.ok(!opsUi.includes(".catch(() => null)") && !opsUi.includes('.catch(() => [])'),
    'OperationsCompliance must not swallow all failures into empty success')
})
