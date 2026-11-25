/* Google Analytics 4 bootstrap — externalised so the site can keep a strict
   Content-Security-Policy (script-src 'self') with no inline script required.
   Loads with consent defaulted to denied; marketing-site/script.js grants it
   only after the visitor accepts the cookie notice. */
(function () {
  'use strict'
  var GA_ID = 'G-37DYXS6K47'
  window.dataLayer = window.dataLayer || []
  function gtag() { window.dataLayer.push(arguments) }
  window.gtag = gtag
  gtag('js', new Date())
  gtag('consent', 'default', { analytics_storage: 'denied' })
  gtag('config', GA_ID)
  var s = document.createElement('script')
  s.async = true
  s.src = 'https://www.googletagmanager.com/gtag/js?id=' + GA_ID
  document.head.appendChild(s)
})()
