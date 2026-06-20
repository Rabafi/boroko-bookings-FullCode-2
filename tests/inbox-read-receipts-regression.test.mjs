import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8')

test('support inbox read state is server-authoritative and monotonic', async () => {
  const migration = await read('supabase/migrations/20260618205000_support_inbox_server_read_receipts.sql')

  assert.match(migration, /create table if not exists public\.support_ticket_read_receipts/i)
  assert.match(migration, /primary key \(ticket_id, audience\)/i)
  assert.match(migration, /create or replace function public\.mark_lodge_support_ticket_read/i)
  assert.match(migration, />= \(v_message\.created_at, v_message\.id\)/i)
  assert.match(migration, /Treat the current history as already acknowledged/i)
  assert.match(migration, /manager_has_unread boolean/i)
  assert.match(migration, /front_desk_has_unread boolean/i)
  assert.match(migration, /public\.app_require_lodge_role/i)
})

test('PWA and desktop both persist inbox acknowledgements through the RPC', async () => {
  const pwaApi = await read('manager-pwa/src/lib/api.js')
  const pwaNotifications = await read('manager-pwa/src/lib/frontDeskNotifications.js')
  const pwaApp = await read('manager-pwa/src/App.jsx')
  const pwaControl = await read('manager-pwa/src/pages/Control.jsx')
  const desktopDomain = await read('src/main/domains/admin.js')
  const desktopLayout = await read('src/renderer/src/components/Layout.jsx')
  const preload = await read('src/preload/index.js')
  const main = await read('src/main/index.js')

  assert.match(pwaApi, /mark_lodge_support_ticket_read/)
  assert.match(pwaNotifications, /request\?\.manager_has_unread/)
  assert.match(pwaControl, /markSupportRequestRead\(user\.lodge_id, activeRequest\.id, 'manager'/)
  assert.doesNotMatch(pwaApp, /markSupportRequestRead.*requestId.*manager/, 'App.jsx should not mark inbox read — only Control (Inbox) may')
  assert.match(desktopDomain, /markLodgeSupportTicketRead/)
  assert.match(desktopLayout, /row\.front_desk_has_unread === true/)
  assert.match(desktopLayout, /window\.api\.requests\.markRead/)
  assert.match(preload, /requests:markRead/)
  assert.match(main, /ipcMain\.handle\('requests:markRead'/)
})

test('PWA service worker preserves push dedupe state and reports offline failures', async () => {
  const serviceWorker = await read('manager-pwa/public/sw.js')

  assert.match(serviceWorker, /PERSISTENT_CACHES = new Set\(\[CACHE, PUSH_DEDUPE_CACHE\]\)/)
  assert.match(serviceWorker, /!PERSISTENT_CACHES\.has\(key\)/)
  assert.match(serviceWorker, /status: 503/)
  assert.doesNotMatch(
    serviceWorker,
    /new Response\('\{"error":"offline"\}', \{ headers: \{ 'Content-Type': 'application\/json' \} \}\)/
  )
})
