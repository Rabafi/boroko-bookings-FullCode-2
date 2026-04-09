const CACHE = 'boroko-manager-v2'
const STATIC = [
  '/',
  '/index.html',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/favicon.svg'
]
const DEFAULT_NOTIFICATION_URL = '/#/alerts'

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
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) =>
    Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)))
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
    event.respondWith(fetch(event.request).catch(() => new Response('{"error":"offline"}', { headers: { 'Content-Type': 'application/json' } })))
  } else {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          const clone = response.clone()
          caches.open(CACHE).then((cache) => cache.put(event.request, clone))
          return response
        })
        .catch(() => caches.match(event.request))
    )
  }
})

self.addEventListener('push', (event) => {
  const data = event.data?.json() || { title: 'Boroko Manager', body: 'You have a new notification' }
  event.waitUntil(self.registration.showNotification(data.title, {
    body: data.body,
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    tag: data.tag || 'boroko',
    data: sanitizeNotificationUrl(data.url)
  }))
}))

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  event.waitUntil(clients.openWindow(sanitizeNotificationUrl(event.notification.data)))
})
