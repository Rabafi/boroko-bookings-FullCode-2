// Boroko Manager — Service Worker
const CACHE = 'boroko-manager-v1'
const STATIC = ['/', '/index.html']

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(STATIC)))
  self.skipWaiting()
})

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys =>
    Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
  ))
  self.clients.claim()
})

self.addEventListener('fetch', e => {
  // Network-first for API calls, cache-first for static assets
  if (e.request.url.includes('supabase.co')) {
    e.respondWith(fetch(e.request).catch(() => new Response('{"error":"offline"}', { headers: { 'Content-Type': 'application/json' } })))
  } else {
    e.respondWith(
      fetch(e.request)
        .then(res => { const clone = res.clone(); caches.open(CACHE).then(c => c.put(e.request, clone)); return res })
        .catch(() => caches.match(e.request))
    )
  }
})

// Push notifications
self.addEventListener('push', e => {
  const data = e.data?.json() || { title: 'Boroko Manager', body: 'You have a new notification' }
  e.waitUntil(self.registration.showNotification(data.title, {
    body: data.body,
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    tag: data.tag || 'boroko',
    data: data.url || '/'
  }))
})

self.addEventListener('notificationclick', e => {
  e.notification.close()
  e.waitUntil(clients.openWindow(e.notification.data || '/'))
})
