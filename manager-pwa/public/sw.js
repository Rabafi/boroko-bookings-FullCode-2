/* global self, clients */

const CACHE = 'boroko-manager-v4'
const STATIC = [
  '/',
  '/index.html',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/favicon.svg'
]
const DEFAULT_NOTIFICATION_URL = '/#/alerts'
const PUSH_DEDUPE_CACHE = 'boroko-manager-push-dedupe-v1'
// Keep accepting the pre-rename default tag so queued push payloads dedupe safely.
const LEGACY_PUSH_TAG = 'boroko'
const DEFAULT_PUSH_TAG = 'tsa-bonno'
const PERSISTENT_CACHES = new Set([CACHE, PUSH_DEDUPE_CACHE])

function stablePart(value) {
  return String(value ?? '').trim().replace(/\s+/g, ' ')
}

function hashText(value) {
  let hash = 0
  const text = String(value || '')
  for (let index = 0; index < text.length; index += 1) {
    hash = ((hash << 5) - hash + text.charCodeAt(index)) | 0
  }
  return Math.abs(hash).toString(36)
}

function pushDedupeKey(data = {}) {
  const explicitKey = stablePart(data.dedupeKey || data.tag)
  const version = stablePart(data.version || data.updatedAt || data.createdAt)
  if (explicitKey && ![LEGACY_PUSH_TAG, DEFAULT_PUSH_TAG].includes(explicitKey)) {
    return `${explicitKey}:${version || hashText(`${data.title}|${data.body}|${data.url}`)}`
  }
  if (!data.dedupeKey && !data.version) return ''
  return hashText([
    stablePart(data.title),
    stablePart(data.body),
    stablePart(data.url),
    version
  ].join('|'))
}

async function hasSeenPush(data) {
  const key = pushDedupeKey(data)
  if (!key) return false
  const cache = await caches.open(PUSH_DEDUPE_CACHE)
  const request = new Request(`/__boroko_push_seen__/${encodeURIComponent(key)}`)
  const seen = await cache.match(request)
  if (seen) return true
  await cache.put(request, new Response('', {
    headers: { 'x-seen-at': new Date().toISOString() }
  }))
  return false
}

function sanitizeNotificationUrl(value) {
  if (typeof value !== 'string' || !value.trim()) return DEFAULT_NOTIFICATION_URL
  try {
    const url = new URL(value, self.location.origin)
    if (!/^https?:$/i.test(url.protocol)) return DEFAULT_NOTIFICATION_URL
    if (url.origin !== self.location.origin) return DEFAULT_NOTIFICATION_URL
    return `${url.pathname}${url.search}${url.hash}` || DEFAULT_NOTIFICATION_URL
  } catch {
    return DEFAULT_NOTIFICATION_URL
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(STATIC)))
})

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) =>
    Promise.all(keys.filter((key) => !PERSISTENT_CACHES.has(key)).map((key) => caches.delete(key)))
  ))
  self.clients.claim()
})

self.addEventListener('fetch', (event) => {
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request).catch(() => caches.match('/index.html'))
    )
    return
  }

  if (event.request.url.includes('supabase.co')) {
    event.respondWith(fetch(event.request).catch(() => new Response('{"error":"offline"}', {
      status: 503,
      statusText: 'Offline',
      headers: { 'Content-Type': 'application/json' }
    })))
  } else {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          const url = event.request.url
          if (url.startsWith('http://') || url.startsWith('https://')) {
            const clone = response.clone()
            caches.open(CACHE).then((cache) => cache.put(event.request, clone)).catch(() => {})
          }
          return response
        })
        .catch(() => caches.match(event.request))
    )
  }
})

self.addEventListener('push', (event) => {
  const data = event.data?.json() || { title: 'Tsa Bonno Manager', body: 'You have a new notification' }
  event.waitUntil((async () => {
    if (await hasSeenPush(data)) return
    await self.registration.showNotification(data.title, {
      body: data.body,
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      tag: data.tag || data.dedupeKey || DEFAULT_PUSH_TAG,
      renotify: false,
      data: { url: sanitizeNotificationUrl(data.url) }
    })
  })())
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  event.waitUntil(clients.openWindow(sanitizeNotificationUrl(event.notification.data?.url || event.notification.data)))
})

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting()
  }
})
