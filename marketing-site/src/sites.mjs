/**
 * Site registry for the Tsa Bonno multisite marketing build.
 *
 * One codebase builds six sites (scripts/build-marketing-sites.mjs):
 *
 *   tsabonno.com              ecosystem hub (light landing, blog, contact,
 *                             brochure, enterprise, privacy, terms, admin)
 *   lodge.tsabonno.com        LodgingOS
 *   restaurant.tsabonno.com   Restaurant & Bar POS — restaurant storefront
 *   bar.tsabonno.com          Restaurant & Bar POS — bar storefront
 *   hotel.tsabonno.com        HotelOS (coming soon)
 *   property.tsabonno.com     PropertyOS (coming soon)
 *
 * Source pages stay at marketing-site/*.html. Every source page is assigned
 * to the site that owns it through SITE_PAGES; shared pages (thank-you, 404)
 * build into every site. Cross-site links are emitted as absolute subdomain
 * URLs, same-site links stay relative.
 */

export const SITES = {
  hub: {
    id: 'hub',
    origin: 'https://tsabonno.com',
    favicon: './assets/tsa-bonno-hospitalityos-logo.svg',
    defaultProduct: null,
    functions: true, // enterprise quote download (/api/quote-download)
    cta: { label: 'Start trial', action: 'download' },
    mobile: {
      ctaLabel: 'Start free trial',
      ctaAction: 'download',
      secondary: { label: 'See packages', page: 'packages' }
    },
    footerCopy:
      'Built to help lodges operate smoothly, make better decisions, and grow into stronger hospitality businesses.',
    nav: [
      { label: 'Lodge', page: 'lodge-app', nav: 'lodge-app' },
      { label: 'Restaurant POS', page: 'restaurant-pos', nav: 'restaurant-pos' },
      { label: 'Bar POS', page: 'bar-pos', nav: 'bar-pos' },
      { label: 'Hotel', page: 'hotel', nav: 'hotel' },
      { label: 'Property', page: 'property', nav: 'property' },
      { label: 'Packages', page: 'packages', nav: 'packages' },
      { label: 'Contact', page: 'contact', nav: 'contact' }
    ],
    mobileNav: [
      { label: 'Home', page: 'index', nav: 'home' },
      { label: 'Lodge &amp; Camp', page: 'lodge-app', nav: 'lodge-app' },
      { label: 'Restaurant POS', page: 'restaurant-pos', nav: 'restaurant-pos' },
      { label: 'Bar POS', page: 'bar-pos', nav: 'bar-pos' },
      { label: 'Hotel', page: 'hotel', nav: 'hotel' },
      { label: 'Property', page: 'property', nav: 'property' },
      { label: 'Packages', page: 'packages', nav: 'packages' },
      { label: 'Contact', page: 'contact', nav: 'contact' }
    ],
    footerLinks: [
      { label: 'Lodge &amp; Camp', page: 'lodge-app' },
      { label: 'Restaurant POS', page: 'restaurant-pos' },
      { label: 'Bar POS', page: 'bar-pos' },
      { label: 'Hotel', page: 'hotel' },
      { label: 'PropertyOS', page: 'property' },
      { label: 'Booking Site', page: 'booking-site' },
      { label: 'Manager App', page: 'manager-app' },
      { label: 'Control Center', page: 'control-center' },
      { label: 'Packages', page: 'packages' },
      { label: 'Why Switch', page: 'why-switch' },
      { label: 'Download', page: 'download' },
      { label: 'Blog', page: 'blog' },
      { label: 'Contact', page: 'contact' },
      { label: 'WhatsApp: +267 72 789 415', href: 'https://wa.me/26772789415', ext: true },
      { label: 'support@tsabonno.com', href: 'mailto:support@tsabonno.com' },
      { label: 'Privacy Policy', page: 'privacy' },
      { label: 'Terms of Service', page: 'terms' }
    ]
  },

  lodge: {
    id: 'lodge',
    origin: 'https://lodge.tsabonno.com',
    favicon: './assets/tsa-bonno-lodgingos-logo.svg',
    defaultProduct: 'lodge-camp',
    functions: false,
    cta: { label: 'Start trial', action: 'download' },
    mobile: {
      ctaLabel: 'Start free trial',
      ctaAction: 'download',
      secondary: { label: 'See packages', page: 'packages' }
    },
    footerCopy:
      'Built to help lodges operate smoothly, make better decisions, and grow into stronger hospitality businesses.',
    nav: [
      { label: 'Features', page: 'features', nav: 'features' },
      { label: 'Packages', page: 'packages', nav: 'packages' },
      { label: 'Why Switch', page: 'why-switch', nav: 'why-switch' },
      { label: 'Manager App', page: 'manager-app', nav: 'manager-app' },
      { label: 'Booking Site', page: 'booking-site', nav: 'booking-site' },
      { label: 'Control Center', page: 'control-center', nav: 'control-center' },
      { label: 'Contact', page: 'contact', nav: 'contact' }
    ],
    mobileNav: [
      { label: 'Home', page: 'lodge-app', nav: 'lodge-app' },
      { label: 'Features', page: 'features', nav: 'features' },
      { label: 'Packages', page: 'packages', nav: 'packages' },
      { label: 'Why Switch', page: 'why-switch', nav: 'why-switch' },
      { label: 'Manager App', page: 'manager-app', nav: 'manager-app' },
      { label: 'Booking Site', page: 'booking-site', nav: 'booking-site' },
      { label: 'Control Center', page: 'control-center', nav: 'control-center' },
      { label: 'Contact', page: 'contact', nav: 'contact' }
    ],
    footerLinks: [
      { label: 'Lodge &amp; Camp', page: 'lodge-app' },
      { label: 'Features', page: 'features' },
      { label: 'Packages', page: 'packages' },
      { label: 'Why Switch', page: 'why-switch' },
      { label: 'Download', page: 'download' },
      { label: 'Manager App', page: 'manager-app' },
      { label: 'Booking Site', page: 'booking-site' },
      { label: 'Control Center', page: 'control-center' },
      { label: 'Restaurant POS', page: 'restaurant-pos' },
      { label: 'Bar POS', page: 'bar-pos' },
      { label: 'Hotel', page: 'hotel' },
      { label: 'PropertyOS', page: 'property' },
      { label: 'Blog', page: 'blog' },
      { label: 'Contact', page: 'contact' },
      { label: 'WhatsApp: +267 72 789 415', href: 'https://wa.me/26772789415', ext: true },
      { label: 'support@tsabonno.com', href: 'mailto:support@tsabonno.com' },
      { label: 'Privacy Policy', page: 'privacy' },
      { label: 'Terms of Service', page: 'terms' }
    ]
  },

  restaurant: {
    id: 'restaurant',
    origin: 'https://restaurant.tsabonno.com',
    favicon: './assets/tsa-bonno-restaurant-bar-os-logo.svg',
    defaultProduct: 'hospitality-pos',
    functions: false,
    cta: { label: 'Start trial', action: 'download' },
    mobile: {
      ctaLabel: 'Start free trial',
      ctaAction: 'download',
      secondary: { label: 'Download', page: 'download' }
    },
    footerCopy:
      'Built to help restaurants and bars run smoother service, tighter stock control and clearer close-of-day numbers.',
    nav: [
      { label: 'Restaurant POS', page: 'restaurant-pos', nav: 'restaurant-pos' },
      { label: 'Download', page: 'download', nav: 'download' },
      { label: 'Contact', page: 'contact', nav: 'contact' }
    ],
    mobileNav: [
      { label: 'Home', page: 'restaurant-pos', nav: 'restaurant-pos' },
      { label: 'Download', page: 'download', nav: 'download' },
      { label: 'Contact', page: 'contact', nav: 'contact' }
    ],
    footerLinks: [
      { label: 'Restaurant POS', page: 'restaurant-pos' },
      { label: 'Download', page: 'download' },
      { label: 'Lodge &amp; Camp', page: 'lodge-app' },
      { label: 'Bar POS', page: 'bar-pos' },
      { label: 'Hotel', page: 'hotel' },
      { label: 'PropertyOS', page: 'property' },
      { label: 'Blog', page: 'blog' },
      { label: 'Contact', page: 'contact' },
      { label: 'WhatsApp: +267 72 789 415', href: 'https://wa.me/26772789415', ext: true },
      { label: 'support@tsabonno.com', href: 'mailto:support@tsabonno.com' },
      { label: 'Privacy Policy', page: 'privacy' },
      { label: 'Terms of Service', page: 'terms' }
    ]
  },

  bar: {
    id: 'bar',
    origin: 'https://bar.tsabonno.com',
    favicon: './assets/tsa-bonno-restaurant-bar-os-logo.svg',
    defaultProduct: 'hospitality-pos',
    functions: false,
    // The bar storefront is its own product home: POS CTAs stay on-site.
    productHome: { 'hospitality-pos': 'bar' },
    cta: { label: 'Start trial', action: 'download' },
    mobile: {
      ctaLabel: 'Start free trial',
      ctaAction: 'download',
      secondary: { label: 'Download', page: 'download' }
    },
    footerCopy:
      'Built to help restaurants and bars run smoother service, tighter stock control and clearer close-of-day numbers.',
    nav: [
      { label: 'Bar POS', page: 'bar-pos', nav: 'bar-pos' },
      { label: 'Pricing', href: './index.html#pricing' },
      { label: 'Download', page: 'download', nav: 'download' },
      { label: 'Contact', page: 'contact', nav: 'contact' }
    ],
    mobileNav: [
      { label: 'Home', page: 'bar-pos', nav: 'bar-pos' },
      { label: 'Pricing', href: './index.html#pricing' },
      { label: 'Download', page: 'download', nav: 'download' },
      { label: 'Contact', page: 'contact', nav: 'contact' }
    ],
    footerLinks: [
      { label: 'Bar POS', page: 'bar-pos' },
      { label: 'Pricing', href: './index.html#pricing' },
      { label: 'Download', page: 'download' },
      { label: 'Lodge &amp; Camp', page: 'lodge-app' },
      { label: 'Restaurant POS', page: 'restaurant-pos' },
      { label: 'Hotel', page: 'hotel' },
      { label: 'PropertyOS', page: 'property' },
      { label: 'Blog', page: 'blog' },
      { label: 'Contact', page: 'contact' },
      { label: 'WhatsApp: +267 72 789 415', href: 'https://wa.me/26772789415', ext: true },
      { label: 'support@tsabonno.com', href: 'mailto:support@tsabonno.com' },
      { label: 'Privacy Policy', page: 'privacy' },
      { label: 'Terms of Service', page: 'terms' }
    ]
  },

  hotel: {
    id: 'hotel',
    origin: 'https://hotel.tsabonno.com',
    favicon: './assets/tsa-bonno-hotelos-logo.svg',
    defaultProduct: 'hotel',
    functions: false,
    cta: { label: 'Register interest', action: 'interest' },
    mobile: {
      ctaLabel: 'Register interest',
      ctaAction: 'interest',
      secondary: { label: 'Contact us', page: 'contact' }
    },
    footerCopy: 'Hotel-native operations software from the Tsa Bonno team. HotelOS is coming soon.',
    nav: [
      { label: 'Hotel', page: 'hotel', nav: 'hotel' },
      { label: 'Capabilities', href: './index.html#capabilities' },
      { label: 'Contact', page: 'contact', nav: 'contact' }
    ],
    mobileNav: [
      { label: 'Home', page: 'hotel', nav: 'hotel' },
      { label: 'Capabilities', href: './index.html#capabilities' },
      { label: 'Contact', page: 'contact', nav: 'contact' }
    ],
    footerLinks: [
      { label: 'Hotel', page: 'hotel' },
      { label: 'Capabilities', href: './index.html#capabilities' },
      { label: 'Register interest', href: './index.html#interest' },
      { label: 'PropertyOS', page: 'property' },
      { label: 'Lodge &amp; Camp', page: 'lodge-app' },
      { label: 'Restaurant POS', page: 'restaurant-pos' },
      { label: 'Bar POS', page: 'bar-pos' },
      { label: 'Blog', page: 'blog' },
      { label: 'Contact', page: 'contact' },
      { label: 'WhatsApp: +267 72 789 415', href: 'https://wa.me/26772789415', ext: true },
      { label: 'support@tsabonno.com', href: 'mailto:support@tsabonno.com' },
      { label: 'Privacy Policy', page: 'privacy' },
      { label: 'Terms of Service', page: 'terms' }
    ]
  },

  property: {
    id: 'property',
    origin: 'https://property.tsabonno.com',
    favicon: './assets/tsa-bonno-hospitalityos-logo.svg',
    defaultProduct: 'property-os',
    functions: false,
    cta: { label: 'Register interest', action: 'interest' },
    mobile: {
      ctaLabel: 'Register interest',
      ctaAction: 'interest',
      secondary: { label: 'Contact us', page: 'contact' }
    },
    footerCopy:
      'PropertyOS — agency, management and facilities software from the Tsa Bonno team. Currently in development; pricing and launch dates are not decided yet.',
    nav: [
      { label: 'PropertyOS', page: 'property', nav: 'property' },
      { label: 'Modules', href: './index.html#modules' },
      { label: 'Contact', page: 'contact', nav: 'contact' }
    ],
    mobileNav: [
      { label: 'Home', page: 'property', nav: 'property' },
      { label: 'Modules', href: './index.html#modules' },
      { label: 'Contact', page: 'contact', nav: 'contact' }
    ],
    footerLinks: [
      { label: 'PropertyOS', page: 'property' },
      { label: 'Modules', href: './index.html#modules' },
      { label: 'Register interest', href: './index.html#interest' },
      { label: 'Lodge &amp; Camp', page: 'lodge-app' },
      { label: 'Restaurant POS', page: 'restaurant-pos' },
      { label: 'Bar POS', page: 'bar-pos' },
      { label: 'Hotel', page: 'hotel' },
      { label: 'Blog', page: 'blog' },
      { label: 'Contact', page: 'contact' },
      { label: 'WhatsApp: +267 72 789 415', href: 'https://wa.me/26772789415', ext: true },
      { label: 'support@tsabonno.com', href: 'mailto:support@tsabonno.com' },
      { label: 'Privacy Policy', page: 'privacy' },
      { label: 'Terms of Service', page: 'terms' }
    ]
  }
}

/**
 * Per-site page manifest. `src` is the source file (marketing-site/{src}.html),
 * `out` the output file name (defaults to src), `pretty` the public path shown
 * in canonicals/sitemaps (empty string = site root). `sitemap: false` keeps a
 * page out of the generated sitemap; `verbatim` copies the file untouched.
 */
export const SITE_PAGES = {
  hub: [
    { src: 'index', out: 'index', pretty: '' },
    { src: 'blog', pretty: 'blog' },
    { src: 'blog-choose-lodge-management-system', pretty: 'blog-choose-lodge-management-system' },
    { src: 'blog-payment-tracking-for-lodges', pretty: 'blog-payment-tracking-for-lodges' },
    { src: 'blog-reduce-waste-in-bar-and-kitchen', pretty: 'blog-reduce-waste-in-bar-and-kitchen' },
    { src: 'blog-signs-youve-outgrown-manual-admin', pretty: 'blog-signs-youve-outgrown-manual-admin' },
    { src: 'blog-what-owners-should-expect', pretty: 'blog-what-owners-should-expect' },
    { src: 'blog-when-to-add-online-reservations', pretty: 'blog-when-to-add-online-reservations' },
    { src: 'contact', pretty: 'contact' },
    { src: 'brochure', pretty: 'brochure' },
    { src: 'enterprise', pretty: 'enterprise' },
    { src: 'privacy', pretty: 'privacy' },
    { src: 'terms', pretty: 'terms' },
    { src: 'thank-you', pretty: 'thank-you', sitemap: false },
    { src: 'admin', pretty: 'admin', sitemap: false, verbatim: true },
    { src: '404', pretty: '404', sitemap: false }
  ],
  lodge: [
    { src: 'lodge-app', out: 'index', pretty: '' },
    { src: 'features', pretty: 'features' },
    { src: 'packages', pretty: 'packages' },
    { src: 'why-switch', pretty: 'why-switch' },
    { src: 'download', pretty: 'download' },
    { src: 'manager-app', pretty: 'manager-app' },
    { src: 'booking-site', pretty: 'booking-site' },
    { src: 'control-center', pretty: 'control-center' },
    { src: 'thank-you', pretty: 'thank-you', sitemap: false },
    { src: '404', pretty: '404', sitemap: false }
  ],
  restaurant: [
    { src: 'restaurant-pos', out: 'index', pretty: '' },
    { src: 'download', pretty: 'download' },
    { src: 'thank-you', pretty: 'thank-you', sitemap: false },
    { src: '404', pretty: '404', sitemap: false }
  ],
  bar: [
    { src: 'bar-pos', out: 'index', pretty: '' },
    { src: 'download', pretty: 'download' },
    { src: 'thank-you', pretty: 'thank-you', sitemap: false },
    { src: '404', pretty: '404', sitemap: false }
  ],
  hotel: [
    { src: 'hotel', out: 'index', pretty: '' },
    { src: 'thank-you', pretty: 'thank-you', sitemap: false },
    { src: '404', pretty: '404', sitemap: false }
  ],
  property: [
    { src: 'property', out: 'index', pretty: '' },
    { src: 'thank-you', pretty: 'thank-you', sitemap: false },
    { src: '404', pretty: '404', sitemap: false }
  ]
}

/** Canonical owner of each unique source page. */
const OWNERS = {
  index: 'hub',
  blog: 'hub',
  'blog-choose-lodge-management-system': 'hub',
  'blog-payment-tracking-for-lodges': 'hub',
  'blog-reduce-waste-in-bar-and-kitchen': 'hub',
  'blog-signs-youve-outgrown-manual-admin': 'hub',
  'blog-what-owners-should-expect': 'hub',
  'blog-when-to-add-online-reservations': 'hub',
  contact: 'hub',
  brochure: 'hub',
  enterprise: 'hub',
  privacy: 'hub',
  terms: 'hub',
  admin: 'hub',
  'lodge-app': 'lodge',
  features: 'lodge',
  packages: 'lodge',
  'why-switch': 'lodge',
  'manager-app': 'lodge',
  'booking-site': 'lodge',
  'control-center': 'lodge',
  'restaurant-pos': 'restaurant',
  'bar-pos': 'bar',
  hotel: 'hotel',
  property: 'property'
}

/** Pages built into every site: links always resolve within the current site. */
const SHARED_PAGES = new Set(['thank-you', '404'])

/** Pages built into several sites: current site wins, then the fallback site. */
const MULTI_PAGES = {
  download: ['lodge', 'restaurant', 'bar']
}

/**
 * Hub pages that moved to a subdomain in the ecosystem split. The build turns
 * each entry into a 301 redirect from the old hub URL to the new subdomain.
 * Pages that never existed on the hub (e.g. property) must NOT appear here.
 */
export const HUB_MOVED = {
  'lodge-app': 'lodge',
  features: 'lodge',
  packages: 'lodge',
  'why-switch': 'lodge',
  download: 'lodge',
  'manager-app': 'lodge',
  'booking-site': 'lodge',
  'control-center': 'lodge',
  'restaurant-pos': 'restaurant',
  'bar-pos': 'bar',
  hotel: 'hotel'
}

/** Where each product's canonical home lives (per-site overrides allowed). */
const PRODUCT_HOME = {
  'lodge-camp': 'lodge',
  'hospitality-pos': 'restaurant',
  hotel: 'hotel',
  'property-os': 'property'
}

function entryFor(siteId, src) {
  return (SITE_PAGES[siteId] || []).find((e) => e.src === src) || null
}

/**
 * Resolve a source page name to { siteId, entry } from the perspective of
 * `currentSite`. Returns null when the page is unknown (e.g. an asset path).
 */
export function resolvePage(src, currentSite) {
  if (!src) return null
  if (SHARED_PAGES.has(src)) {
    const entry = entryFor(currentSite, src)
    return entry ? { siteId: currentSite, entry } : null
  }
  if (MULTI_PAGES[src]) {
    if (entryFor(currentSite, src)) return { siteId: currentSite, entry: entryFor(currentSite, src) }
    const fallback = MULTI_PAGES[src][0]
    const entry = entryFor(fallback, src)
    return entry ? { siteId: fallback, entry } : null
  }
  const owner = OWNERS[src]
  if (!owner) return null
  const entry = entryFor(owner, src)
  return entry ? { siteId: owner, entry } : null
}

/** True when `src` names a page this build knows how to place. */
export function isKnownPage(src) {
  return Boolean(resolvePage(src, 'hub'))
}

export function relativeHref(entry) {
  return (entry.out || entry.src) === 'index' ? './index.html' : `./${entry.out || entry.src}.html`
}

export function absoluteFileHref(siteId, entry) {
  const origin = SITES[siteId].origin
  return (entry.out || entry.src) === 'index' ? `${origin}/` : `${origin}/${entry.out || entry.src}.html`
}

export function absolutePrettyHref(siteId, entry) {
  const origin = SITES[siteId].origin
  return entry.pretty === '' ? `${origin}/` : `${origin}/${entry.pretty}`
}

/**
 * Href for a nav/footer/mobile link item on `currentSite`.
 *   attr mode — same-site relative, cross-site absolute (.html form)
 *   pretty    — always absolute pretty path (canonical/JSON-LD style)
 */
export function itemHref(item, currentSite, mode = 'attr') {
  if (item.page) {
    const target = resolvePage(item.page, currentSite)
    if (!target) throw new Error(`Unknown page in nav/footer item: ${item.page}`)
    const sameSite = target.siteId === currentSite
    if (mode === 'pretty') return absolutePrettyHref(target.siteId, target.entry)
    if (sameSite) return relativeHref(target.entry)
    return absoluteFileHref(target.siteId, target.entry)
  }
  return item.href
}

/** Generated window.TSA_SITE object for a site (see marketing-site/script.js). */
export function siteConfig(site) {
  const productPages = {}
  for (const productId of Object.keys(PRODUCT_HOME)) {
    const homeSite = (site.productHome && site.productHome[productId]) || PRODUCT_HOME[productId]
    productPages[productId] = `${SITES[homeSite].origin}/`
  }
  return {
    id: site.id,
    origin: site.origin,
    defaultProduct: site.defaultProduct || undefined,
    productPages,
    pages: {
      enterprise: site.id === 'hub' ? './enterprise.html' : `${SITES.hub.origin}/enterprise.html`
    }
  }
}

/** Pretty-path URL list for a site's generated sitemap. */
export function sitemapEntries(siteId) {
  return SITE_PAGES[siteId]
    .filter((entry) => entry.sitemap !== false)
    .map((entry) => ({ url: absolutePrettyHref(siteId, entry), isIndex: (entry.out || entry.src) === 'index', isBlog: entry.src.startsWith('blog') }))
}
