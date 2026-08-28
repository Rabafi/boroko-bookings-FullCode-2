;(function () {
  const SUPABASE_URL = 'https://oicgpknsmtvcsjacymum.supabase.co'
  const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9pY2dwa25zbXR2Y3NqYWN5bXVtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM2OTM1MTEsImV4cCI6MjA4OTI2OTUxMX0.WbC5C1QaVeNaTbTG0_xdcsUlK3BoA8onWC607B_uGlY'
  const CACHE_TTL = 3600000

  // Product installers are isolated. Restaurant/Hotel pages must never silently
  // serve the LodgingOS installer.
  const PRODUCT_RELEASES = {
    'lodge-camp': {
      label: 'Tsa Bonno HospitalityOS',
      repo: 'boroko-bookings-releases',
      cacheKey: 'bb_release_info_lodge_camp',
      fallbackVersion: '1.5.5',
      fallbackUrl: 'https://github.com/Rabafi/boroko-bookings-releases/releases/latest'
    },
    hotel: {
      label: 'Tsa Bonno HotelOS',
      repo: 'boroko-hotel-releases',
      cacheKey: 'bb_release_info_hotel',
      fallbackVersion: '',
      fallbackUrl: 'https://github.com/Rabafi/boroko-hotel-releases/releases/latest'
    },
    'hospitality-pos': {
      label: 'Tsa Bonno Restaurant & Bar POS',
      repo: 'boroko-hospitality-pos-releases',
      cacheKey: 'bb_release_info_hospitality_pos',
      fallbackVersion: '',
      fallbackUrl: 'https://github.com/Rabafi/boroko-hospitality-pos-releases/releases/latest'
    }
  }

  function detectProductId() {
    var requestedProduct = new URLSearchParams(window.location.search).get('product') || ''
    if (PRODUCT_RELEASES[requestedProduct]) return requestedProduct
    var bodyProduct = (document.body && document.body.dataset.product) || ''
    if (PRODUCT_RELEASES[bodyProduct]) return bodyProduct
    var page = (document.body && document.body.dataset.page) || ''
    if (page === 'restaurant-pos' || page === 'bar-pos') return 'hospitality-pos'
    if (page === 'hotel' || page === 'enterprise') return 'hotel'
    return 'lodge-camp'
  }

  var ACTIVE_PRODUCT_ID = detectProductId()
  var ACTIVE_PRODUCT = PRODUCT_RELEASES[ACTIVE_PRODUCT_ID] || PRODUCT_RELEASES['lodge-camp']
  var BUSINESS_FIELD_LABEL = ACTIVE_PRODUCT_ID === 'hotel' ? 'Hotel name' : ACTIVE_PRODUCT_ID === 'hospitality-pos' ? 'Restaurant or bar name' : 'Lodge name'
  var BUSINESS_FIELD_PLACEHOLDER = ACTIVE_PRODUCT_ID === 'hotel' ? 'Your hotel name' : ACTIVE_PRODUCT_ID === 'hospitality-pos' ? 'Your business name' : 'Your lodge name'
  var GITHUB_LATEST_API = 'https://api.github.com/repos/Rabafi/' + ACTIVE_PRODUCT.repo + '/releases/latest'

  let RELEASE_VERSION = ACTIVE_PRODUCT.fallbackVersion || ''
  let DOWNLOAD_URL = ACTIVE_PRODUCT.fallbackUrl
  let DOWNLOAD_AVAILABLE = ACTIVE_PRODUCT_ID === 'lodge-camp'

  async function fetchLatestRelease() {
    var cached
    try { cached = JSON.parse(localStorage.getItem(ACTIVE_PRODUCT.cacheKey)) } catch (_) {}
    if (cached && Date.now() - cached.ts < CACHE_TTL && cached.url) {
      DOWNLOAD_URL = cached.url
      RELEASE_VERSION = cached.version || ''
      DOWNLOAD_AVAILABLE = true
    } else {
      try {
        var res = await fetch(GITHUB_LATEST_API)
        if (res.ok) {
          var data = await res.json()
          var tag = data.tag_name || ''
          var version = tag.replace(/^v/, '')
          var asset = data.assets && data.assets.find(function (a) { return a.name.endsWith('-x64.exe') || a.name.endsWith('.exe') })
          if (asset && asset.browser_download_url) {
            DOWNLOAD_URL = asset.browser_download_url
            RELEASE_VERSION = version
            DOWNLOAD_AVAILABLE = true
            localStorage.setItem(ACTIVE_PRODUCT.cacheKey, JSON.stringify({ url: DOWNLOAD_URL, version: RELEASE_VERSION, ts: Date.now() }))
          }
        }
      } catch (_) {}
    }
    var fb = document.getElementById('fallback-download')
    if (fb) {
      fb.href = DOWNLOAD_URL
      if (!DOWNLOAD_AVAILABLE) fb.setAttribute('data-unavailable', '1')
    }
    var ve = document.getElementById('download-version')
    if (ve) {
      if (DOWNLOAD_AVAILABLE && RELEASE_VERSION) {
        ve.textContent = ACTIVE_PRODUCT.label + ' v' + RELEASE_VERSION + ' \u2014 Windows 10+ (64-bit)'
      } else if (DOWNLOAD_AVAILABLE) {
        ve.textContent = ACTIVE_PRODUCT.label + ' — Windows 10+ (64-bit)'
      } else {
        ve.textContent = ACTIVE_PRODUCT.label + ' installer is preparing for release. Contact us for early access.'
      }
    }
  }

  var releasePromise = fetchLatestRelease()
  const WHATSAPP_LINK = 'https://wa.me/26772789415'

  const nav = document.querySelector('#site-nav')
  const toggle = document.querySelector('.menu-toggle')
  const topbar = document.querySelector('#topbar')
  const mobileOverlay = document.querySelector('#mobile-overlay')
  const currentPage = document.body.dataset.page || 'home'

  document.querySelectorAll('[data-nav]').forEach(function (link) {
    if (link.dataset.nav === currentPage) {
      link.classList.add('is-active')
    }
  })

  // Mobile overlay toggle
  if (toggle && mobileOverlay) {
    toggle.addEventListener('click', function () {
      const open = toggle.classList.toggle('is-open')
      mobileOverlay.classList.toggle('is-open')
      mobileOverlay.setAttribute('aria-hidden', String(!open))
      toggle.setAttribute('aria-expanded', String(open))
      document.body.style.overflow = open ? 'hidden' : ''
    })
    mobileOverlay.querySelectorAll('.mobile-nav a').forEach(function (link) {
      link.addEventListener('click', function () {
        toggle.classList.remove('is-open')
        mobileOverlay.classList.remove('is-open')
        mobileOverlay.setAttribute('aria-hidden', 'true')
        toggle.setAttribute('aria-expanded', 'false')
        document.body.style.overflow = ''
      })
    })
  }

  // Scroll hide/reveal + compact mode
  if (topbar) {
    var lastScrollY = 0
    var ticking = false
    window.addEventListener('scroll', function () {
      if (!ticking) {
        window.requestAnimationFrame(function () {
          var currentY = window.scrollY
          if (currentY > 120) {
            topbar.classList.add('is-compact')
          } else {
            topbar.classList.remove('is-compact')
          }
          if (currentY > 300) {
            if (currentY < lastScrollY) {
              topbar.classList.remove('is-hidden')
            } else if (currentY - lastScrollY > 8) {
              topbar.classList.add('is-hidden')
            }
          } else {
            topbar.classList.remove('is-hidden')
          }
          lastScrollY = currentY
          ticking = false
        })
        ticking = true
      }
    })
  }

  // Sliding hover pill for nav links
  if (nav && window.matchMedia('(min-width: 641px)').matches) {
    var hoverPill = document.createElement('span')
    hoverPill.className = 'nav-hover-pill'
    nav.appendChild(hoverPill)

    var activeLink = nav.querySelector('.is-active')
    if (activeLink) {
      hoverPill.style.left = activeLink.offsetLeft + 'px'
      hoverPill.style.width = activeLink.offsetWidth + 'px'
      hoverPill.classList.add('is-visible')
    }

    nav.querySelectorAll('a').forEach(function (link) {
      link.addEventListener('mouseenter', function () {
        hoverPill.style.left = link.offsetLeft + 'px'
        hoverPill.style.width = link.offsetWidth + 'px'
        hoverPill.classList.add('is-visible')
      })
    })

    nav.addEventListener('mouseleave', function () {
      if (activeLink) {
        hoverPill.style.left = activeLink.offsetLeft + 'px'
        hoverPill.style.width = activeLink.offsetWidth + 'px'
      } else {
        hoverPill.classList.remove('is-visible')
      }
    })
  }

  const cardRevealTargets = document.querySelectorAll('.feature-card, .step-card, .pricing-card, .why-list article, .story-card, .resource-card, .audience-card, .showcase-card, .stat-card, .content-card, .problem-card')
  const sectionRevealTargets = document.querySelectorAll('.section:not(.hero-section), .band-section, .comparison-card, .demo-form, .faq-grid details')
  if ('IntersectionObserver' in window) {
    const cardObserver = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible')
          cardObserver.unobserve(entry.target)
        }
      })
    }, { threshold: 0.12 })
    cardRevealTargets.forEach(function (el) {
      el.classList.add('reveal')
      cardObserver.observe(el)
    })

    const sectionObserver = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible')
          sectionObserver.unobserve(entry.target)
        }
      })
    }, { threshold: 0.12 })
    sectionRevealTargets.forEach(function (el) {
      el.classList.add('reveal')
      sectionObserver.observe(el)
    })
  }

  const forms = document.querySelectorAll('.demo-form')
  forms.forEach(function (form) {
    form.addEventListener('submit', async function (event) {
      event.preventDefault()
      await releasePromise
      const data = new FormData(form)
      const lodgeName = (data.get('lodgeName') || '').trim()
      const contactName = (data.get('contactName') || '').trim()
      const email = (data.get('email') || '').trim()
      const phone = (data.get('phone') || '').trim()
      const interest = data.get('interest') || ''
      const notesValue = (data.get('notes') || '').trim()

      const submitBtn = form.querySelector('button[type="submit"]')
      if (submitBtn) {
        submitBtn.disabled = true
        submitBtn.textContent = 'Sending...'
      }

      const payload = {
        lodge_name: lodgeName,
        contact_name: contactName,
        email: email,
        phone: phone || null,
        interest: interest || null,
        notes: notesValue || null,
        source: 'website'
      }

      function showSuccess(formEl, noteEl) {
        formEl.innerHTML = '<div class="demo-success"><div class="demo-success-icon">&#10003;</div><h3 style="margin:16px 0 8px;">Your free trial is ready</h3><p style="color:var(--ink-soft);">Download the Tsa Bonno HospitalityOS desktop app below and start your free 1-month trial. Install it, create your lodge, and start operating right away.</p><a class="btn btn-primary" href="' + DOWNLOAD_URL + '" target="_blank" rel="noreferrer" style="margin-bottom:10px;">Download for Windows</a><p style="font-size:0.85rem;color:var(--ink-soft);margin-top:8px;">Version v' + RELEASE_VERSION + ' — Windows 10+ (64-bit). Need help? <a href="https://wa.me/26772789415" target="_blank" rel="noreferrer" style="color:var(--brand);font-weight:700;">Chat on WhatsApp</a></p></div>'
        if (noteEl) noteEl.textContent = ''
      }

      const note = form.querySelector('.demo-note')

      fetch(SUPABASE_URL + '/rest/v1/marketing_leads', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: SUPABASE_ANON_KEY,
          Authorization: 'Bearer ' + SUPABASE_ANON_KEY
        },
        body: JSON.stringify(payload)
      }).then(function (res) {
        if (res.ok || res.status === 409) {
          showSuccess(form, note)
        } else {
          throw new Error('API error')
        }
      }).catch(function () {
        const mailto = buildMailto(lodgeName, contactName, email, phone, interest, notesValue)
        window.location.href = mailto
        if (note) {
          note.textContent = 'Your email app should open as a backup. If it does not, use the email button below.'
          note.style.color = '#cc4444'
        }
        if (submitBtn) {
          submitBtn.disabled = false
          submitBtn.textContent = 'Start free trial'
        }
      })
    })
  })

  function buildMailto(lodgeName, contactName, email, phone, interest, notesValue) {
    const body = [
      'Hello Tsa Bonno HospitalityOS,',
      '',
      'I would like to request a free 1-month trial of Tsa Bonno HospitalityOS.',
      '',
      'Lodge name: ' + lodgeName,
      'Contact name: ' + contactName,
      'Email: ' + email,
      'Phone or WhatsApp: ' + phone,
      'Package interest: ' + interest,
      '',
      'Notes:',
      (notesValue || 'No extra notes provided.')
    ].join('\n')
    const subject = encodeURIComponent('Tsa Bonno HospitalityOS free 1-month trial request from ' + String(lodgeName || contactName || 'website visitor'))
    return 'mailto:hello@borokobookings.com?subject=' + subject + '&body=' + encodeURIComponent(body)
  }

  const langToggle = document.querySelector('.lang-toggle')
  if (langToggle) {
    let currentLang = 'en'
    const tnStrings = {
      'hero-title': 'Sistimi e le nngwe go tsamaisa dipeelo, diphapoši, go ntsha makoloto, badiri, thepa, le dipeeletso tsa inthanete.',
      'hero-desc': 'Tsa Bonno HospitalityOS e thusa malodžana a mannye le a golang go nna le sistimi e e bonalang le e e bontleglang. Dira tsa ga reception di tsamaisa ka bonako, beng ba nna le taolo, mme lotšha la gago le ka amogela dipeeletso tsa inthanete ka tsebe ya gago ya boroko.',
      'hero-cta': 'Phutholla trial ya mahala',
      'hero-cta-2': 'Lebelela dipakete',
      'hero-cta-3': 'Bua ka WhatsApp',
      'hero-highlight-1': 'Tsa tša dipeelo, room board, makoloto, le thekgo ya baeng mo lefelong le le lengwe',
      'hero-highlight-2': 'Thekišo ya bara kapa kichi, thepa, dipeelo tsa diphapoši, le dipeeletso fa kgwebo e gola',
      'hero-highlight-3': 'Tsebe ya gago ya dipeeletso tsa inthanete bakeng sa malodžana a Pro',
      'free-demo': 'Trial ya mahala ya kgwedi e le 1',
      'see-packages': 'Lebelela dipakete',
      'chat-wa': 'Bua ka WhatsApp',
      'email-us': 'Re romele imeile',
      'start-conversation': 'Simolola puisano',
      'ready-text': 'A o itekanetše go bona fa Tsa Bonno HospitalityOS e tshwanela lotšha la gago?',
      'demo-desc': 'Tšhomo foromo ya kopo mme re tla baakanyetsa puisano ya pakete e e tshwanelang lotšha la gago.',
      'lodge-name': 'Leina la lotsha',
      'your-name': 'Leina la gago',
      'phone-wa': 'Mogala kapa WhatsApp',
      'interest-label': 'O kgatlhiwa ke eng thata?',
      'notes-label': 'Dintlha',
      'notes-placeholder': 'Re bolelle ka lotšha la gago, palo ya diphapoši, kapa se o batlang go se tokafatsa.',
      'request-demo': 'Simolola trial ya mahala ya kgwedi e le 1',
      'demo-note': 'Foromo e e bula app ya gago ya imeile ka dintlha tse di tladitsweng go o romela kopo ya gango.',
      'thank-you': 'Re a leboha ka kopo ya gago',
      'thank-you-desc': 'Re amogetse kopo ya gago mme re tla go ikgolaganya mo diureng tse di 24. Gape o ka re letsa ka WhatsApp.',
      'faq-title': 'Dipotso tse di tlwaelegileng',
      'privacy-link': 'Pholisi ya sephiri',
      'terms-link': 'Melawana ya tirelo',
      'built-by': 'E agilwe ke Batswana bakeng sa Batswana',
      'home-nav': 'Gae',
      'features-nav': 'Ditshwegetso',
      'packages-nav': 'Dipakeke',
      'why-nav': 'Goreng o fetole',
      'contact-nav': 'Ikgolaganye',
      'brochure-nav': 'Broušara',
      'blog-nav': 'Dikgatiso',
      'starter-name': 'Starter',
      'standard-name': 'Standard',
      'pro-name': 'Pro',
      'not-sure': 'Ga ke itse sentle',
      'choose-starter-if': 'Tlhopa Starter fa',
      'choose-standard-if': 'Tlhopa Standard fa',
      'choose-pro-if': 'Tlhopa Pro fa',
      'most-popular': 'E e tlwaelegileng thata',
      'per-year': '/ngwaga',
      'occupancy': 'Batho ba nang teng',
      'pending-actions': 'Ditiragalo tse di letetseng',
      'check-ins': 'Batho ba ba tsenang'
    }

    langToggle.addEventListener('click', function () {
      if (currentLang === 'en') {
        currentLang = 'tn'
        langToggle.textContent = 'EN'
        document.documentElement.lang = 'tn'
        document.querySelectorAll('[data-tn]').forEach(function (el) {
          const key = el.getAttribute('data-tn')
          if (tnStrings[key]) {
            if (!el.getAttribute('data-en')) {
              el.setAttribute('data-en', el.textContent)
            }
            el.textContent = tnStrings[key]
          }
        })
        document.querySelectorAll('[data-tn-placeholder]').forEach(function (el) {
          const key = el.getAttribute('data-tn-placeholder')
          if (tnStrings[key]) {
            if (!el.getAttribute('data-en-placeholder')) {
              el.setAttribute('data-en-placeholder', el.placeholder)
            }
            el.placeholder = tnStrings[key]
          }
        })
      } else {
        currentLang = 'en'
        langToggle.textContent = 'TN'
        document.documentElement.lang = 'en'
        document.querySelectorAll('[data-tn]').forEach(function (el) {
          const en = el.getAttribute('data-en')
          if (en) {
            el.textContent = en
          }
        })
        document.querySelectorAll('[data-tn-placeholder]').forEach(function (el) {
          const en = el.getAttribute('data-en-placeholder')
          if (en) {
            el.placeholder = en
          }
        })
      }
    })
  }

  const cookieBanner = document.querySelector('.cookie-banner')
  const cookieAccept = document.querySelector('.cookie-accept')
  const cookieDecline = document.querySelector('.cookie-decline')
  if (cookieBanner && cookieAccept) {
    if (!localStorage.getItem('boroko-cookie-consent')) {
      cookieBanner.classList.add('is-visible')
      document.body.classList.add('has-cookie-banner')
    }
    cookieAccept.addEventListener('click', function () {
      localStorage.setItem('boroko-cookie-consent', 'true')
      cookieBanner.classList.remove('is-visible')
      document.body.classList.remove('has-cookie-banner')
      if (typeof gtag === 'function') {
        gtag('consent', 'update', { analytics_storage: 'granted' })
      }
    })
    if (cookieDecline) {
      cookieDecline.addEventListener('click', function () {
        localStorage.setItem('boroko-cookie-consent', 'denied')
        cookieBanner.classList.remove('is-visible')
        document.body.classList.remove('has-cookie-banner')
      })
    }
  }

  if (typeof gtag === 'function' && localStorage.getItem('boroko-cookie-consent') === 'true') {
    gtag('consent', 'update', { analytics_storage: 'granted' })
  }

  function trackEvent(action, label) {
    const payload = { action: action, label: label || '', url: location.pathname, ts: new Date().toISOString() }
    fetch(SUPABASE_URL + '/rest/v1/analytics_events', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: SUPABASE_ANON_KEY,
        Authorization: 'Bearer ' + SUPABASE_ANON_KEY
      },
      body: JSON.stringify(payload)
    }).catch(function () {})
  }

  function initWhatsAppWidget() {
    const el = document.createElement('div')
    el.innerHTML =
      '<div class="wa-tooltip" id="wa-tooltip"><strong>Need help?</strong>Chat with us on WhatsApp</div>' +
      '<a class="wa-float" href="' + WHATSAPP_LINK + '?text=Hello%20Tsa%20Bonno%20HospitalityOS%2C%20I%20have%20a%20question." target="_blank" rel="noreferrer" aria-label="Chat on WhatsApp">&#128172;</a>'
    document.body.appendChild(el)

    const tooltip = document.getElementById('wa-tooltip')
    setTimeout(function () { tooltip.classList.add('is-visible') }, 9000)
    setTimeout(function () { tooltip.classList.remove('is-visible') }, 13000)
  }

  initWhatsAppWidget()

  function initDownloadModal() {
    const modal = document.createElement('div')
    modal.className = 'download-modal'
    modal.innerHTML =
      '<div class="download-modal-overlay"></div>' +
      '<div class="download-modal-box">' +
        '<button class="download-modal-close" type="button" aria-label="Close">&times;</button>' +
        '<div class="download-modal-body" id="download-modal-body">' +
          '<h3 style="margin:0 0 4px;">Start your free trial</h3>' +
          '<p style="color:var(--ink-soft);margin:0 0 20px;font-size:0.92rem;">Fill in your details and the download will start automatically.</p>' +
          '<p class="download-security-preview"><strong>Windows note:</strong> Our first releases are not yet digitally signed, so Windows may ask you to confirm the installer. The next page shows the safe steps.</p>' +
          '<form id="download-form">' +
            '<label>' + BUSINESS_FIELD_LABEL + ' <input type="text" name="lodgeName" placeholder="' + BUSINESS_FIELD_PLACEHOLDER + '" required /></label>' +
            '<label>Your name <input type="text" name="contactName" placeholder="Your full name" required /></label>' +
            '<label>Email <input type="email" name="email" placeholder="name@example.com" required /></label>' +
            '<label>Phone or WhatsApp <input type="text" name="phone" placeholder="+267..." /></label>' +
            '<div class="demo-actions" style="margin-top:4px;">' +
              '<button class="btn btn-primary" type="submit" style="width:100%;">Download free trial</button>' +
            '</div>' +
            '<p style="font-size:0.82rem;color:var(--ink-soft);margin:10px 0 0;text-align:center;">No credit card required. Free 1-month trial.</p>' +
          '</form>' +
        '</div>' +
      '</div>'
    document.body.appendChild(modal)

    const overlay = modal.querySelector('.download-modal-overlay')
    const closeBtn = modal.querySelector('.download-modal-close')
    let form = modal.querySelector('#download-form')
    const bodyEl = modal.querySelector('#download-modal-body')

    function showModal() {
      modal.classList.add('is-open')
      trackEvent('modal_open', 'download')
    }

    function hideModal() {
      modal.classList.remove('is-open')
      bodyEl.innerHTML =
        '<h3 style="margin:0 0 4px;">Start your free trial</h3>' +
        '<p style="color:var(--ink-soft);margin:0 0 20px;font-size:0.92rem;">Fill in your details and the download will start automatically.</p>' +
        '<p class="download-security-preview"><strong>Windows note:</strong> Our first releases are not yet digitally signed, so Windows may ask you to confirm the installer. The next page shows the safe steps.</p>' +
        '<form id="download-form">' +
          '<label>' + BUSINESS_FIELD_LABEL + ' <input type="text" name="lodgeName" placeholder="' + BUSINESS_FIELD_PLACEHOLDER + '" required /></label>' +
          '<label>Your name <input type="text" name="contactName" placeholder="Your full name" required /></label>' +
          '<label>Email <input type="email" name="email" placeholder="name@example.com" required /></label>' +
          '<label>Phone or WhatsApp <input type="text" name="phone" placeholder="+267..." /></label>' +
          '<div class="demo-actions" style="margin-top:4px;">' +
            '<button class="btn btn-primary" type="submit" style="width:100%;">Download free trial</button>' +
          '</div>' +
          '<p style="font-size:0.82rem;color:var(--ink-soft);margin:10px 0 0;text-align:center;">No credit card required. Free 1-month trial.</p>' +
        '</form>'
      form = modal.querySelector('#download-form')
      attachFormHandler()
    }

    function attachFormHandler() {
      form.addEventListener('submit', async function (e) {
        e.preventDefault()
        await releasePromise
        const data = new FormData(form)
        const lodgeName = (data.get('lodgeName') || '').trim()
        const contactName = (data.get('contactName') || '').trim()
        const email = (data.get('email') || '').trim()
        const phone = (data.get('phone') || '').trim()

        const btn = form.querySelector('button[type="submit"]')
        btn.disabled = true
        btn.textContent = 'Preparing download...'

        const payload = {
          lodge_name: lodgeName || 'Not provided',
          contact_name: contactName,
          email: email,
          phone: phone || null,
          interest: ACTIVE_PRODUCT.label + ' trial',
          notes: 'Self-service trial registration for ' + ACTIVE_PRODUCT.label,
          source: 'website-download-' + ACTIVE_PRODUCT_ID
        }

        trackEvent('lead_created', 'download')
        fetch(SUPABASE_URL + '/functions/v1/send-welcome-email', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ contactName: contactName, lodgeName: lodgeName, email: email })
        }).catch(function () {})
        fetch(SUPABASE_URL + '/rest/v1/marketing_leads', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            apikey: SUPABASE_ANON_KEY,
            Authorization: 'Bearer ' + SUPABASE_ANON_KEY
          },
          body: JSON.stringify(payload)
        }).then(function () {
          trackEvent('download_started', 'download')
          const a = document.createElement('a')
          a.href = DOWNLOAD_URL
          a.target = '_blank'
          a.rel = 'noreferrer'
          a.click()
          setTimeout(function () {
            window.location.href = './thank-you.html?email=' + encodeURIComponent(email) + '&product=' + encodeURIComponent(ACTIVE_PRODUCT_ID)
          }, 500)
        }).catch(function () {
          btn.disabled = false
          btn.textContent = 'Download free trial'
          alert('Something went wrong. Please try again or contact us on WhatsApp.')
        })
      })
    }

    attachFormHandler()
    overlay.addEventListener('click', hideModal)
    closeBtn.addEventListener('click', hideModal)

    document.querySelectorAll('[data-action="download"]').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.preventDefault()
        var productOverride = btn.getAttribute('data-product')
        if (productOverride && PRODUCT_RELEASES[productOverride] && productOverride !== ACTIVE_PRODUCT_ID) {
          // Product-specific CTA: open the matching feed page or contact if no installer yet.
          if (productOverride === 'hospitality-pos') {
            window.location.href = './restaurant-pos.html'
            return
          }
          if (productOverride === 'hotel') {
            window.location.href = './hotel.html'
            return
          }
        }
        showModal()
      })
    })
  }

  initDownloadModal()

  const testimonialTrack = document.querySelector('.testimonial-track')
  if (testimonialTrack) {
    const dots = document.querySelectorAll('.testimonial-dot')
    const cards = testimonialTrack.querySelectorAll('.testimonial-card')
    if (dots.length && cards.length) {
      dots.forEach(function (dot) {
        dot.addEventListener('click', function () {
          const idx = parseInt(dot.getAttribute('data-index'), 10)
          testimonialTrack.style.transform = 'translateX(-' + (idx * 100) + '%)'
          dots.forEach(function (d) { d.classList.remove('is-active') })
          dot.classList.add('is-active')
          testimonialTrack.setAttribute('aria-live', 'polite')
        })
      })
      const testimonialSection = document.querySelector('.testimonial-section')
      setInterval(function () {
        if (testimonialSection && testimonialSection.matches(':hover')) return
        const active = document.querySelector('.testimonial-dot.is-active')
        let nextIdx = 0
        if (active) {
          const cur = parseInt(active.getAttribute('data-index'), 10)
          nextIdx = (cur + 1) % dots.length
        }
        testimonialTrack.style.transform = 'translateX(-' + (nextIdx * 100) + '%)'
        dots.forEach(function (d) { d.classList.remove('is-active') })
        dots[nextIdx].classList.add('is-active')
      }, 5000)
    }
  }

  const showImgs = document.querySelectorAll('.showcase-image-frame img')
  if (showImgs.length) {
    const lb = document.createElement('div')
    lb.className = 'lightbox'
    lb.innerHTML = '<button class="lightbox-close" type="button" aria-label="Close lightbox">&times;</button><img alt="" /><div class="lightbox-caption"></div>'
    document.body.appendChild(lb)
    const lbImg = lb.querySelector('img')
    const lbCap = lb.querySelector('.lightbox-caption')
    function closeLightbox() { lb.classList.remove('is-open') }
    lb.addEventListener('click', closeLightbox)
    lb.querySelector('.lightbox-close').addEventListener('click', closeLightbox)
    document.addEventListener('keydown', function(e) { if (e.key === 'Escape') closeLightbox() })
    showImgs.forEach(function (img) {
      img.addEventListener('click', function (e) {
        e.stopPropagation()
        const card = img.closest('.showcase-card')
        const caption = card ? card.querySelector('h3') : null
        lbImg.src = img.src
        lbImg.alt = img.alt
        lbCap.textContent = caption ? caption.textContent : ''
        lb.classList.add('is-open')
      })
    })
  }

  const statCards = document.querySelectorAll('.stat-card strong')
  if (statCards.length && 'IntersectionObserver' in window) {
    const statObserver = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          const el = entry.target
          const text = el.textContent.trim()
          const match = text.match(/^(\d+)(.*)/)
          if (match) {
            const num = parseInt(match[1], 10)
            const suffix = match[2]
            if (!isNaN(num) && num > 0 && num < 9999) {
              const duration = 1400
              let startTime = null
              function step(ts) {
                if (!startTime) startTime = ts
                const progress = Math.min((ts - startTime) / duration, 1)
                const eased = 1 - Math.pow(1 - progress, 3)
                el.textContent = Math.round(eased * num) + suffix
                if (progress < 1) requestAnimationFrame(step)
              }
              requestAnimationFrame(step)
            }
          }
          statObserver.unobserve(el)
        }
      })
    }, { threshold: 0.5 })
    statCards.forEach(function (el) { statObserver.observe(el) })
  }

  const heroBackdrop = document.querySelector('.hero-backdrop')
  const heroBackdrop2 = document.querySelector('.hero-backdrop-2')
  if (heroBackdrop || heroBackdrop2) {
    let rafId = null
    window.addEventListener('scroll', function () {
      if (rafId) return
      rafId = requestAnimationFrame(function () {
        const scrollY = window.scrollY
        if (scrollY < 800) {
          if (heroBackdrop) heroBackdrop.style.transform = 'translateY(' + (scrollY * 0.15) + 'px)'
          if (heroBackdrop2) heroBackdrop2.style.transform = 'translateY(' + (scrollY * 0.1) + 'px)'
        }
        rafId = null
      })
    }, { passive: true })
  }

  // ===== MAGNETIC BUTTONS =====
  if (window.matchMedia('(pointer: fine)').matches) {
    var magneticEls = document.querySelectorAll('.hero-actions .btn, .cta-actions .btn, .nav-cta-pill')
    magneticEls.forEach(function (btn) {
      btn.classList.add('is-magnetic')
      btn.addEventListener('mousemove', function (e) {
        var rect = btn.getBoundingClientRect()
        var x = e.clientX - rect.left - rect.width / 2
        var y = e.clientY - rect.top - rect.height / 2
        btn.style.transform = 'translate(' + (x * 0.2) + 'px, ' + (y * 0.2) + 'px)'
      })
      btn.addEventListener('mouseleave', function () {
        btn.style.transform = ''
      })
    })
  }

  // ===== FLOATING PARTICLES =====
  var particleContainer = document.getElementById('hero-particles')
  if (particleContainer && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    for (var p = 0; p < 18; p++) {
      var particle = document.createElement('div')
      particle.className = 'hero-particle'
      var size = 3 + Math.random() * 4
      var isGold = Math.random() > 0.5
      particle.style.width = size + 'px'
      particle.style.height = size + 'px'
      particle.style.background = isGold ? 'rgba(203,126,48,0.2)' : 'rgba(23,76,58,0.15)'
      particle.style.left = (Math.random() * 100) + '%'
      particle.style.bottom = '-10px'
      particle.style.animationDuration = (6 + Math.random() * 8) + 's'
      particle.style.animationDelay = (Math.random() * 5) + 's'
      particleContainer.appendChild(particle)
    }
  }

  // ===== HERO COPY PARALLAX =====
  var heroCopy = document.querySelector('.hero-copy')
  if (heroCopy && window.matchMedia('(min-width: 641px)').matches) {
    var heroRafId = null
    window.addEventListener('scroll', function () {
      if (heroRafId) return
      heroRafId = requestAnimationFrame(function () {
        var scrollY = window.scrollY
        if (scrollY < 600) {
          heroCopy.style.transform = 'translateY(' + (scrollY * 0.08) + 'px)'
        }
        heroRafId = null
      })
    }, { passive: true })
  }

  // ===== HERO PARALLAX ON POINTER MOVE =====
  var heroSurface = document.getElementById('hero-surface')
  if (heroSurface && window.matchMedia('(pointer: fine)').matches && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    var laptopMockup = document.getElementById('laptop-mockup')
    var floatTags = heroSurface.querySelectorAll('.hero-float-tag')
    heroSurface.addEventListener('mousemove', function (e) {
      var rect = heroSurface.getBoundingClientRect()
      var x = (e.clientX - rect.left) / rect.width - 0.5
      var y = (e.clientY - rect.top) / rect.height - 0.5
      if (laptopMockup) {
        laptopMockup.style.transform = 'perspective(800px) rotateY(' + (x * 4) + 'deg) rotateX(' + (-y * 3) + 'deg)'
      }
      floatTags.forEach(function (tag, i) {
        var depth = 0.5 + (i * 0.15)
        tag.style.transform = 'translate(' + (x * 8 * depth) + 'px, ' + (y * 6 * depth) + 'px)'
      })
    })
    heroSurface.addEventListener('mouseleave', function () {
      if (laptopMockup) laptopMockup.style.transform = ''
      floatTags.forEach(function (tag) { tag.style.transform = '' })
    })
  }

  // ===== SCROLL PROGRESS ENTRANCE =====
  var scrollProgress = document.getElementById('scroll-progress')
  if (scrollProgress) {
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        scrollProgress.classList.add('is-ready')
      })
    })
    var progressTicking = false
    window.addEventListener('scroll', function () {
      if (!progressTicking) {
        requestAnimationFrame(function () {
          var scrollTop = window.scrollY
          var docHeight = document.documentElement.scrollHeight - window.innerHeight
          var scrollPercent = docHeight > 0 ? (scrollTop / docHeight) * 100 : 0
          scrollProgress.style.width = scrollPercent + '%'
          progressTicking = false
        })
        progressTicking = true
      }
    }, { passive: true })
  }

  // Keep the marketing site focused on trust and product clarity. Decorative effects that compete with buying intent stay out of the first impression.

  // ===== 13. RIPPLE CLICK EFFECT =====
  document.querySelectorAll('.btn').forEach(function (btn) {
    btn.addEventListener('click', function (e) {
      var ripple = document.createElement('span')
      ripple.className = 'ripple'
      var rect = btn.getBoundingClientRect()
      var size = Math.max(rect.width, rect.height)
      ripple.style.width = ripple.style.height = size + 'px'
      ripple.style.left = (e.clientX - rect.left - size / 2) + 'px'
      ripple.style.top = (e.clientY - rect.top - size / 2) + 'px'
      btn.appendChild(ripple)
      setTimeout(function () { ripple.remove() }, 600)
    })
  })

  // ===== 14. COUNTER RINGS =====
  var ringFills = document.querySelectorAll('.stat-ring-fill')
  if (ringFills.length && 'IntersectionObserver' in window) {
    var ringObserver = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          var ring = entry.target
          var pct = parseInt(ring.getAttribute('data-percent'), 10) || 0
          var circumference = 2 * Math.PI * 45
          var offset = circumference - (pct / 100) * circumference
          ring.style.strokeDasharray = circumference
          ring.style.strokeDashoffset = circumference
          requestAnimationFrame(function () {
            ring.classList.add('is-animated')
            ring.style.strokeDashoffset = offset
          })
          ringObserver.unobserve(ring)
        }
      })
    }, { threshold: 0.5 })
    ringFills.forEach(function (el) { ringObserver.observe(el) })
  }

  // ===== 5. TIMELINE SCROLL REVEAL =====
  var timelineNodes = document.querySelectorAll('.timeline-node')
  if (timelineNodes.length && 'IntersectionObserver' in window) {
    var tlObserver = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible')
          tlObserver.unobserve(entry.target)
        }
      })
    }, { threshold: 0.2 })
    timelineNodes.forEach(function (el) { tlObserver.observe(el) })
  }

  // ===== 12. SECTION COLOR MORPHING =====
  var morphBg = document.createElement('div')
  morphBg.className = 'section-morph-bg'
  document.body.prepend(morphBg)
  var sectionColors = [
    { bg: 'rgba(244, 239, 231, 0)' },
    { bg: 'rgba(244, 239, 231, 0)' },
    { bg: 'rgba(248, 243, 235, 0)' },
    { bg: 'rgba(243, 236, 226, 0)' },
    { bg: 'rgba(248, 243, 235, 0)' },
    { bg: 'rgba(240, 235, 225, 0)' },
    { bg: 'rgba(248, 243, 235, 0)' },
    { bg: 'rgba(243, 236, 226, 0)' }
  ]
  var sections = document.querySelectorAll('.section, .band-section, .timeline-section')
  if (sections.length && 'IntersectionObserver' in window) {
    var colorObserver = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          var idx = Array.from(sections).indexOf(entry.target)
          if (idx >= 0 && idx < sectionColors.length) {
            morphBg.style.background = sectionColors[idx].bg
          }
        }
      })
    }, { threshold: 0.3 })
    sections.forEach(function (s) { colorObserver.observe(s) })
  }

  // ===== 10. STAGGERED PAGE LOAD =====
  var staggerContainers = document.querySelectorAll('.topbar-pill, .hero-actions, .hero-highlights, .social-proof-inner')
  if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    staggerContainers.forEach(function (el) { el.classList.add('page-load-stagger') })
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        staggerContainers.forEach(function (el) { el.classList.add('is-loaded') })
      })
    })
  }

  // ===== 11. CURSOR GLOW (dark sections) =====
  var cursorGlow = document.createElement('div')
  cursorGlow.className = 'cursor-glow'
  cursorGlow.setAttribute('aria-hidden', 'true')
  document.body.appendChild(cursorGlow)

  var darkSections = document.querySelectorAll('.pricing-section, .site-footer')
  darkSections.forEach(function (section) {
    section.addEventListener('mouseenter', function () { cursorGlow.classList.add('is-active') })
    section.addEventListener('mouseleave', function () { cursorGlow.classList.remove('is-active') })
  })
  document.addEventListener('mousemove', function (e) {
    cursorGlow.style.left = e.clientX + 'px'
    cursorGlow.style.top = e.clientY + 'px'
  }, { passive: true })

  // ===== 12. COMPARISON TABLE ROW ANIMATION =====
  var compRows = document.querySelectorAll('.comparison-row:not(.comparison-head)')
  if (compRows.length) {
    var compObserver = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible')
          compObserver.unobserve(entry.target)
        }
      })
    }, { threshold: 0.15 })
    compRows.forEach(function (row) { compObserver.observe(row) })
  }

  // ===== 13. IMAGE CLIP-PATH REVEAL =====
  var imgFrames = document.querySelectorAll('.showcase-image-frame')
  if (imgFrames.length) {
    var imgObserver = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          var img = entry.target.querySelector('img')
          if (img) img.classList.add('is-revealed')
          imgObserver.unobserve(entry.target)
        }
      })
    }, { threshold: 0.3 })
    imgFrames.forEach(function (frame) { imgObserver.observe(frame) })
  }

  // ===== 14. GRADIENT MESH SPEED CONTROL ON SCROLL =====
  var meshBlobs = document.querySelectorAll('.mesh-blob, .blob')
  var heroEl = document.getElementById('hero')
  if (meshBlobs.length && heroEl) {
    var baseDurations = []
    meshBlobs.forEach(function (blob) {
      var cs = getComputedStyle(blob)
      baseDurations.push(parseFloat(cs.animationDuration) || 20)
    })
    var meshTicking = false
    window.addEventListener('scroll', function () {
      if (meshTicking) return
      meshTicking = true
      requestAnimationFrame(function () {
        var rect = heroEl.getBoundingClientRect()
        var progress = Math.max(0, Math.min(1, -rect.top / rect.height))
        var speedMult = 1 + progress * 3
        meshBlobs.forEach(function (blob, i) {
          blob.style.animationDuration = (baseDurations[i] / speedMult) + 's'
        })
        meshTicking = false
      })
    }, { passive: true })
  }

  // ===== 15. NOISE TEXTURE SCROLL-LINKED =====
  var noiseTicking = false
  window.addEventListener('scroll', function () {
    if (noiseTicking) return
    noiseTicking = true
    requestAnimationFrame(function () {
      var scrollPct = window.scrollY / (document.body.scrollHeight - window.innerHeight)
      var opacity = 0.025 + scrollPct * 0.06
      document.documentElement.style.setProperty('--noise-opacity', opacity.toFixed(4))
      noiseTicking = false
    })
  }, { passive: true })
  document.documentElement.style.setProperty('--noise-opacity', '0.025')

  // Hotel package planning calculator. Final quotations remain server-authoritative.
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
      setupOutput.textContent = 'P' + money.format(setup)
      annualOutput.textContent = 'P' + money.format(annual)
    }
    addonInputs.forEach(function (input) { input.addEventListener('change', updateAddonEstimate) })
    updateAddonEstimate()
  }

  // ===== FEATURES TABS SCROLL SPY =====
  var featuresTabs = document.querySelectorAll('.features-tab')
  if (featuresTabs.length) {
    var featureSections = []
    featuresTabs.forEach(function (tab) {
      var id = tab.getAttribute('href').replace('#', '')
      var section = document.getElementById(id)
      if (section) featureSections.push({ el: section, tab: tab })
    })
    var featuresNav = document.getElementById('features-nav')
    if (featuresNav) {
      window.addEventListener('scroll', function () {
        var scrollY = window.scrollY + 160
        var current = featureSections[0]
        for (var i = 0; i < featureSections.length; i++) {
          if (featureSections[i].el.offsetTop <= scrollY) {
            current = featureSections[i]
          }
        }
        featuresTabs.forEach(function (t) { t.classList.remove('is-active') })
        if (current) current.tab.classList.add('is-active')
      }, { passive: true })
    }
  }
})()
