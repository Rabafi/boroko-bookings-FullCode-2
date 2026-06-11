;(function () {
  const SUPABASE_URL = 'https://oicgpknsmtvcsjacymum.supabase.co'
  const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9pY2dwa25zbXR2Y3NqYWN5bXVtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM2OTM1MTEsImV4cCI6MjA4OTI2OTUxMX0.WbC5C1QaVeNaTbTG0_xdcsUlK3BoA8onWC607B_uGlY'
  const APP_VERSION = 'v1.3.15'
  const DOWNLOAD_URL = 'https://github.com/Rabafi/boroko-bookings-releases/releases/download/' + APP_VERSION + '/Boroko-Bookings-1.3.15-x64.exe'
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

  // Laptop 3D tilt, screen glare, and parallax
  var heroSurface = document.getElementById('hero-surface')
  var laptopMockup = document.getElementById('laptop-mockup')
  if (heroSurface && laptopMockup && window.matchMedia('(min-width: 641px)').matches) {
    var laptopImg = laptopMockup.querySelector('.laptop-screen img')
    var laptopGlare = laptopMockup.querySelector('.laptop-screen-glare')
    laptopMockup.classList.add('js-tilt')

    heroSurface.addEventListener('mousemove', function (e) {
      var rect = heroSurface.getBoundingClientRect()
      var x = (e.clientX - rect.left) / rect.width
      var y = (e.clientY - rect.top) / rect.height

      // 3D tilt: map 0-1 to -6deg to 6deg
      var rotateY = (x - 0.5) * 12
      var rotateX = -(y - 0.5) * 8
      laptopMockup.style.transform = 'rotateX(' + rotateX + 'deg) rotateY(' + rotateY + 'deg)'

      // Glare position
      if (laptopGlare) {
        laptopGlare.style.setProperty('--glare-x', (x * 100) + '%')
        laptopGlare.style.setProperty('--glare-y', (y * 100) + '%')
      }

      // Screen parallax: shift image opposite to mouse
      if (laptopImg) {
        var shiftX = (x - 0.5) * -12
        var shiftY = (y - 0.5) * -8
        laptopImg.style.transform = 'translate(' + shiftX + 'px, ' + shiftY + 'px) scale(1.02)'
      }
    })

    heroSurface.addEventListener('mouseleave', function () {
      laptopMockup.style.transform = ''
      if (laptopImg) {
        laptopImg.style.transform = ''
      }
    })
  }

  const revealTargets = document.querySelectorAll('.feature-card, .step-card, .pricing-card, .why-list article, .comparison-card, .demo-form, .faq-grid details, .section:not(.hero-section), .band-section, .story-card, .resource-card, .audience-card, .showcase-card, .stat-card, .content-card')
  if ('IntersectionObserver' in window) {
    const observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible')
          observer.unobserve(entry.target)
        }
      })
    }, { threshold: 0.12 })
    revealTargets.forEach(function (el) {
      el.classList.add('reveal')
      observer.observe(el)
    })
  }

  const forms = document.querySelectorAll('.demo-form')
  forms.forEach(function (form) {
    form.addEventListener('submit', function (event) {
      event.preventDefault()
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
        formEl.innerHTML = '<div class="demo-success"><div class="demo-success-icon">&#10003;</div><h3 style="margin:16px 0 8px;">Your free trial is ready</h3><p style="color:var(--ink-soft);">Download the Boroko Bookings desktop app below and start your free 1-month trial. Install it, create your lodge, and start operating right away.</p><a class="btn btn-primary" href="https://github.com/Rabafi/boroko-bookings-releases/download/' + APP_VERSION + '/Boroko-Bookings-' + APP_VERSION + '-x64.exe" target="_blank" rel="noreferrer" style="margin-bottom:10px;">Download for Windows</a><p style="font-size:0.85rem;color:var(--ink-soft);margin-top:8px;">Version ' + APP_VERSION + ' — Windows 10+ (64-bit). Need help? <a href="https://wa.me/26772789415" target="_blank" rel="noreferrer" style="color:var(--brand);font-weight:700;">Chat on WhatsApp</a></p></div>'
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
          submitBtn.textContent = 'Start free 1-month trial'
        }
      })
    })
  })

  function buildMailto(lodgeName, contactName, email, phone, interest, notesValue) {
    const body = [
      'Hello Boroko Bookings,',
      '',
      'I would like to request a free 1-month trial of Boroko Bookings.',
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
    const subject = encodeURIComponent('Boroko Bookings free 1-month trial request from ' + String(lodgeName || contactName || 'website visitor'))
    return 'mailto:hello@borokobookings.com?subject=' + subject + '&body=' + encodeURIComponent(body)
  }

  const langToggle = document.querySelector('.lang-toggle')
  if (langToggle) {
    let currentLang = 'en'
    const tnStrings = {
      'hero-title': 'Sistimi e le nngwe go tsamaisa dipeelo, diphapoši, go ntsha makoloto, badiri, thepa, le dipeeletso tsa inthanete.',
      'hero-desc': 'Boroko Bookings e thusa malodžana a mannye le a golang go nna le sistimi e e bonalang le e e bontleglang. Dira tsa ga reception di tsamaisa ka bonako, beng ba nna le taolo, mme lotšha la gago le ka amogela dipeeletso tsa inthanete ka tsebe ya gago ya boroko.',
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
      'ready-text': 'A o itekanetše go bona fa Boroko Bookings e tshwanela lotšha la gago?',
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
    }
    cookieAccept.addEventListener('click', function () {
      localStorage.setItem('boroko-cookie-consent', 'true')
      cookieBanner.classList.remove('is-visible')
      if (typeof gtag === 'function') {
        gtag('consent', 'update', { analytics_storage: 'granted' })
      }
    })
    if (cookieDecline) {
      cookieDecline.addEventListener('click', function () {
        localStorage.setItem('boroko-cookie-consent', 'denied')
        cookieBanner.classList.remove('is-visible')
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
      '<a class="wa-float" href="' + WHATSAPP_LINK + '?text=Hello%20Boroko%20Bookings%2C%20I%20have%20a%20question." target="_blank" rel="noreferrer" aria-label="Chat on WhatsApp">&#128172;</a>'
    document.body.appendChild(el)

    const tooltip = document.getElementById('wa-tooltip')
    setTimeout(function () { tooltip.classList.add('is-visible') }, 3000)
    setTimeout(function () { tooltip.classList.remove('is-visible') }, 8000)
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
          '<form id="download-form">' +
            '<label>Lodge name <input type="text" name="lodgeName" placeholder="Your lodge name" required /></label>' +
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
        '<form id="download-form">' +
          '<label>Lodge name <input type="text" name="lodgeName" placeholder="Your lodge name" required /></label>' +
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
      form.addEventListener('submit', function (e) {
        e.preventDefault()
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
          interest: 'Trial download',
          notes: 'Self-service trial download from website',
          source: 'website-download'
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
            window.location.href = './thank-you.html?email=' + encodeURIComponent(email)
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

  const scrollProgress = document.getElementById('scroll-progress')
  if (scrollProgress) {
    let ticking = false
    window.addEventListener('scroll', function () {
      if (!ticking) {
        requestAnimationFrame(function () {
          const scrollTop = window.scrollY
          const docHeight = document.documentElement.scrollHeight - window.innerHeight
          const scrollPercent = docHeight > 0 ? (scrollTop / docHeight) * 100 : 0
          scrollProgress.style.width = scrollPercent + '%'
          ticking = false
        })
        ticking = true
      }
    }, { passive: true })
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

  const magneticBtns = document.querySelectorAll('.hero-actions .btn, .cta-actions .btn')
  magneticBtns.forEach(function (btn) {
    btn.addEventListener('mousemove', function (e) {
      const rect = btn.getBoundingClientRect()
      const x = e.clientX - rect.left - rect.width / 2
      const y = e.clientY - rect.top - rect.height / 2
      btn.style.transform = 'translate(' + (x * 0.15) + 'px, ' + (y * 0.15) + 'px)'
    })
    btn.addEventListener('mouseleave', function () {
      btn.style.transform = ''
    })
  })

  // ===== 1. HERO TYPING ANIMATION =====
  const typingEl = document.getElementById('hero-typing')
  if (typingEl) {
    const phrases = [
      'One system for your lodge.',
      'Bookings, rooms, billing.',
      'Your own online reservations.'
    ]
    let phraseIdx = 0
    let charIdx = 0
    let isDeleting = false
    let typeSpeed = 60

    function typeLoop() {
      const current = phrases[phraseIdx]
      if (!isDeleting) {
        typingEl.textContent = current.substring(0, charIdx + 1)
        charIdx++
        if (charIdx === current.length) {
          isDeleting = true
          typeSpeed = 2000
        } else {
          typeSpeed = 55 + Math.random() * 40
        }
      } else {
        typingEl.textContent = current.substring(0, charIdx - 1)
        charIdx--
        if (charIdx === 0) {
          isDeleting = false
          phraseIdx = (phraseIdx + 1) % phrases.length
          typeSpeed = 400
        } else {
          typeSpeed = 30
        }
      }
      setTimeout(typeLoop, typeSpeed)
    }
    setTimeout(typeLoop, 800)
  }

  // ===== 2. 3D CARD TILT =====
  const tiltCards = document.querySelectorAll('.feature-card, .story-card, .audience-card, .resource-card, .content-card')
  tiltCards.forEach(function (card) {
    card.addEventListener('mousemove', function (e) {
      const rect = card.getBoundingClientRect()
      const x = (e.clientX - rect.left) / rect.width
      const y = (e.clientY - rect.top) / rect.height
      const tiltX = (y - 0.5) * -8
      const tiltY = (x - 0.5) * 8
      card.style.transform = 'perspective(800px) rotateX(' + tiltX + 'deg) rotateY(' + tiltY + 'deg) translateY(-4px)'
    })
    card.addEventListener('mouseleave', function () {
      card.style.transform = ''
    })
  })

  // ===== 3. CURSOR TRAIL =====
  if (window.innerWidth > 860) {
    const trailContainer = document.createElement('div')
    trailContainer.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:9998;'
    document.body.appendChild(trailContainer)
    const trailDots = []
    const trailCount = 8
    for (var t = 0; t < trailCount; t++) {
      var dot = document.createElement('div')
      dot.className = 'cursor-trail-dot'
      dot.style.cssText = 'background:' + (t % 2 === 0 ? 'rgba(23,76,58,0.3)' : 'rgba(203,126,48,0.25)') + ';width:' + (8 - t * 0.8) + 'px;height:' + (8 - t * 0.8) + 'px;'
      trailContainer.appendChild(dot)
      trailDots.push({ el: dot, x: 0, y: 0 })
    }
    var mouseX = 0, mouseY = 0
    document.addEventListener('mousemove', function (e) {
      mouseX = e.clientX
      mouseY = e.clientY
      trailDots.forEach(function (d) { d.el.classList.add('active') })
    })
    function animateTrail() {
      var prevX = mouseX, prevY = mouseY
      trailDots.forEach(function (d, i) {
        var speed = 0.35 - (i * 0.03)
        d.x += (prevX - d.x) * speed
        d.y += (prevY - d.y) * speed
        d.el.style.transform = 'translate(' + (d.x - 4) + 'px,' + (d.y - 4) + 'px)'
        prevX = d.x
        prevY = d.y
      })
      requestAnimationFrame(animateTrail)
    }
    animateTrail()
  }

  // ===== 11. FLOATING PARTICLES =====
  var particleContainer = document.getElementById('hero-particles')
  if (particleContainer) {
    for (var p = 0; p < 20; p++) {
      var particle = document.createElement('div')
      var size = 3 + Math.random() * 4
      var isGold = Math.random() > 0.5
      particle.style.cssText = 'position:absolute;width:' + size + 'px;height:' + size + 'px;border-radius:50%;background:' + (isGold ? 'rgba(203,126,48,0.2)' : 'rgba(23,76,58,0.15)') + ';left:' + (Math.random() * 100) + '%;bottom:-10px;animation:particleFloat ' + (6 + Math.random() * 8) + 's linear ' + (Math.random() * 5) + 's infinite;'
      particleContainer.appendChild(particle)
    }
    var particleStyle = document.createElement('style')
    particleStyle.textContent = '@keyframes particleFloat { 0% { transform: translateY(0) translateX(0); opacity: 0; } 10% { opacity: 1; } 90% { opacity: 1; } 100% { transform: translateY(-100vh) translateX(' + (Math.random() > 0.5 ? '' : '-') + '40px); opacity: 0; } }'
    document.head.appendChild(particleStyle)
  }

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

  // ===== 7. CUSTOM CURSOR =====
  if (window.matchMedia('(pointer: fine)').matches && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    var cursor = document.createElement('div')
    cursor.className = 'custom-cursor'
    var cursorRing = document.createElement('div')
    cursorRing.className = 'custom-cursor-ring'
    document.body.appendChild(cursor)
    document.body.appendChild(cursorRing)

    var cursorX = 0, cursorY = 0
    var ringX = 0, ringY = 0

    document.addEventListener('mousemove', function (e) {
      cursorX = e.clientX
      cursorY = e.clientY
      cursor.style.left = cursorX + 'px'
      cursor.style.top = cursorY + 'px'
    })

    // Smooth ring follow
    function animateRing() {
      ringX += (cursorX - ringX) * 0.12
      ringY += (cursorY - ringY) * 0.12
      cursorRing.style.left = ringX + 'px'
      cursorRing.style.top = ringY + 'px'
      requestAnimationFrame(animateRing)
    }
    animateRing()

    // Cursor states on hover
    var ctaEls = document.querySelectorAll('.btn, .nav-cta-pill, .mobile-cta')
    var linkEls = document.querySelectorAll('a, button:not(.menu-toggle):not(.lang-toggle)')
    var hoverEls = document.querySelectorAll('.feature-card, .pricing-card, .story-card, .showcase-card, .faq-grid details, .content-card, .resource-card, .audience-card')

    ctaEls.forEach(function (el) {
      el.addEventListener('mouseenter', function () { cursor.classList.add('is-cta'); cursorRing.classList.add('is-cta') })
      el.addEventListener('mouseleave', function () { cursor.classList.remove('is-cta'); cursorRing.classList.remove('is-cta') })
    })
    hoverEls.forEach(function (el) {
      el.addEventListener('mouseenter', function () { cursor.classList.add('is-hover'); cursorRing.classList.add('is-hover') })
      el.addEventListener('mouseleave', function () { cursor.classList.remove('is-hover'); cursorRing.classList.remove('is-hover') })
    })
    linkEls.forEach(function (el) {
      if (!el.classList.contains('btn') && !el.classList.contains('nav-cta-pill')) {
        el.addEventListener('mouseenter', function () { cursor.classList.add('is-link'); cursorRing.classList.add('is-link') })
        el.addEventListener('mouseleave', function () { cursor.classList.remove('is-link'); cursorRing.classList.remove('is-link') })
      }
    })
  }

  // ===== 8. MAGNETIC BUTTONS =====
  if (window.matchMedia('(pointer: fine)').matches) {
    var magneticEls = document.querySelectorAll('.btn, .nav-cta-pill')
    magneticEls.forEach(function (btn) {
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

  // ===== 9. TEXT SCRAMBLE =====
  var scrambleChars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%&*'
  function scrambleText(el) {
    var original = el.dataset.scramble || el.textContent
    el.dataset.scramble = original
    var iteration = 0
    var maxIterations = original.length * 2
    var interval = setInterval(function () {
      el.textContent = original.split('').map(function (char, i) {
        if (i < iteration / 2) return original[i]
        if (char === ' ') return ' '
        return scrambleChars[Math.floor(Math.random() * scrambleChars.length)]
      }).join('')
      iteration++
      if (iteration > maxIterations) {
        el.textContent = original
        clearInterval(interval)
      }
    }, 30)
  }

  // Trigger scramble on feature card titles on scroll
  var scrambleTargets = document.querySelectorAll('.feature-card h3, .step-card h3, .why-list h3')
  if (scrambleTargets.length && 'IntersectionObserver' in window) {
    var scrambleObserver = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          scrambleText(entry.target)
          scrambleObserver.unobserve(entry.target)
        }
      })
    }, { threshold: 0.5 })
    scrambleTargets.forEach(function (el) { scrambleObserver.observe(el) })
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
})()
