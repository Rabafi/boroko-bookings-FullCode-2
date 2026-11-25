;(function () {
  'use strict'

  // Marker so CSS can keep navigation usable when JavaScript is unavailable.
  document.documentElement.classList.add('js')

  // On phones, keep the restaurant feature page compact and let visitors
  // expand only the topics they need. Feature-index and deep links open the
  // matching native disclosure before the browser scrolls to the section.
  var featureDetails = document.querySelectorAll('body[data-page="restaurant-pos"] details[data-feature-detail]')
  if (featureDetails.length) {
    var featureTarget = function (hash) {
      if (!hash || hash.charAt(0) !== '#') return null
      var id
      try { id = decodeURIComponent(hash.slice(1)) } catch (_) { id = hash.slice(1) }
      return document.getElementById(id)
    }
    var featurePanelFor = function (target) {
      return target && target.closest ? target.closest('details[data-feature-detail]') : null
    }
    var initialFeatureTarget = featureTarget(window.location.hash)
    var initialFeaturePanel = featurePanelFor(initialFeatureTarget)
    var featureDisclosure = document.querySelector('body[data-page="restaurant-pos"] details.simple-details')
    if (initialFeatureTarget && featureDisclosure) featureDisclosure.open = true
    if (window.matchMedia('(max-width: 760px)').matches) {
      featureDetails.forEach(function (details) { details.open = details === initialFeaturePanel })
    }
    document.querySelectorAll('#features-nav a[href^="#"]').forEach(function (link) {
      link.addEventListener('click', function () {
        var panel = featurePanelFor(featureTarget(link.getAttribute('href')))
        if (panel) panel.open = true
      })
    })
    if (initialFeaturePanel) {
      initialFeaturePanel.open = true
      window.requestAnimationFrame(function () { initialFeatureTarget.scrollIntoView() })
    }
  }

  /* ======================================================================
     Shared configuration
     ====================================================================== */
  var SUPABASE_URL = 'https://oicgpknsmtvcsjacymum.supabase.co'
  var SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9pY2dwa25zbXR2Y3NqYWN5bXVtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM2OTM1MTEsImV4cCI6MjA4OTI2OTUxMX0.WbC5C1QaVeNaTbTG0_xdcsUlK3BoA8onWC607B_uGlY'
  var LEADS_TABLE = SUPABASE_URL + '/rest/v1/marketing_leads'
  var LEAD_TIMEOUT_MS = 12000

  var WHATSAPP_LINK = 'https://wa.me/26772789415'
  var CONSENT_KEY = 'tsa_cookie_consent'

  var reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches

  /* ------------------------------------------------------------------
     Product model. Release feeds stay isolated per product.
     HotelOS is Coming soon: no installer discovery, no trial download.
     ------------------------------------------------------------------ */
  var PRODUCTS = {
    'lodge-camp': {
      id: 'lodge-camp',
      name: 'Tsa Bonno LodgingOS',
      short: 'LodgingOS',
      page: './lodge-app.html',
      trial: true,
      repo: 'boroko-bookings-releases',
      cacheKey: 'tsa_release_lodge_camp',
      fallbackVersion: '1.5.7',
      fallbackUrl: 'https://github.com/Rabafi/boroko-bookings-releases/releases/latest',
      businessLabel: 'Lodge name',
      businessPlaceholder: 'Your lodge name',
      accent: '#174c3a',
      blurb: 'Bookings, rooms, billing, POS and stock for lodges, camps and guest houses.'
    },
    'hospitality-pos': {
      id: 'hospitality-pos',
      name: 'Tsa Bonno Restaurant & Bar POS',
      short: 'Restaurant & Bar POS',
      page: './restaurant-pos.html',
      trial: true,
      repo: 'boroko-hospitality-pos-releases',
      cacheKey: 'tsa_release_hospitality_pos',
      fallbackVersion: '',
      fallbackUrl: 'https://github.com/Rabafi/boroko-hospitality-pos-releases/releases/latest',
      businessLabel: 'Restaurant or bar name',
      businessPlaceholder: 'Your business name',
      accent: '#c95635',
      blurb: 'Fast counter and table service, stock, cash control and close for restaurants and bars.'
    },
    hotel: {
      id: 'hotel',
      name: 'Tsa Bonno HotelOS',
      short: 'HotelOS',
      page: './hotel.html',
      trial: false,
      comingSoon: true,
      repo: 'boroko-hotel-releases',
      cacheKey: 'tsa_release_hotel',
      fallbackVersion: '',
      fallbackUrl: 'https://github.com/Rabafi/boroko-hotel-releases/releases/latest',
      businessLabel: 'Hotel name',
      businessPlaceholder: 'Your hotel name',
      accent: '#b8734a',
      blurb: 'Hotel-native front desk, folios, rates and night audit. Coming soon.'
    },
    'property-os': {
      id: 'property-os',
      name: 'Tsa Bonno PropertyOS',
      short: 'PropertyOS',
      page: './property.html',
      trial: false,
      comingSoon: true,
      repo: '',
      cacheKey: 'tsa_release_property_os',
      fallbackVersion: '',
      fallbackUrl: '',
      businessLabel: 'Property business name',
      businessPlaceholder: 'Your company or portfolio name',
      accent: '#34556b',
      blurb: 'Agency, management and facilities modules for property businesses. Coming soon.'
    }
  }

  var PRODUCT_ORDER = ['lodge-camp', 'hospitality-pos', 'hotel', 'property-os']

  /* Per-site routing for the multisite build (scripts/build-marketing-sites.mjs
     generates site-config.js before this file). Without a site config — the
     single-source pages and tests — the relative product pages above stay in
     effect exactly as before. */
  var SITE_CONFIG = window.TSA_SITE || null

  function siteProductPage(id) {
    var pages = SITE_CONFIG && SITE_CONFIG.productPages
    return (pages && pages[id]) || ''
  }

  if (SITE_CONFIG && SITE_CONFIG.productPages) {
    PRODUCT_ORDER.forEach(function (id) {
      if (SITE_CONFIG.productPages[id]) PRODUCTS[id].page = SITE_CONFIG.productPages[id]
    })
  }

  function readStore(key) {
    try { return window.sessionStorage.getItem(key) } catch (_) { return null }
  }
  function writeStore(key, value) {
    try { window.sessionStorage.setItem(key, value) } catch (_) {}
  }

  /* Active product for this page (never silently hijack an explicit choice). */
  function detectProductId() {
    var requestedProduct = new URLSearchParams(window.location.search).get('product') || ''
    if (PRODUCTS[requestedProduct]) return requestedProduct
    var bodyProduct = (document.body && document.body.dataset.product) || ''
    if (PRODUCTS[bodyProduct]) return bodyProduct
    var page = (document.body && document.body.dataset.page) || ''
    if (page === 'restaurant-pos' || page === 'bar-pos') return 'hospitality-pos'
    if (page === 'hotel' || page === 'enterprise') return 'hotel'
    var stored = readStore('tsa_selected_product')
    if (PRODUCTS[stored]) return stored
    return 'lodge-camp'
  }

  var PAGE_PRODUCT = detectProductId()
  var ACTIVE_PRODUCT_ID = PAGE_PRODUCT

  /* Product context the visitor is explicitly on (URL param or the page's own
     data-product). Null on ecosystem/supporting pages, which must always show
     the chooser instead of silently choosing one product. */
  function explicitProductId() {
    var q = new URLSearchParams(window.location.search).get('product') || ''
    if (PRODUCTS[q]) return q
    var bodyProduct = (document.body && document.body.dataset.product) || ''
    if (PRODUCTS[bodyProduct]) return bodyProduct
    return null
  }

  /* Multisite: does the current page already match a (possibly absolute,
     subdomain-based) product/interest target? */
  function normalizedPath(value) {
    var clean = String(value || '/').replace(/\/index\.html$/, '/')
    if (clean.length > 1 && clean.charAt(clean.length - 1) === '/') clean = clean.slice(0, -1)
    return clean || '/'
  }

  function isCurrentPage(target) {
    try {
      var url = new URL(target, window.location.href)
      if (url.origin !== window.location.origin) return false
      return normalizedPath(url.pathname) === normalizedPath(window.location.pathname)
    } catch (_) {
      return window.location.pathname.endsWith(String(target).replace('./', ''))
    }
  }

  function labelFor(id) {
    return PRODUCTS[id] ? PRODUCTS[id].name : PRODUCTS['lodge-camp'].name
  }
  var BUSINESS_FIELD_LABEL = PRODUCTS[PAGE_PRODUCT].businessLabel
  var BUSINESS_FIELD_PLACEHOLDER = PRODUCTS[PAGE_PRODUCT].businessPlaceholder

  /* ======================================================================
     Consent-gated analytics (custom + Google)
     ====================================================================== */
  function getConsent() {
    try { return localStorage.getItem(CONSENT_KEY) } catch (_) { return null }
  }
  function hasAnalyticsConsent() { return getConsent() === 'true' }

  function trackEvent(action, label) {
    if (!hasAnalyticsConsent()) return
    try {
      var payload = { action: action, label: label || '', url: location.pathname, ts: new Date().toISOString() }
      fetch(SUPABASE_URL + '/rest/v1/analytics_events', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: SUPABASE_ANON_KEY,
          Authorization: 'Bearer ' + SUPABASE_ANON_KEY
        },
        body: JSON.stringify(payload)
      }).catch(function () {})
    } catch (_) {}
  }

  function applyGoogleConsent(granted) {
    if (typeof window.gtag === 'function') {
      window.gtag('consent', 'update', { analytics_storage: granted ? 'granted' : 'denied' })
    }
  }

  if (hasAnalyticsConsent()) applyGoogleConsent(true)

  /* ======================================================================
     Release discovery (per product, explicit states)
     States: loading | available | unavailable | error | coming-soon
     ====================================================================== */
  var releaseState = {
    status: 'loading',
    version: '',
    url: '',
    productId: PAGE_PRODUCT
  }
  var releaseWaiters = []

  function onReleaseReady(fn) {
    if (releaseState.status !== 'loading') fn(releaseState)
    else releaseWaiters.push(fn)
  }
  function settleRelease(state) {
    releaseState = state
    releaseWaiters.forEach(function (fn) { try { fn(state) } catch (_) {} })
    releaseWaiters = []
    paintReleaseState(state)
  }

  function paintReleaseState(state) {
    var ve = document.getElementById('download-version')
    if (ve) {
      if (state.status === 'available' && state.version) {
        ve.textContent = labelFor(state.productId) + ' v' + state.version + ' — Windows 10+ (64-bit)'
      } else if (state.status === 'available') {
        ve.textContent = labelFor(state.productId) + ' — Windows 10+ (64-bit)'
      } else if (state.status === 'coming-soon') {
        ve.textContent = labelFor(state.productId) + ' is coming soon. Register your interest and we will contact you at launch.'
      } else if (state.status === 'unavailable') {
        ve.textContent = labelFor(state.productId) + ' installer is preparing for release. Contact us for early access.'
      } else if (state.status === 'error') {
        ve.textContent = 'Could not check the latest ' + labelFor(state.productId) + ' release. Register your details to continue, or contact us for help.'
      } else {
        ve.textContent = 'Checking the latest ' + labelFor(state.productId) + ' release…'
      }
    }
  }

  function fetchLatestRelease(productId) {
    var product = PRODUCTS[productId]
    if (!product || product.comingSoon || !product.trial) {
      settleRelease({ status: 'coming-soon', version: '', url: '', productId: productId })
      return
    }
    var apiUrl = 'https://api.github.com/repos/Rabafi/' + product.repo + '/releases/latest'

    var controller = typeof AbortController !== 'undefined' ? new AbortController() : null
    var timer = controller ? setTimeout(function () { controller.abort() }, 8000) : null

    fetch(apiUrl, controller ? { signal: controller.signal } : undefined)
      .then(function (res) {
        if (timer) clearTimeout(timer)
        if (!res.ok) throw new Error('HTTP ' + res.status)
        return res.json()
      })
      .then(function (data) {
        var tag = data && data.tag_name ? data.tag_name : ''
        var version = tag.replace(/^v/, '')
        var assets = (data && data.assets) || []
        var asset = null
        for (var i = 0; i < assets.length; i++) {
          var name = assets[i].name || ''
          if (name.endsWith('-x64.exe') || (name.endsWith('.exe') && !name.endsWith('.blockmap.exe'))) {
            asset = assets[i]
            break
          }
        }
        if (asset && asset.browser_download_url) {
          var url = asset.browser_download_url
          settleRelease({ status: 'available', version: version, url: url, productId: productId })
        } else {
          settleRelease({ status: 'unavailable', version: version, url: '', productId: productId })
        }
      })
      .catch(function () {
        if (timer) clearTimeout(timer)
        settleRelease({ status: 'error', version: '', url: product.fallbackUrl || '', productId: productId })
      })
  }

  /* ======================================================================
     Active nav highlight
     ====================================================================== */
  var currentPage = (document.body && document.body.dataset.page) || 'home'
  document.querySelectorAll('[data-nav]').forEach(function (link) {
    if (link.getAttribute('data-nav') === currentPage) {
      link.classList.add('is-active')
      link.setAttribute('aria-current', 'page')
    }
  })

  /* ======================================================================
     Mobile menu (accessible: focus move, Escape, restore, scroll lock)
     ====================================================================== */
  var toggle = document.querySelector('.menu-toggle')
  var mobileOverlay = document.getElementById('mobile-overlay')
  var lastMenuFocus = null

  function getFocusable(container) {
    return Array.prototype.slice.call(
      container.querySelectorAll('a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])')
    ).filter(function (el) { return el.offsetParent !== null || el === document.activeElement })
  }

  function openMenu() {
    if (!toggle || !mobileOverlay) return
    lastMenuFocus = document.activeElement
    toggle.classList.add('is-open')
    toggle.setAttribute('aria-expanded', 'true')
    toggle.setAttribute('aria-label', 'Close navigation menu')
    mobileOverlay.classList.add('is-open')
    mobileOverlay.setAttribute('aria-hidden', 'false')
    document.body.classList.add('menu-open')
    document.body.style.overflow = 'hidden'
    var focusables = getFocusable(mobileOverlay)
    if (focusables.length) focusables[0].focus()
  }

  function closeMenu(restoreFocus) {
    if (!toggle || !mobileOverlay) return
    toggle.classList.remove('is-open')
    toggle.setAttribute('aria-expanded', 'false')
    toggle.setAttribute('aria-label', 'Open navigation menu')
    mobileOverlay.classList.remove('is-open')
    mobileOverlay.setAttribute('aria-hidden', 'true')
    document.body.classList.remove('menu-open')
    document.body.style.overflow = ''
    if (restoreFocus !== false && lastMenuFocus && lastMenuFocus.focus) lastMenuFocus.focus()
  }

  function isMenuOpen() { return !!(mobileOverlay && mobileOverlay.classList.contains('is-open')) }

  if (toggle && mobileOverlay) {
    toggle.addEventListener('click', function () {
      if (isMenuOpen()) closeMenu()
      else openMenu()
    })
    mobileOverlay.querySelectorAll('.mobile-nav a, .mobile-overlay-footer a').forEach(function (link) {
      link.addEventListener('click', function () { closeMenu(false) })
    })
    var bg = mobileOverlay.querySelector('.mobile-overlay-bg')
    if (bg) bg.addEventListener('click', function () { closeMenu() })
    mobileOverlay.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { e.stopPropagation(); closeMenu(); return }
      if (e.key !== 'Tab') return
      var focusables = getFocusable(mobileOverlay)
      if (!focusables.length) return
      var first = focusables[0]
      var last = focusables[focusables.length - 1]
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
    })
  }

  /* ======================================================================
     Scroll progress + topbar compact
     ====================================================================== */
  var scrollProgress = document.getElementById('scroll-progress')
  var topbar = document.getElementById('topbar')
  var scrollTicking = false
  var lastScrollY = 0

  window.addEventListener('scroll', function () {
    if (scrollTicking) return
    scrollTicking = true
    window.requestAnimationFrame(function () {
      var y = window.scrollY
      if (scrollProgress) {
        var docH = document.documentElement.scrollHeight - window.innerHeight
        scrollProgress.style.width = (docH > 0 ? (y / docH) * 100 : 0) + '%'
      }
      if (topbar) {
        topbar.classList.toggle('is-compact', y > 120)
        if (y > 300) {
          if (y < lastScrollY) topbar.classList.remove('is-hidden')
          else if (y - lastScrollY > 8 && !isMenuOpen()) topbar.classList.add('is-hidden')
        } else {
          topbar.classList.remove('is-hidden')
        }
      }
      lastScrollY = y
      scrollTicking = false
    })
  }, { passive: true })

  if (scrollProgress) requestAnimationFrame(function () { scrollProgress.classList.add('is-ready') })

  /* ======================================================================
     Reveal on scroll (only when motion allowed; content visible without JS)
     ====================================================================== */
  if (!reducedMotion && 'IntersectionObserver' in window) {
    var revealObserver = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible')
          revealObserver.unobserve(entry.target)
        }
      })
    }, { threshold: 0.12 })
    document.querySelectorAll('.reveal').forEach(function (el) { revealObserver.observe(el) })
  } else {
    document.querySelectorAll('.reveal').forEach(function (el) { el.classList.add('is-visible') })
  }

  /* ======================================================================
     Dialog helper: focus trap + Escape + restore (menu / modal / lightbox)
     ====================================================================== */
  function trapFocus(container, e) {
    if (e.key !== 'Tab') return
    var focusables = getFocusable(container)
    if (!focusables.length) return
    var first = focusables[0]
    var last = focusables[focusables.length - 1]
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
  }

  /* ======================================================================
     Trial product chooser + trial form modal
     ====================================================================== */
  var modalRoot = null
  var modalReturnFocus = null

  function ensureModal() {
    if (modalRoot) return modalRoot
    modalRoot = document.createElement('div')
    modalRoot.className = 'modal-root'
    modalRoot.innerHTML =
      '<div class="modal-overlay" data-close="1"></div>' +
      '<div class="modal-box" role="dialog" aria-modal="true" aria-labelledby="modal-title">' +
        '<button class="modal-close" type="button" aria-label="Close dialog">&times;</button>' +
        '<div class="modal-body" id="modal-body"></div>' +
      '</div>'
    document.body.appendChild(modalRoot)
    modalRoot.querySelector('.modal-overlay').addEventListener('click', closeModal)
    modalRoot.querySelector('.modal-close').addEventListener('click', function () { closeModal() })
    modalRoot.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { e.stopPropagation(); closeModal(); return }
      trapFocus(modalRoot.querySelector('.modal-box'), e)
    })
    return modalRoot
  }

  function openModal(html) {
    ensureModal()
    if (!modalRoot.classList.contains('is-open')) modalReturnFocus = document.activeElement
    document.getElementById('modal-body').innerHTML = html
    modalRoot.classList.add('is-open')
    document.body.style.overflow = 'hidden'
    var focusables = getFocusable(modalRoot)
    if (focusables.length) focusables[0].focus()
  }

  function closeModal() {
    if (!modalRoot) return
    modalRoot.classList.remove('is-open')
    document.getElementById('modal-body').innerHTML = ''
    document.body.style.overflow = ''
    if (modalReturnFocus && modalReturnFocus.focus) modalReturnFocus.focus()
    modalReturnFocus = null
  }

  function chooserHtml(context) {
    var options = PRODUCT_ORDER.map(function (id) {
      var p = PRODUCTS[id]
      var isHotel = !!p.comingSoon
      var cta = isHotel ? 'Register interest' : 'Start free month'
      var cls = 'chooser-option' + (isHotel ? ' is-disabled' : '')
      return '<' + (isHotel ? 'a href="' + p.page + '"' : 'button type="button" data-choose="' + id + '"') + ' class="' + cls + '" style="--opt-accent:' + p.accent + '">' +
        '<span class="opt-swatch" aria-hidden="true"></span>' +
        '<span class="opt-copy"><strong>' + p.name + (isHotel ? ' — Coming soon' : '') + '</strong><span>' + p.blurb + '</span></span>' +
        '<span class="opt-cta">' + cta + '</span>' +
      '</' + (isHotel ? 'a' : 'button') + '>'
    }).join('')

    return '<h3 id="modal-title">Choose your application</h3>' +
      '<p>Tsa Bonno is a product family. Pick the application that matches how your business runs. ' +
      (context === 'plan' ? 'Your package choice is kept for the next step.' : '') + '</p>' +
      '<div class="chooser-list">' + options + '</div>' +
      '<p class="modal-footnote">One 1-month free trial per property. No credit card required. Capacity limits apply by package. HotelOS is coming soon — register interest instead.</p>'
  }

  function trialFormHtml(productId, plan) {
    var p = PRODUCTS[productId] || PRODUCTS['lodge-camp']
    var planLine = plan ? '<p class="small muted">Package interest: <strong>' + plan + '</strong></p>' : ''
    var page = (document.body && document.body.dataset.page) || 'website'
    var venueDefault = page === 'restaurant-pos' ? 'restaurant' : (page === 'bar-pos' ? 'bar' : '')
    var venueLine = productId === 'hospitality-pos'
      ? '<div class="form-field"><label for="tf-venue">Venue type <select id="tf-venue" name="venueType" required>' +
        '<option value=""' + (venueDefault ? '' : ' selected') + '>Choose your venue type</option>' +
        '<option value="restaurant"' + (venueDefault === 'restaurant' ? ' selected' : '') + '>Restaurant</option>' +
        '<option value="bar"' + (venueDefault === 'bar' ? ' selected' : '') + '>Bar</option>' +
        '<option value="restaurant-bar"' + (venueDefault === 'restaurant-bar' ? ' selected' : '') + '>Restaurant and bar</option>' +
        '<option value="other"' + (venueDefault === 'other' ? ' selected' : '') + '>Other hospitality venue</option>' +
      '</select></label></div>'
      : ''
    return '<h3 id="modal-title">Start your free month — ' + p.short + '</h3>' +
      '<p>Register for the 1-month free trial of ' + p.name + '. Once your details are saved, we will show the installer for this product. ' +
      '<strong>The next page shows the safe steps.</strong></p>' +
      planLine +
      '<form class="modal-form" id="trial-form" novalidate>' +
        '<div class="form-field"><label for="tf-business">' + p.businessLabel + ' <input type="text" id="tf-business" name="business" placeholder="' + p.businessPlaceholder + '" required autocomplete="organization" /></label></div>' +
        venueLine +
        '<div class="form-field"><label for="tf-name">Your name <input type="text" id="tf-name" name="contactName" placeholder="Your full name" required autocomplete="name" /></label></div>' +
        '<div class="form-field"><label for="tf-email">Email <input type="email" id="tf-email" name="email" placeholder="name@example.com" required autocomplete="email" /></label></div>' +
        '<div class="form-field"><label for="tf-phone">Phone or WhatsApp <input type="text" id="tf-phone" name="phone" placeholder="+267…" autocomplete="tel" /></label></div>' +
        '<div id="trial-form-error" hidden></div>' +
        '<button class="btn btn-primary" type="submit" id="trial-submit">Register and continue</button>' +
        '<p class="modal-footnote">No credit card required. Free 1-month trial, once per property.</p>' +
      '</form>'
  }

  /* Generic enquiry forms retain their current CRM insert contract. */
  function submitLead(payload) {
    var controller = typeof AbortController !== 'undefined' ? new AbortController() : null
    var timer = controller ? setTimeout(function () { controller.abort() }, LEAD_TIMEOUT_MS) : null
    return fetch(LEADS_TABLE, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: SUPABASE_ANON_KEY,
        Authorization: 'Bearer ' + SUPABASE_ANON_KEY,
        Prefer: 'return=minimal'
      },
      body: JSON.stringify(payload),
      signal: controller ? controller.signal : undefined
    }).then(function (res) {
      if (timer) clearTimeout(timer)
      // A conflict is not proof that this particular enquiry was saved.
      if (res.ok) return { ok: true, status: res.status }
      return { ok: false, status: res.status }
    }).catch(function (err) {
      if (timer) clearTimeout(timer)
      return { ok: false, status: err && err.name === 'AbortError' ? 'timeout' : 'network' }
    })
  }

  function newTrialConfirmationToken() {
    try {
      if (window.crypto && typeof window.crypto.randomUUID === 'function') return window.crypto.randomUUID()
    } catch (_) {}
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      var r = Math.random() * 16 | 0
      return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16)
    })
  }

  function attachTrialFormHandler(productId, plan) {
    var form = document.getElementById('trial-form')
    if (!form) return
    var submitBtn = document.getElementById('trial-submit')
    var errorBox = document.getElementById('trial-form-error')
    var inFlight = false

    form.addEventListener('submit', function (e) {
      e.preventDefault()
      if (inFlight) return
      var data = new FormData(form)
      var business = (data.get('business') || '').trim()
      var contactName = (data.get('contactName') || '').trim()
      var email = (data.get('email') || '').trim()
      var phone = (data.get('phone') || '').trim()
      var venueType = productId === 'hospitality-pos' ? (data.get('venueType') || '').trim() : ''

      if (!business || !contactName || !email) {
        showTrialError(errorBox, 'Please fill in your business name, your name and a valid email address.', form, submitBtn)
        return
      }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        showTrialError(errorBox, 'That email address does not look right. Please check it or use WhatsApp instead.', form, submitBtn)
        return
      }
      if (productId === 'hospitality-pos' && !['restaurant', 'bar', 'restaurant-bar', 'other'].includes(venueType)) {
        showTrialError(errorBox, 'Choose whether this request is for a restaurant, bar, both, or another hospitality venue.', form, submitBtn)
        return
      }

      inFlight = true
      submitBtn.disabled = true
      submitBtn.textContent = 'Sending…'
      if (errorBox) { errorBox.hidden = true; errorBox.innerHTML = '' }

      var venueLabel = venueType === 'restaurant-bar' ? 'Restaurant and bar' : venueType ? venueType.charAt(0).toUpperCase() + venueType.slice(1) : ''
      var planInterest = labelFor(productId) + (venueLabel ? ' — ' + venueLabel : '') + (plan ? ' — ' + plan : '')
      var payload = {
        lodge_name: business,
        contact_name: contactName,
        email: email,
        phone: phone || null,
        interest: planInterest + ' trial',
        notes: 'Self-service trial registration for ' + planInterest + '; page: ' + ((document.body && document.body.dataset.page) || 'website'),
        source: 'website-trial-' + productId + (venueType ? '-' + venueType : '')
      }
      submitLead(payload).then(function (result) {
        if (result.ok) {
          var confirmationToken = newTrialConfirmationToken()
          writeTrialConfirmation({ productId: productId, venueType: venueType, plan: plan || '', confirmationToken: confirmationToken })
          trackEvent('lead_confirmed', productId)
          showTrialSuccess(productId, plan, venueType, confirmationToken)
        } else {
          inFlight = false
          var definitiveRejection = [400, 401, 403, 404, 422].indexOf(result.status) >= 0
          var ambiguous = !definitiveRejection
          submitBtn.disabled = ambiguous
          submitBtn.textContent = definitiveRejection ? 'Try again' : 'Registration status unknown'
          if (ambiguous) form.querySelectorAll('input, select').forEach(function (field) { field.disabled = true })
          var reason = result.status === 'timeout'
            ? 'The request timed out.'
            : (typeof result.status === 'number' ? 'The server returned an error (' + result.status + ').' : 'We could not reach the server.')
          showTrialError(
            errorBox,
            reason + (ambiguous
              ? ' We could not confirm whether your registration was received, so no installer is shown. Do not submit again yet; contact us on WhatsApp or email and we will check the request.'
              : ' The request was rejected and no installer is available. Correct any details above or try again; contact us if the problem continues.'),
            form,
            submitBtn
          )
        }
      })
    })
  }

  function showTrialError(errorBox, message, form, submitBtn) {
    if (!errorBox) return
    errorBox.hidden = false
    errorBox.className = 'form-error'
    errorBox.setAttribute('role', 'alert')
    errorBox.innerHTML = '<strong>We could not send that yet.</strong> ' + message +
      ' <div class="form-error-actions">' +
      '<a class="btn btn-sm btn-secondary" href="' + WHATSAPP_LINK + '?text=Hello%20Tsa%20Bonno%2C%20I%20could%20not%20complete%20the%20trial%20form." target="_blank" rel="noreferrer">Chat on WhatsApp</a>' +
      '<a class="btn btn-sm btn-secondary" href="mailto:support@tsabonno.com?subject=Trial%20registration%20help">Email us</a>' +
      '</div>'
    errorBox.scrollIntoView({ block: 'nearest', behavior: reducedMotion ? 'auto' : 'smooth' })
    if (form && !errorBox.dataset.focusBound) {
      errorBox.dataset.focusBound = '1'
      var firstLink = errorBox.querySelector('a')
      if (firstLink) firstLink.focus()
    }
  }

  var confirmedTrialAccess = null
  function writeTrialConfirmation(details) {
    confirmedTrialAccess = {
      productId: details.productId,
      venueType: details.venueType || '',
      plan: details.plan || '',
      confirmationToken: details.confirmationToken,
      confirmedAt: Date.now()
    }
    try { window.sessionStorage.setItem('tsa_confirmed_trial_access', JSON.stringify(confirmedTrialAccess)) } catch (_) {}
  }

  function readTrialConfirmation(productId) {
    var details = confirmedTrialAccess
    try {
      var stored = JSON.parse(window.sessionStorage.getItem('tsa_confirmed_trial_access') || 'null')
      if (stored && stored.productId === productId && stored.confirmationToken) details = stored
    } catch (_) {}
    if (!details || details.productId !== productId || !details.confirmationToken) return null
    if (!/^([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i.test(details.confirmationToken)) return null
    if (Date.now() - Number(details.confirmedAt || 0) > 30 * 60 * 1000) return null
    return details
  }

  function showTrialSuccess(productId, plan, venueType, confirmationToken) {
    var p = PRODUCTS[productId] || PRODUCTS['lodge-camp']
    var body = document.getElementById('modal-body')
    if (!body) return
    var confirmed = readTrialConfirmation(productId)
    if (!confirmed || confirmed.confirmationToken !== confirmationToken) return

    var readyHtml = ''
    if (releaseState.productId === productId && releaseState.status === 'available' && releaseState.url) {
      readyHtml = '<a class="btn btn-primary" href="' + releaseState.url + '" target="_blank" rel="noreferrer">Download ' + p.short + ' for Windows</a>' +
        (releaseState.version ? '<p class="modal-footnote">Version v' + releaseState.version + ' — Windows 10+ (64-bit)</p>' : '')
    } else if (p.fallbackUrl) {
      readyHtml = '<a class="btn btn-primary" href="' + (p.fallbackUrl || WHATSAPP_LINK) + '" target="_blank" rel="noreferrer">Open the ' + p.short + ' release page</a>' +
        '<p class="modal-footnote">We could not automatically confirm the newest installer. The release page always shows the current download.</p>'
    } else {
      readyHtml = '<a class="btn btn-primary" href="' + WHATSAPP_LINK + '?text=Hello%20Tsa%20Bonno%2C%20I%20registered%20for%20the%20' + encodeURIComponent(p.short) + '%20trial%20and%20need%20the%20installer." target="_blank" rel="noreferrer">Get early access on WhatsApp</a>' +
        '<p class="modal-footnote">' + p.short + ' installer access is limited right now. We will send yours personally.</p>'
    }

    // Privacy: never place contact details in the URL (browser history, logs).
    var thankYouHref = './thank-you.html?from=trial' + '&product=' + encodeURIComponent(productId) + (venueType ? '&venue=' + encodeURIComponent(venueType) : '')

    body.innerHTML =
      '<div class="demo-success">' +
        '<div class="demo-success-icon" aria-hidden="true">✓</div>' +
        '<h3 id="modal-title">Registration received</h3>' +
        '<p class="muted">Your ' + p.name + ' trial request has been saved' + (plan ? ' for the <strong>' + plan + '</strong> package' : '') + '. Continue below to get the matching installer and setup steps.</p>' +
        readyHtml +
        '<p style="margin-top:14px;"><a class="btn btn-secondary" href="' + thankYouHref + '">See the Windows install steps</a></p>' +
        '<p class="modal-footnote">Your free 1-month trial is once per property and works with your real setup. No credit card required.</p>' +
        '<p style="margin-top:16px;"><a class="text-link" href="' + p.page + '">See how ' + p.short + ' works</a></p>' +
      '</div>'
    var heading = body.querySelector('#modal-title')
    if (heading) { heading.setAttribute('tabindex', '-1'); heading.focus() }
  }

  /* ======================================================================
     Global click handler for CTAs
     ====================================================================== */
  document.addEventListener('click', function (e) {
    var target = e.target.closest ? e.target.closest('[data-action]') : null
    if (!target) return
    var action = target.getAttribute('data-action')
    if (action !== 'trial' && action !== 'download' && action !== 'interest') return
    e.preventDefault()

    var productAttr = target.getAttribute('data-product')
    var productId = PRODUCTS[productAttr] ? productAttr : explicitProductId()
    var plan = target.getAttribute('data-plan') || readStore('tsa_selected_plan') || ''

    // Coming-soon products never open a trial/download flow: Register interest only.
    if (action === 'interest' || (productId && PRODUCTS[productId] && PRODUCTS[productId].comingSoon)) {
      var interestProduct = productId || PAGE_PRODUCT
      var interestPage = PRODUCTS[interestProduct] ? PRODUCTS[interestProduct].page : './hotel.html'
      if (isCurrentPage(interestPage)) {
        // Already on that product's page: scroll to the interest section.
        var interestSection = document.getElementById('interest') || document.getElementById('trial')
        if (interestSection) {
          interestSection.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth' })
          var focusTarget = interestSection.querySelector('h2, h3, input, button')
          if (focusTarget && focusTarget.focus) focusTarget.focus({ preventScroll: true })
        }
        return
      }
      if (interestProduct === 'hotel') {
        var configuredHotelPage = siteProductPage('hotel')
        if (configuredHotelPage) {
          window.location.href = configuredHotelPage
        } else {
          window.location.href = './hotel.html'
        }
      } else {
        window.location.href = interestPage + '#interest'
      }
      return
    }

    if (action === 'download' || action === 'trial') {
      if (!productId) {
        // Generic CTA with no explicit product: show the chooser (never silently pick Lodge).
        openModal(chooserHtml('cta'))
        trackEvent('chooser_open', 'cta')
        return
      }
      var p = PRODUCTS[productId]
      if (p.comingSoon || !p.trial) {
        window.location.href = p.page + '#interest'
        return
      }
      writeStore('tsa_selected_product', productId)
      openModal(trialFormHtml(productId, plan))
      attachTrialFormHandler(productId, plan)
      trackEvent('trial_modal_open', productId)
    }
  })

  // Chooser option selection (delegated inside modal)
  document.addEventListener('click', function (e) {
    var opt = e.target.closest ? e.target.closest('[data-choose]') : null
    if (!opt) return
    var id = opt.getAttribute('data-choose')
    if (!PRODUCTS[id]) return
    writeStore('tsa_selected_product', id)
    trackEvent('product_chosen', id)
    if (PRODUCTS[id].comingSoon || !PRODUCTS[id].trial) {
      window.location.href = PRODUCTS[id].page + '#interest'
      return
    }
    var plan = readStore('tsa_selected_plan') || ''
    openModal(trialFormHtml(id, plan))
    attachTrialFormHandler(id, plan)
  })

  /* ======================================================================
     Lead forms on pages (.demo-form) — enquiry, honest outcome
     ====================================================================== */
  document.querySelectorAll('.demo-form').forEach(function (form) {
    var submitBtn = form.querySelector('button[type="submit"]')
    var note = form.querySelector('.demo-note')
    var inFlight = false

    form.addEventListener('submit', function (event) {
      event.preventDefault()
      if (inFlight) return
      var data = new FormData(form)
      var business = (data.get('lodgeName') || data.get('business') || '').trim()
      var contactName = (data.get('contactName') || '').trim()
      var email = (data.get('email') || '').trim()
      var phone = (data.get('phone') || '').trim()
      var interest = (data.get('interest') || '').trim()
      var notesValue = (data.get('notes') || '').trim()

      if (!business || !contactName || !email) {
        setFormStatus(form, 'Please fill in the required fields (business name, your name and email).', 'error')
        return
      }

      inFlight = true
      if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Sending…' }

      var payload = {
        lodge_name: business,
        contact_name: contactName,
        email: email,
        phone: phone || null,
        interest: interest || null,
        notes: notesValue || null,
        source: 'website-enquiry'
      }

      submitLead(payload).then(function (result) {
        if (result.ok) {
          trackEvent('enquiry_sent', interest || 'general')
          form.innerHTML =
            '<div class="demo-success">' +
              '<div class="demo-success-icon" aria-hidden="true">✓</div>' +
              '<h3>Enquiry received</h3>' +
              '<p class="muted">Thank you, ' + escapeHtml(contactName.split(' ')[0] || contactName) + '. Your enquiry about' +
              (interest ? ' <strong>' + escapeHtml(interest) + '</strong>' : ' Tsa Bonno') +
              ' has reached our team. We will reply by email, usually within one working day.</p>' +
              '<p class="small muted">Prefer to talk now? <a href="' + WHATSAPP_LINK + '" target="_blank" rel="noreferrer">Chat on WhatsApp</a> or email <a href="mailto:support@tsabonno.com">support@tsabonno.com</a>.</p>' +
            '</div>'
          var h = form.querySelector('h3')
          if (h) { h.setAttribute('tabindex', '-1'); h.focus() }
        } else {
          inFlight = false
          if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = submitBtn.getAttribute('data-label') || 'Send enquiry' }
          var reason = result.status === 'timeout'
            ? 'The request timed out.'
            : (typeof result.status === 'number' ? 'The server returned an error (' + result.status + ').' : 'We could not reach the server.')
          setFormStatus(
            form,
            reason + ' We could not confirm whether your enquiry was received. Please contact us on WhatsApp or email before trying again.',
            'error'
          )
        }
      })
    })
  })

  function setFormStatus(form, message, kind) {
    var status = form.querySelector('.form-status')
    if (!status) {
      status = document.createElement('div')
      status.className = 'form-status'
      form.appendChild(status)
    }
    status.className = 'form-status' + (kind === 'error' ? ' form-error' : '')
    status.setAttribute('role', kind === 'error' ? 'alert' : 'status')
    status.textContent = message
  }

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    })
  }

  // Remember the submit label so failure can restore it.
  document.querySelectorAll('.demo-form button[type="submit"]').forEach(function (btn) {
    if (!btn.getAttribute('data-label')) btn.setAttribute('data-label', btn.textContent)
  })

  /* ======================================================================
     Cookie banner (non-modal notice) + reopen control
     ====================================================================== */
  var cookieBanner = document.querySelector('.cookie-banner')
  var cookieAccept = document.querySelector('.cookie-accept')
  var cookieDecline = document.querySelector('.btn-cookie-decline')

  function showCookieBanner() {
    if (cookieBanner) {
      cookieBanner.classList.add('is-visible')
      document.body.classList.add('has-cookie-banner')
    }
  }
  function hideCookieBanner() {
    if (cookieBanner) {
      cookieBanner.classList.remove('is-visible')
      document.body.classList.remove('has-cookie-banner')
    }
  }

  if (cookieBanner) {
    if (!getConsent()) showCookieBanner()
    if (cookieAccept) {
      cookieAccept.addEventListener('click', function () {
        try { localStorage.setItem(CONSENT_KEY, 'true') } catch (_) {}
        applyGoogleConsent(true)
        hideCookieBanner()
      })
    }
    if (cookieDecline) {
      cookieDecline.addEventListener('click', function () {
        try { localStorage.setItem(CONSENT_KEY, 'denied') } catch (_) {}
        applyGoogleConsent(false)
        hideCookieBanner()
      })
    }
  }

  document.querySelectorAll('[data-action="cookie-settings"]').forEach(function (link) {
    link.addEventListener('click', function (e) { e.preventDefault(); showCookieBanner() })
  })

  /* ======================================================================
     Lightbox for product proof images
     ====================================================================== */
  var zoomTargets = document.querySelectorAll('.showcase-image-frame img, [data-zoom]')
  if (zoomTargets.length) {
    var lb = document.createElement('div')
    lb.className = 'lightbox'
    lb.setAttribute('role', 'dialog')
    lb.setAttribute('aria-modal', 'true')
    lb.setAttribute('aria-label', 'Enlarged product screenshot')
    lb.innerHTML = '<button class="lightbox-close" type="button" aria-label="Close enlarged view">&times;</button>' +
      '<img alt="" /><div class="lightbox-caption"></div>'
    document.body.appendChild(lb)
    var lbImg = lb.querySelector('img')
    var lbCap = lb.querySelector('.lightbox-caption')
    var lbReturn = null

    function openLightbox(img, caption) {
      lbReturn = document.activeElement
      lbImg.src = img.currentSrc || img.src
      lbImg.alt = img.alt || ''
      lbCap.textContent = caption || ''
      lb.classList.add('is-open')
      document.body.style.overflow = 'hidden'
      lb.querySelector('.lightbox-close').focus()
    }
    function closeLightbox() {
      lb.classList.remove('is-open')
      document.body.style.overflow = ''
      if (lbReturn && lbReturn.focus) lbReturn.focus()
    }

    lb.querySelector('.lightbox-close').addEventListener('click', closeLightbox)
    lb.addEventListener('click', function (e) { if (e.target === lb) closeLightbox() })
    lb.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { e.stopPropagation(); closeLightbox(); return }
      trapFocus(lb, e)
    })

    zoomTargets.forEach(function (img) {
      img.setAttribute('tabindex', '0')
      img.setAttribute('role', 'button')
      if (!img.getAttribute('aria-label')) img.setAttribute('aria-label', 'Enlarge screenshot: ' + (img.alt || 'product view'))
      function trigger() {
        var card = img.closest('.showcase-card')
        var captionEl = card ? card.querySelector('h3') : null
        openLightbox(img, captionEl ? captionEl.textContent : '')
      }
      img.addEventListener('click', trigger)
      img.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); trigger() }
      })
    })
  }

  /* ======================================================================
     WhatsApp float
     ====================================================================== */
  ;(function initWhatsApp() {
    var el = document.createElement('div')
    el.innerHTML =
      '<a class="wa-float" href="' + WHATSAPP_LINK + '?text=Hello%20Tsa%20Bonno%20HospitalityOS%2C%20I%20have%20a%20question." target="_blank" rel="noreferrer" aria-label="Chat with Tsa Bonno on WhatsApp">' +
      '<svg width="26" height="26" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5.1-1.3A10 10 0 1 0 12 2zm5.5 14.1c-.2.6-1.2 1.2-1.7 1.2-.5.1-1 .1-1.7-.1-2.6-.8-4.6-2.9-5.7-5.4-.4-.9-.4-1.6-.2-2.2.2-.5.9-1.4 1.4-1.4h.5c.2 0 .4 0 .6.5l.8 1.9c.1.2 0 .4-.1.6l-.5.7c-.1.2-.3.3-.1.6.5.9 1.2 1.7 2 2.3.7.5 1.2.7 1.5.8.2.1.4 0 .5-.1l.7-.9c.2-.2.3-.2.6-.1l1.6.8c.3.1.4.2.5.3.1.2.1.7-.1 1.3z"/></svg></a>'
    document.body.appendChild(el)
  })()

  /* ======================================================================
     Hotel add-on estimate (packages page). Labels itself an estimate;
     submitted quotes remain server-authoritative.
     ====================================================================== */
  var addonBuilder = document.querySelector('[data-hotel-addon-builder]')
  if (addonBuilder) {
    var money = new Intl.NumberFormat('en-BW', { maximumFractionDigits: 0 })
    var addonInputs = addonBuilder.querySelectorAll('input[type="checkbox"]')
    var setupOutput = addonBuilder.querySelector('[data-addon-setup-total]')
    var annualOutput = addonBuilder.querySelector('[data-addon-annual-total]')
    var updateAddonEstimate = function () {
      var setup = 37998
      var annual = 0
      addonInputs.forEach(function (input) {
        if (!input.checked) return
        setup += Number(input.dataset.setup || 0)
        annual += Number(input.dataset.annual || 0)
      })
      if (setupOutput) setupOutput.textContent = 'P' + money.format(setup)
      if (annualOutput) annualOutput.textContent = 'P' + money.format(annual)
    }
    addonInputs.forEach(function (input) { input.addEventListener('change', updateAddonEstimate) })
    updateAddonEstimate()
  }

  /* ======================================================================
     Language toggle (leaf text only; preserves nested markup; persisted)
     ====================================================================== */
  var langToggle = document.querySelector('.lang-toggle')
  if (langToggle) {
    var TN = {
      'hero-cta': 'Simolola sengwaga se se mahala',
      'see-ecosystem': 'Lebelela ekosisteme',
      'see-packages': 'Lebelela dipakete',
      'start-trial': 'Simolola trial',
      'explore': 'Batla tsebe',
      'faq': 'Dipotso tse di tlwaelegileng',
      'contact': 'Ikgolaganye'
    }
    var lang = 'en'
    try { lang = localStorage.getItem('tsa_lang') || 'en' } catch (_) {}

    function applyLang(next) {
      lang = next
      document.documentElement.lang = next
      langToggle.textContent = next === 'en' ? 'TN' : 'EN'
      langToggle.setAttribute('aria-label', next === 'en' ? 'Switch to Setswana' : 'Switch to English')
      document.querySelectorAll('[data-tn]').forEach(function (el) {
        var key = el.getAttribute('data-tn')
        if (!TN[key]) return
        var target = el.firstElementChild || el
        if (!el.getAttribute('data-en-html')) el.setAttribute('data-en-html', target.innerHTML)
        target.innerHTML = next === 'tn' ? TN[key] : el.getAttribute('data-en-html')
      })
      try { localStorage.setItem('tsa_lang', next) } catch (_) {}
    }

    langToggle.addEventListener('click', function () { applyLang(lang === 'en' ? 'tn' : 'en') })
    if (lang === 'tn') applyLang('tn')
  }

  /* ======================================================================
     Product-plan retention: remember the package the visitor picked so the
     trial form can carry it forward (never used as financial truth).
     ====================================================================== */
  document.addEventListener('click', function (e) {
    var el = e.target.closest ? e.target.closest('[data-plan]') : null
    if (!el) return
    var plan = el.getAttribute('data-plan')
    if (plan) writeStore('tsa_selected_plan', plan)
  })

  /* A thank-you URL is not proof of a lead. Only a recent local confirmation
     created after the database returned success can reveal a product link. */
  ;(function applyTrialConfirmation() {
    if (!document.body || document.body.dataset.page !== 'thank-you') return
    var query = new URLSearchParams(window.location.search)
    var productId = query.get('product') || ''
    var product = PRODUCTS[productId]
    var confirmation = query.get('from') === 'trial' ? readTrialConfirmation(productId) : null
    var title = document.getElementById('trial-confirmation-title')
    var copy = document.getElementById('trial-confirmation-copy')
    var registrationActions = document.getElementById('trial-registration-actions')
    var registrationLink = document.getElementById('trial-registration-link')
    var confirmedActions = document.getElementById('trial-confirmed-actions')
    var summary = document.getElementById('trial-confirmed-summary')
    var installerAction = document.getElementById('confirmed-installer-action')
    if (!confirmation || !product) {
      if (registrationLink && product) {
        registrationLink.href = product.page
        registrationLink.textContent = 'Register for ' + product.short
      }
      return
    }

    if (title) title.textContent = 'Registration received'
    if (copy) copy.textContent = 'Your registration was saved in this browser session. The installer below matches the product you selected.'
    if (registrationActions) registrationActions.setAttribute('hidden', '')
    if (confirmedActions) confirmedActions.removeAttribute('hidden')
    if (summary) summary.textContent = 'Tsa Bonno ' + product.short + ' registration is confirmed for this session.'
    onReleaseReady(function (state) {
      if (!installerAction || state.productId !== productId) return
      var href = state.status === 'available' && state.url ? state.url : product.fallbackUrl
      if (href) {
        installerAction.innerHTML = '<a class="btn btn-primary" href="' + href + '" target="_blank" rel="noreferrer">Open ' + product.short + ' installer</a>'
      } else {
        installerAction.innerHTML = '<a class="btn btn-secondary" href="' + WHATSAPP_LINK + '" target="_blank" rel="noreferrer">Contact us for ' + product.short + ' access</a>'
      }
    })
  })()

  /* ======================================================================
     Kick off release discovery
     ====================================================================== */
  fetchLatestRelease(PAGE_PRODUCT)

  // Public surface hooks used by tests and internal wiring.
  window.__TSA_MARKETING__ = {
    PRODUCTS: PRODUCTS,
    PRODUCT_ORDER: PRODUCT_ORDER,
    detectProductId: detectProductId,
    getReleaseState: function () { return releaseState },
    hasAnalyticsConsent: hasAnalyticsConsent
  }
})()
