import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8')
const importFresh = (path) => import(`${path}?test=${crypto.randomUUID()}`)

// ─── Shared test infrastructure ───

function createMockLocalStorage() {
  const store = new Map()
  return {
    getItem(key) { return store.has(key) ? store.get(key) : null },
    setItem(key, value) { store.set(key, String(value)) },
    removeItem(key) { store.delete(key) },
    clear() { store.clear() },
    _store: store
  }
}

function createMockAudioContext(initialState = 'running') {
  const calls = { created: 0, resumed: 0, scheduled: 0 }
  const ctx = {
    state: initialState,
    currentTime: 0,
    destination: {},
    resume() { calls.resumed++; this.state = 'running'; return Promise.resolve() },
    createOscillator() {
      calls.scheduled++
      return { connect() {}, start() {}, stop() {}, type: 'sine', frequency: { setValueAtTime() {} } }
    },
    createGain() {
      return { connect() {}, gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} } }
    }
  }
  return {
    calls,
    create() { calls.created++; return { ...ctx } }
  }
}

function createMockNavigator() {
  const calls = { vibrate: [] }
  return {
    calls,
    navigator: {
      onLine: true,
      vibrate(pattern) { calls.vibrate.push(pattern); return true }
    }
  }
}

function setupTestEnv({ audioState = 'running' } = {}) {
  const localStorage = createMockLocalStorage()
  const audio = createMockAudioContext(audioState)
  const nav = createMockNavigator()
  const notifications = { created: [] }

  const origWindow = globalThis.window
  const origNavigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
  const origLocalStorageDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')

  globalThis.window = {
    AudioContext: function () { return audio.create() },
    webkitAudioContext: undefined,
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent(event) {
      if (event.type === 'boroko:pwa-notifications') {
        notifications.created.push(event.detail)
      }
    },
    localStorage,
    matchMedia() { return { matches: false } },
    setTimeout(fn) { fn(); return 1 },
    clearTimeout() {}
  }
  Object.defineProperty(globalThis, 'navigator', { value: nav.navigator, writable: true, configurable: true })
  Object.defineProperty(globalThis, 'localStorage', { value: localStorage, writable: true, configurable: true })

  return {
    localStorage,
    audio,
    nav,
    notifications,
    teardown() {
      globalThis.window = origWindow
      if (origNavigatorDescriptor) Object.defineProperty(globalThis, 'navigator', origNavigatorDescriptor)
      else delete globalThis.navigator
      if (origLocalStorageDescriptor) Object.defineProperty(globalThis, 'localStorage', origLocalStorageDescriptor)
      else delete globalThis.localStorage
    }
  }
}

// ─── Test 1: playNotificationSound returns early when sound disabled ───
test('playNotificationSound returns early when prefs.sound is false', async () => {
  const env = setupTestEnv()
  try {
    const { playNotificationSound } = await importFresh('../manager-pwa/src/lib/notificationSound.js')
    playNotificationSound({ sound: false })
    assert.equal(env.audio.calls.created, 0, 'No AudioContext created')
  } finally {
    env.teardown()
  }
})

// ─── Test 2: playNotificationSound creates AudioContext when sound enabled ───
test('playNotificationSound creates AudioContext and schedules beep when sound enabled', async () => {
  const env = setupTestEnv()
  try {
    const { playNotificationSound } = await importFresh('../manager-pwa/src/lib/notificationSound.js')
    playNotificationSound({ sound: true })
    assert.equal(env.audio.calls.created, 1, 'AudioContext created')
    assert.equal(env.audio.calls.scheduled, 1, 'Oscillator scheduled')
  } finally {
    env.teardown()
  }
})

// ─── Test 3: playNotificationSound handles suspended AudioContext ───
test('playNotificationSound resumes suspended AudioContext before beeping', async () => {
  const env = setupTestEnv({ audioState: 'suspended' })
  try {
    const { playNotificationSound } = await importFresh('../manager-pwa/src/lib/notificationSound.js')
    playNotificationSound({ sound: true })
    await Promise.resolve()
    assert.equal(env.audio.calls.resumed, 1, 'Suspended context resumed exactly once')
    assert.equal(env.audio.calls.scheduled, 1, 'Beep scheduled after resume')
  } finally {
    env.teardown()
  }
})

// ─── Test 4: vibratePulse returns early when vibration disabled ───
test('vibratePulse returns early when prefs.vibration is false', async () => {
  const env = setupTestEnv()
  try {
    const { vibratePulse } = await importFresh('../manager-pwa/src/lib/notificationSound.js')
    vibratePulse('reply', { vibration: false })
    assert.equal(env.nav.calls.vibrate.length, 0, 'No vibration triggered')
  } finally {
    env.teardown()
  }
})

// ─── Test 5: vibratePulse triggers correct pattern for reply ───
test('vibratePulse triggers reply pattern [80] for reply type', async () => {
  const env = setupTestEnv()
  try {
    const { vibratePulse } = await importFresh('../manager-pwa/src/lib/notificationSound.js')
    vibratePulse('reply', { vibration: true })
    assert.deepEqual(env.nav.calls.vibrate, [[80]], 'Reply pattern used')
  } finally {
    env.teardown()
  }
})

// ─── Test 6: vibratePulse triggers correct pattern for urgent ───
test('vibratePulse triggers urgent pattern [60, 40, 60] for urgent type', async () => {
  const env = setupTestEnv()
  try {
    const { vibratePulse } = await importFresh('../manager-pwa/src/lib/notificationSound.js')
    vibratePulse('urgent', { vibration: true })
    assert.deepEqual(env.nav.calls.vibrate, [[60, 40, 60]], 'Urgent pattern used')
  } finally {
    env.teardown()
  }
})

// ─── Test 7: vibratePulse handles missing navigator.vibrate ───
test('vibratePulse does not throw when navigator.vibrate is missing', async () => {
  const origDesc = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
  Object.defineProperty(globalThis, 'navigator', { value: { onLine: true }, writable: true, configurable: true })
  try {
    const { vibratePulse } = await importFresh('../manager-pwa/src/lib/notificationSound.js')
    assert.doesNotThrow(() => vibratePulse('reply', { vibration: true }))
  } finally {
    if (origDesc) Object.defineProperty(globalThis, 'navigator', origDesc)
    else delete globalThis.navigator
  }
})

// ─── Test 8: upsertPwaNotification creates notification and emits event ───
test('upsertPwaNotification creates notification and emits boroko:pwa-notifications event', async () => {
  const env = setupTestEnv()
  try {
    const { upsertPwaNotification } = await import('../manager-pwa/src/lib/runtime.js')
    const emitted = []
    const orig = window.dispatchEvent
    window.dispatchEvent = (event) => { if (event.type === 'boroko:pwa-notifications') emitted.push(event.detail) }

    const result = upsertPwaNotification('test-lodge', {
      sourceKey: 'test-alert-1',
      title: 'Test alert',
      message: 'Test message',
      tone: 'warn',
      category: 'urgent-alerts'
    })

    assert.ok(result, 'Notification returned')
    assert.equal(result.title, 'Test alert')
    assert.equal(result.readAt, null, 'New notification is unread')
    assert.ok(emitted.length > 0, 'Event was emitted')
    assert.equal(emitted[0].isNew, true, 'isNew flag is true for new notification')
    window.dispatchEvent = orig
  } finally {
    env.teardown()
  }
})

// ─── Test 9: upsertPwaNotification deduplicates same sourceKey ───
test('upsertPwaNotification updates existing notification on same sourceKey', async () => {
  const env = setupTestEnv()
  try {
    const { upsertPwaNotification } = await import('../manager-pwa/src/lib/runtime.js')

    upsertPwaNotification('test-lodge', {
      sourceKey: 'dup-test',
      title: 'Original',
      message: 'v1'
    })

    const emitted = []
    const orig = window.dispatchEvent
    window.dispatchEvent = (event) => { if (event.type === 'boroko:pwa-notifications') emitted.push(event.detail) }

    const updated = upsertPwaNotification('test-lodge', {
      sourceKey: 'dup-test',
      title: 'Updated',
      message: 'v2'
    })

    assert.equal(updated.title, 'Updated', 'Notification updated')
    const newEvent = emitted.find((e) => e.isNew === true)
    assert.equal(newEvent, undefined, 'No isNew event for update')
    window.dispatchEvent = orig
  } finally {
    env.teardown()
  }
})

// ─── Test 10: getNotificationSettings has correct defaults ───
test('getNotificationSettings returns correct Phase D defaults', async () => {
  const env = setupTestEnv()
  try {
    const { getNotificationSettings } = await import('../manager-pwa/src/lib/runtime.js')
    const settings = getNotificationSettings()
    assert.equal(settings.sound, false, 'sound defaults to false')
    assert.equal(settings.vibration, false, 'vibration defaults to false')
    assert.equal(settings.urgentOnly, false, 'urgentOnly defaults to false')
    assert.equal(settings.frontDeskReplies, true, 'frontDeskReplies defaults to true')
  } finally {
    env.teardown()
  }
})

// ─── Test 11: setNotificationSettings persists and emits event ───
test('setNotificationSettings persists settings and emits notification-settings event', async () => {
  const env = setupTestEnv()
  try {
    const { setNotificationSettings, getNotificationSettings } = await import('../manager-pwa/src/lib/runtime.js')
    const emitted = []
    const orig = window.dispatchEvent
    window.dispatchEvent = (event) => {
      if (event.type === 'boroko:pwa-notification-settings') emitted.push(event.detail)
    }

    setNotificationSettings({ sound: true, vibration: true, urgentOnly: false, frontDeskReplies: true })

    const saved = getNotificationSettings()
    assert.equal(saved.sound, true, 'Sound setting persisted')
    assert.equal(saved.vibration, true, 'Vibration setting persisted')
    assert.ok(emitted.length > 0, 'Event emitted on settings change')
    window.dispatchEvent = orig
  } finally {
    env.teardown()
  }
})

// ─── Test 12: getUnreadOperationalNotificationCount excludes frontDeskRequest ───
test('getUnreadOperationalNotificationCount excludes frontDeskRequest from count', async () => {
  const env = setupTestEnv()
  try {
    const { upsertPwaNotification, getUnreadOperationalNotificationCount } = await import('../manager-pwa/src/lib/runtime.js')

    upsertPwaNotification('count-lodge', {
      sourceKey: 'operational-1',
      title: 'Urgent alert',
      tone: 'error',
      category: 'urgent-alerts'
    })
    upsertPwaNotification('count-lodge', {
      sourceKey: 'frontdesk-1',
      title: 'Front desk reply',
      tone: 'warn',
      category: 'frontDeskRequest'
    })

    const operationalCount = getUnreadOperationalNotificationCount('count-lodge')
    assert.equal(operationalCount, 1, 'Only operational notification counted')
  } finally {
    env.teardown()
  }
})

// ─── Test 13: Notification is read when marked read ───
test('markPwaNotificationRead sets readAt on notification', async () => {
  const env = setupTestEnv()
  try {
    const { upsertPwaNotification, markPwaNotificationRead, listPwaNotifications } = await import('../manager-pwa/src/lib/runtime.js')

    const item = upsertPwaNotification('read-lodge', {
      sourceKey: 'read-test',
      title: 'Read test'
    })
    assert.equal(item.readAt, null, 'Initially unread')

    markPwaNotificationRead('read-lodge', item.id)

    const list = listPwaNotifications('read-lodge')
    const found = list.find((n) => n.id === item.id)
    assert.ok(found.readAt, 'Notification marked as read')
  } finally {
    env.teardown()
  }
})

// ─── Test 14: Notification dismissed removes from store ───
test('dismissPwaNotification removes notification from store', async () => {
  const env = setupTestEnv()
  try {
    const { upsertPwaNotification, dismissPwaNotification, listPwaNotifications } = await import('../manager-pwa/src/lib/runtime.js')

    const item = upsertPwaNotification('dismiss-lodge', {
      sourceKey: 'dismiss-test',
      title: 'Dismiss test'
    })
    assert.equal(listPwaNotifications('dismiss-lodge').length, 1, 'Notification exists')

    dismissPwaNotification('dismiss-lodge', item.sourceKey)

    assert.equal(listPwaNotifications('dismiss-lodge').length, 0, 'Notification removed')
  } finally {
    env.teardown()
  }
})

// ─── Test 15: NotificationCenter initializes lastAnnouncedRef from current state ───
test('NotificationCenter initializes dedup ref from existing notifications on mount', async () => {
  const app = await read('manager-pwa/src/App.jsx')
  assert.match(app, /lastAnnouncedRef\.current = `?\$\{latestUnread\.id\}/, 'Initializes ref from existing unread notification')
  assert.match(app, /readyRef\.current = true/, 'readyRef set during initialization')
})

// ─── Test 16: NotificationCenter skips manager-authored front-desk messages ───
test('NotificationCenter checks sender_user_id to skip own front-desk messages', async () => {
  const app = await read('manager-pwa/src/App.jsx')
  assert.match(app, /lastMsg\?\.sender_user_id && lastMsg\.sender_user_id === user\.id/, 'Checks sender_user_id against current user')
  assert.match(app, /supportMessageSide\(lastMsg\) === 'manager'/, 'Also checks supportMessageSide for manager type')
})

// ─── Test 17: InboxContext calls upsertFrontDeskNotification for new replies ───
test('InboxContext tracks latest desk-message versions and emits on version changes', async () => {
  const inbox = await read('manager-pwa/src/contexts/InboxContext.jsx')
  assert.match(inbox, /upsertFrontDeskNotification/, 'Imports upsertFrontDeskNotification')
  assert.match(inbox, /previousUnreadVersionsRef/, 'Tracks previous unread desk-message versions')
  assert.match(inbox, /latestDeskMessageVersion/, 'Builds a stable latest desk-message version')
  assert.match(inbox, /initialLoadDoneRef/, 'Tracks initial load completion')
  assert.match(inbox, /quiet: false/, 'Creates notifications with quiet: false for new replies')
  assert.match(inbox, /previousUnreadVersionsRef\.current\.get\(conversation\.id\) !== version/, 'Alerts when a later desk reply changes the version')
})

// ─── Test 18: InboxContext skips initial load for notification production ───
test('InboxContext does not produce notifications on initial load', async () => {
  const inbox = await read('manager-pwa/src/contexts/InboxContext.jsx')
  assert.match(inbox, /initialLoadDoneRef\.current/, 'Checks if initial load is done')
  assert.match(inbox, /initialLoadDoneRef\.current = true/, 'Marks initial load as done')
})

test('InboxContext resets reply tracking when lodge changes', async () => {
  const inbox = await read('manager-pwa/src/contexts/InboxContext.jsx')
  assert.match(inbox, /previousUnreadVersionsRef\.current = new Map\(\)/, 'Clears prior lodge versions')
  assert.match(inbox, /initialLoadDoneRef\.current = false/, 'Treats the new lodge load as initial')
})

// ─── Test 19: ReadyRef prevents initial alert on first subscription event ───
test('NotificationCenter readyRef prevents initial subscription event from alerting', async () => {
  const app = await read('manager-pwa/src/App.jsx')
  assert.match(app, /if \(!readyRef\.current\) return/, 'readyRef guard returns early')
})

// ─── Test 20: Durable dedup across remounts ───
test('NotificationCenter initializes lastAnnouncedRef before subscription to prevent remount re-alert', async () => {
  const app = await read('manager-pwa/src/App.jsx')
  const initEffectIdx = app.indexOf('lastAnnouncedRef.current = `${latestUnread.id}')
  const subEffectIdx = app.indexOf("subscribeRuntimeEvent('boroko:pwa-notifications'")
  assert.ok(initEffectIdx < subEffectIdx, 'Init effect runs before subscription effect')
})

// ─── Test 21: frontDeskReplies preference checked before alert ───
test('frontDeskReplies preference is checked before alerting on front-desk notifications', async () => {
  const app = await read('manager-pwa/src/App.jsx')
  assert.match(app, /isFrontDesk && !prefs\.frontDeskReplies/, 'frontDeskReplies checked after sender check')
})

// ─── Test 22: urgentOnly filters sound and vibration but not toast ───
test('urgentOnly suppresses sound and vibration for ordinary events', async () => {
  const app = await read('manager-pwa/src/App.jsx')
  assert.match(app, /if \(!prefs\.urgentOnly \|\| isUrgent\)/, 'urgentOnly gate before sound/vibration')
})

// ─── Test 23: Notification badge excludes frontDeskRequest ───
test('Badge uses getUnreadOperationalNotificationCount not raw count', async () => {
  const app = await read('manager-pwa/src/App.jsx')
  assert.match(app, /getUnreadOperationalNotificationCount/, 'Uses operational count')
  const runtime = await read('manager-pwa/src/lib/runtime.js')
  assert.match(runtime, /item\?\.category !== 'frontDeskRequest'/, 'Filters frontDeskRequest')
})

// ─── Test 24: Source assertion tests for completeness ───
test('Source assertions verify structure of all critical code paths', async () => {
  const sound = await read('manager-pwa/src/lib/notificationSound.js')
  assert.match(sound, /export function playNotificationSound/)
  assert.match(sound, /export function playTestSound/)
  assert.match(sound, /export function vibratePulse/)
  assert.match(sound, /sharedAudioContext/)
  assert.match(sound, /context\.state === 'suspended'/)

  const runtime = await read('manager-pwa/src/lib/runtime.js')
  assert.match(runtime, /export function getNotificationSettings/)
  assert.match(runtime, /export function setNotificationSettings/)
  assert.match(runtime, /export function getUnreadOperationalNotificationCount/)
  assert.match(runtime, /sound: false/)
  assert.match(runtime, /vibration: false/)
  assert.match(runtime, /urgentOnly: false/)
  assert.match(runtime, /frontDeskReplies: true/)

  const more = await read('manager-pwa/src/pages/More.jsx')
  assert.match(more, /label="Sound"/)
  assert.match(more, /label="Vibration"/)
  assert.match(more, /label="Urgent alerts only"/)
  assert.match(more, /label="Front-desk replies"/)
  assert.match(more, /playTestSound/)
})
