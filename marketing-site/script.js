const nav = document.querySelector('#site-nav')
const toggle = document.querySelector('.menu-toggle')
const form = document.querySelector('#demo-form')
const note = document.querySelector('#demo-note')
const currentPage = document.body.dataset.page || 'home'

document.querySelectorAll('[data-nav]').forEach((link) => {
  if (link.dataset.nav === currentPage) {
    link.classList.add('is-active')
  }
})

if (toggle && nav) {
  toggle.addEventListener('click', () => {
    const open = nav.classList.toggle('is-open')
    toggle.setAttribute('aria-expanded', String(open))
  })

  nav.querySelectorAll('a').forEach((link) => {
    link.addEventListener('click', () => {
      nav.classList.remove('is-open')
      toggle.setAttribute('aria-expanded', 'false')
    })
  })
}

const revealTargets = document.querySelectorAll('.feature-card, .step-card, .pricing-card, .why-list article, .comparison-card, .demo-form, .faq-grid details')

if ('IntersectionObserver' in window) {
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible')
          observer.unobserve(entry.target)
        }
      })
    },
    { threshold: 0.16 }
  )

  revealTargets.forEach((element) => {
    element.classList.add('reveal')
    observer.observe(element)
  })
}

if (form) {
  form.addEventListener('submit', (event) => {
    event.preventDefault()

    const data = new FormData(form)
    const lodgeName = data.get('lodgeName') || ''
    const contactName = data.get('contactName') || ''
    const email = data.get('email') || ''
    const phone = data.get('phone') || ''
    const interest = data.get('interest') || ''
    const notesValue = data.get('notes') || ''

    const body = [
      'Hello Boroko Bookings,',
      '',
      'I would like to request a free 7-day demo of Boroko Bookings.',
      '',
      `Lodge name: ${lodgeName}`,
      `Contact name: ${contactName}`,
      `Email: ${email}`,
      `Phone or WhatsApp: ${phone}`,
      `Package interest: ${interest}`,
      '',
      'Notes:',
      `${notesValue || 'No extra notes provided.'}`
    ].join('\n')

    const subject = encodeURIComponent(`Boroko Bookings free 7-day demo request from ${String(lodgeName || contactName || 'website visitor')}`)
    const mailto = `mailto:hello@borokobookings.com?subject=${subject}&body=${encodeURIComponent(body)}`

    window.location.href = mailto

    if (note) {
      note.textContent = 'Your email app should open with your free 7-day demo request filled in. If it does not, use the direct email button instead.'
    }
  })
}
