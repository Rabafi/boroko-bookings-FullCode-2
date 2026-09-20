import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8')

const layout = read('src/renderer/src/components/hospitality-pos/HposLayout.jsx')
const main = read('src/main/index.js')
const central = read('src/renderer/src/components/AdminCentral.jsx')

test('forgot-PIN help lives in the Manage PIN dialog and never accepts a PIN', () => {
  assert.match(layout, /Forgot PIN\? Get help/, 'Locked-out managers must be offered help from the PIN dialog')
  assert.match(layout, /Never type your PIN/, 'Help must warn the PIN is never typed into the request')
  assert.match(layout, /requestPinHelp/, 'Help requests must go through one guarded sender')
  assert.match(layout, /Never type your PIN here/, 'Digit-only notes must be refused with guidance, not sent')
  assert.match(layout, /Keep the note under 500 characters/, 'Help notes must stay bounded')
})

test('help requests reuse the existing ticket contract Command Central already shows', () => {
  assert.match(layout, /admin\?\.createSupportTicket/, 'Help must file through the existing lodge ticket creation IPC')
  assert.match(layout, /category: PIN_HELP_CATEGORY/, 'Help tickets must carry the shared Access category')
  assert.match(layout, /PIN_HELP_CATEGORY = 'Access'/, 'Access category identifier must be explicit and shared')
  assert.match(layout, /priority: 'High'/, 'A manager locked out of Manage must file at High priority')
  assert.match(layout, /PIN_HELP_SOURCE = 'hpos_manage_pin'/, 'Help tickets must carry the source both sides match on')
  assert.match(layout, /Manager PIN help/, 'Help tickets must be titled so support recognises them in the inbox list')
  assert.doesNotMatch(layout, /pinHelp:|createPinHelp|support:create/, 'No parallel ticket IPC may be invented for this flow')
})

test('repeat taps reuse the open request instead of spamming support', () => {
  assert.match(layout, /findOpenPinHelpTicket/, 'Sending must first look for the already-open request')
  assert.match(layout, /requests\?\.getAll/, 'Open-request lookup must read the authoritative lodge inbox')
  assert.match(layout, /isOpenPinHelpTicket/, 'Reuse must match open PIN-help tickets only')
})

test('support replies come back to the same dialog', () => {
  assert.match(layout, /checkPinHelpReply/, 'Managers must be able to check for the reply on the terminal')
  assert.match(layout, /Check for reply/, 'Reply checking must be an explicit visible action')
  assert.match(layout, /sender_type.*command_central/, 'Only the Command Central reply may render as the answer')
  assert.match(layout, /Support reply/, 'Replies must be labelled as support guidance')
  assert.match(layout, /markRead/, 'Displayed replies must advance the inbox read state')
  assert.match(layout, /ref \{String\(helpTicketId\)/, 'Sent requests must show a trackable reference')
  assert.match(layout, /You appear offline/, 'Offline managers must be told help needs a connection')
})

test('Command Central side needs no new UI: the inbox already covers these tickets', () => {
  assert.match(central, /admin\.getSupportTickets/, 'Command Central lists every lodge ticket through one inbox')
  assert.match(central, /label="Category"/, 'The inbox table exposes the ticket category')
  assert.match(central, /label="Priority"/, 'The inbox table exposes the ticket priority')
  assert.match(central, /admin\.addSupportTicketMessage/, 'Support replies from the same detail view the ticket opens in')
  assert.match(main, /buildSupportTicketEmail\(ticketData\)/, 'Filing still fires the support notification email')
  assert.match(main, /admin:createSupportTicket/, 'Lodge-side creation IPC remains the single creation path')
})
