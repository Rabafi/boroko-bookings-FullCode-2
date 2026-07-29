import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8')

test('Inbox unread badge reflects manager_has_unread from server', async () => {
  const inbox = await read('manager-pwa/src/contexts/InboxContext.jsx')

  assert.match(inbox, /manager_has_unread === true/)
  assert.match(inbox, /conversations\.filter/)
  assert.match(inbox, /getSupportRequests/)
})

test('Inbox retains existing conversations on refresh failure', async () => {
  const inbox = await read('manager-pwa/src/contexts/InboxContext.jsx')

  assert.match(inbox, /conversationCountRef/)
  assert.match(inbox, /Refresh failed\. Showing last known conversations/)
})

test('Inbox uses forceFresh on visibility change and online events', async () => {
  const inbox = await read('manager-pwa/src/contexts/InboxContext.jsx')

  assert.match(inbox, /visibilitychange/)
  assert.match(inbox, /forceFresh: true/)
  assert.match(inbox, /online/)
})

test('Read receipts use front_desk_read_message_id with positional comparison', async () => {
  const control = await read('manager-pwa/src/pages/Control.jsx')

  assert.match(control, /front_desk_read_message_id/)
  assert.match(control, /msgIndex >= 0 && msgIndex <= readIndex/)
  assert.doesNotMatch(control, /localeCompare.*readMessageId/)
})

test('Read receipts show only: Waiting for connection, Sent, Read', async () => {
  const control = await read('manager-pwa/src/pages/Control.jsx')

  assert.match(control, /Waiting for connection/)
  assert.match(control, /Read/)
  assert.match(control, /Sent/)
  assert.doesNotMatch(control, /Delivered/)
})

test('App.jsx does not mark inbox read — only Control (Inbox) may', async () => {
  const app = await read('manager-pwa/src/App.jsx')

  assert.doesNotMatch(app, /markSupportRequestRead.*requestId.*manager/)
  assert.doesNotMatch(app, /upsertFrontDeskNotification/)
})

test('Notifications are operational only — no frontDeskRequest category', async () => {
  const app = await read('manager-pwa/src/App.jsx')

  assert.doesNotMatch(app, /category: 'frontDeskRequest'/)
  assert.match(app, /item\.category !== 'frontDeskRequest'/)
})

test('sendFrontDeskRequest does not create PWA notifications', async () => {
  const fdr = await read('manager-pwa/src/lib/frontDeskRequests.js')

  assert.doesNotMatch(fdr, /upsertPwaNotification/)
  assert.doesNotMatch(fdr, /buildPwaNotificationSourceKey/)
})

test('Control.jsx displays queued offline messages as pending bubbles', async () => {
  const control = await read('manager-pwa/src/pages/Control.jsx')

  assert.match(control, /PendingMessageBubble/)
  assert.match(control, /PendingConversationBubble/)
  assert.match(control, /getOfflineQueue/)
  assert.match(control, /Waiting for connection/)
})

test('Control.jsx shows error state on load failure', async () => {
  const control = await read('manager-pwa/src/pages/Control.jsx')

  assert.match(control, /inboxError/)
  assert.match(control, /loadError/)
})

test('No duplicate polling between InboxProvider and Control', async () => {
  const inbox = await read('manager-pwa/src/contexts/InboxContext.jsx')
  const control = await read('manager-pwa/src/pages/Control.jsx')

  assert.match(inbox, /60_000/)
  assert.doesNotMatch(control, /setInterval.*load/)
})

test('Dashboard section order: header, attention, KPIs, links', async () => {
  const dashboard = await read('manager-pwa/src/pages/Dashboard.jsx')

  const freshnessIdx = dashboard.indexOf('DataFreshness')
  const attentionIdx = dashboard.indexOf('Needs attention')
  const kpiIdx = dashboard.indexOf('Occupancy') !== -1 ? dashboard.indexOf('Occupancy') : dashboard.indexOf('QuickLink')
  const linksIdx = dashboard.indexOf('QuickLink')

  assert.ok(freshnessIdx < attentionIdx, 'Freshness comes before attention')
  assert.ok(attentionIdx < kpiIdx, 'Attention comes before KPI cards')
})

test('Compact Alerts uses row format', async () => {
  const alerts = await read('manager-pwa/src/pages/Alerts.jsx')

  assert.match(alerts, /AlertRow/)
  assert.match(alerts, /rounded-xl bg-gray-900/)
})

test('Compact Money uses grid layout', async () => {
  const money = await read('manager-pwa/src/pages/Money.jsx')

  assert.match(money, /grid grid-cols-2/)
})

test('DataFreshness shows honest states', async () => {
  const freshness = await read('manager-pwa/src/components/DataFreshness.jsx')

  assert.match(freshness, /Offline/)
  assert.match(freshness, /cached/)
  assert.match(freshness, /Update failed/)
  assert.match(freshness, /Updating/)
})

test('Menu groups settings logically', async () => {
  const more = await read('manager-pwa/src/pages/More.jsx')

  assert.match(more, /Operations/)
  assert.match(more, /Finance and reporting/)
  assert.match(more, /People and property/)
  assert.match(more, /Preferences/)
})
