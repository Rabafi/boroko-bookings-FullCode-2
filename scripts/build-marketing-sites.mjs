/**
 * Tsa Bonno multisite marketing build.
 *
 * Composes the public marketing sites from one source tree:
 *
 *   marketing-site/*.html        source pages (single source of truth)
 *   marketing-site/src/partials  shell partials (head, topbar, mobile nav,
 *                                footer, cookie banner) — defined once
 *   marketing-site/src/sites.mjs site registry (origins, nav, page ownership)
 *
 * Output (git-ignored): output/marketing/{hub,lodge,restaurant,bar,hotel,property}/
 *
 * Rules:
 *   - same-site links stay relative (./page.html), cross-site links become
 *     absolute subdomain URLs (https://lodge.tsabonno.com/...)
 *   - canonical/og/sitemap URLs use each site's origin
 *   - window.TSA_SITE (site-config.js) teaches script.js/quote.js the
 *     per-site product routing; without it the original relative fallbacks
 *     in marketing-site/script.js keep the legacy single-site behaviour
 *   - after writing, every href/src/quoted URL and in-page anchor is
 *     validated against the generated files; unknown page links fail the build
 */

import fs from 'node:fs/promises'
import path from 'node:path'
import {
  SITES,
  SITE_PAGES,
  HUB_MOVED,
  resolvePage,
  relativeHref,
  absoluteFileHref,
  absolutePrettyHref,
  itemHref,
  siteConfig,
  sitemapEntries
} from '../marketing-site/src/sites.mjs'

const root = process.cwd()
const siteRoot = path.join(root, 'marketing-site')
const srcDir = path.join(siteRoot, 'src')
const outRoot = path.join(root, 'output', 'marketing')

const BUILD_DATE = new Date().toISOString().slice(0, 10)
const failures = []
const warnings = []

function fail(message) {
  failures.push(message)
}

async function read(file) {
  return fs.readFile(file, 'utf8')
}

async function exists(file) {
  try {
    await fs.access(file)
    return true
  } catch {
    return false
  }
}

function fill(template, tokens) {
  return template.replace(/\{\{([A-Z0-9_]+)\}\}/g, (_, key) => {
    if (!(key in tokens)) throw new Error(`Partial token missing: {{${key}}}`)
    return tokens[key]
  })
}

/* ----------------------------------------------------------------------
   URL rewriting
   ---------------------------------------------------------------------- */

const HUB_HOST = /^(?:https?:\/\/)(?:www\.)?tsabonno\.com(?:\/|$|[?#])/i
const SCHEME = /^[a-z][a-z0-9+.-]*:/i

function rewriteUrl(value, siteId, mode) {
  if (!value) return value
  if (value.startsWith('#')) return value
  if (SCHEME.test(value) && !/^https?:/i.test(value)) return value // mailto:, tel:, data:

  if (/^https?:/i.test(value)) {
    if (!HUB_HOST.test(value)) return value // external or already a subdomain URL
    let url
    try {
      url = new URL(value)
    } catch {
      return value
    }
    const pathName = url.pathname.replace(/^\//, '').replace(/\.html$/, '').replace(/\/$/, '')
    const target = resolvePage(pathName === '' ? 'index' : pathName, siteId)
    if (!target) return value // assets, sitemap, robots, api paths stay on the hub
    const rest = (url.search || '') + (url.hash || '')
    if (mode === 'text') return absolutePrettyHref(target.siteId, target.entry) + rest
    if (target.siteId === siteId) return relativeHref(target.entry) + rest
    return absoluteFileHref(target.siteId, target.entry) + rest
  }

  if (value.startsWith('/')) {
    const match = value.match(/^\/([a-z0-9-]+)(\.html)?([?#].*)?$/i)
    if (match) {
      const target = resolvePage(match[1], siteId)
      if (target) {
        const rest = match[3] || ''
        if (mode === 'text') return absolutePrettyHref(target.siteId, target.entry) + rest
        if (target.siteId === siteId) return relativeHref(target.entry) + rest
        return absoluteFileHref(target.siteId, target.entry) + rest
      }
    }
    return value
  }

  const relative = value.match(/^\.\/([a-z0-9-]+)\.html([?#].*)?$/i)
  if (relative) {
    const target = resolvePage(relative[1], siteId)
    if (!target) throw new Error(`Unknown page link "${value}" (site ${siteId})`)
    const rest = relative[2] || ''
    if (mode === 'text') return absolutePrettyHref(target.siteId, target.entry) + rest
    if (target.siteId === siteId) return relativeHref(target.entry) + rest
    return absoluteFileHref(target.siteId, target.entry) + rest
  }

  return value // ./assets/..., ./styles.css — copied per site, stays relative
}

/** Pass 1: href/src attributes. Same-site → relative, cross-site → absolute. */
function rewriteAttributes(html, siteId) {
  return html.replace(/\b(href|src)="([^"]*)"/g, (_, attr, value) => `${attr}="${rewriteUrl(value, siteId, 'attr')}"`)
}

const TEXT_URL = /(?<!["'])https?:\/\/[a-z0-9.-]*tsabonno\.com(?:\/[^\s"'<>]*)?/gi
const QUOTED_URL = /https?:\/\/[a-z0-9.-]*tsabonno\.com(?:\/[^\s"'<>]*)?/gi

/**
 * Pass 2: URLs in prose (outside quotes). Quote-adjacent URLs are skipped —
 * they were already rewritten (or deliberately kept) by the attribute pass.
 */
function rewriteText(html, siteId) {
  return html.replace(TEXT_URL, (match) => rewriteUrl(match, siteId, 'text'))
}

/** Pass for JSON-LD and meta tags: absolute URLs everywhere, pretty form. */
function rewriteQuoted(html, siteId) {
  return html.replace(QUOTED_URL, (match) => rewriteUrl(match, siteId, 'text'))
}

/* ----------------------------------------------------------------------
   Source page parsing
   ---------------------------------------------------------------------- */

function parseSource(src, html) {
  const headStart = html.indexOf('<head>')
  const headEnd = html.indexOf('</head>')
  const bodyStart = html.indexOf('<body')
  const mainStart = html.indexOf('<main')
  const mainEnd = html.indexOf('</main>')
  if (headStart < 0 || headEnd < 0 || bodyStart < 0 || mainStart < 0 || mainEnd < 0) {
    throw new Error(`Source page ${src}.html is missing required shell markers`)
  }

  const head = html.slice(headStart + '<head>'.length, headEnd)
  const titleMatch = head.match(/<title>([\s\S]*?)<\/title>/)
  if (!titleMatch) throw new Error(`Source page ${src}.html has no <title>`)

  const metas = head.match(/<meta\b[^>]*>/g) || []
  const inlineStyles = head.match(/<style[^>]*>[\s\S]*?<\/style>/g) || []
  const jsonld = head.match(/<script type="application\/ld\+json">[\s\S]*?<\/script>/g) || []
  const headScripts = [...head.matchAll(/<script src="([^"]+)"[^>]*><\/script>/g)].map((m) => m[1])

  let leftover = head
  for (const block of [...metas, ...inlineStyles, ...jsonld]) leftover = leftover.split(block).join('')
  leftover = leftover
    .replace(/<title>[\s\S]*?<\/title>/, '')
    .replace(/<link\b[^>]*>/g, '')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  if (leftover) warnings.push(`head leftover on ${src}.html: ${leftover.slice(0, 180)}`)

  const bodyTag = html.match(/<body[^>]*>/)[0]
  const main = html.slice(mainStart, mainEnd + '</main>'.length)
  const afterMain = html.slice(mainEnd + '</main>'.length)
  const bodyScripts = [...afterMain.matchAll(/<script src="([^"]+)"([^>]*)><\/script>/g)].map((m) => ({
    src: m[1],
    attrs: m[2] || ''
  }))

  return {
    src,
    title: titleMatch[1],
    metas,
    inlineStyles,
    jsonld,
    headScripts,
    bodyTag,
    main,
    bodyScripts
  }
}

/* ----------------------------------------------------------------------
   Shell rendering
   ---------------------------------------------------------------------- */

function renderNav(items, siteId, withStagger) {
  return items
    .map((item, index) => {
      const href = itemHref(item, siteId)
      const nav = item.nav ? ` data-nav="${item.nav}"` : ''
      const stagger = withStagger ? ` data-stagger="${index}"` : ''
      return `<a href="${href}"${nav}${stagger}>${item.label}</a>`
    })
    .join('')
}

function renderFooterLinks(items, siteId) {
  return items
    .map((item) => {
      const href = item.page ? itemHref(item, siteId) : item.href
      const ext = item.ext ? ' target="_blank" rel="noreferrer"' : ''
      return `            <a href="${href}"${ext}>${item.label}</a>`
    })
    .join('\n')
}

function renderMeta(parsed, site) {
  const lines = []
  for (const raw of parsed.metas) {
    const trimmed = raw.trim()
    if (/^<meta charset/i.test(trimmed)) continue
    if (/name="viewport"/i.test(trimmed)) continue
    const keyMatch = trimmed.match(/(?:name|property)="([^"]+)"/)
    const key = keyMatch ? keyMatch[1] : ''
    if (key === 'og:image') {
      lines.push(`  <meta property="og:image" content="${site.origin}/assets/og-image.png" />`)
      continue
    }
    lines.push('  ' + rewriteQuoted(raw, site.id))
  }
  return lines.join('\n')
}

function processBodyTag(bodyTag, site) {
  let tag = bodyTag.replace('<body', `<body data-site="${site.id}"`)
  if (site.defaultProduct && !/data-product=/.test(tag)) {
    tag = tag.replace(/>$/, ` data-product="${site.defaultProduct}">`)
  }
  return tag
}

function composePage(site, entry, parsed, partials) {
  const headExtra = [
    ...parsed.inlineStyles.map((block) => rewriteText(block, site.id)),
    ...parsed.jsonld.map((block) => rewriteQuoted(block, site.id))
  ].join('\n')

  const head = fill(partials.head, {
    TITLE: parsed.title,
    META: renderMeta(parsed, site),
    CANONICAL: absolutePrettyHref(site.id, entry),
    ICON: site.favicon,
    HEAD_EXTRA: headExtra
  })

  const topbar = fill(partials.topbar, {
    NAV: renderNav(site.nav, site.id, false),
    CTA_ACTION: site.cta.action,
    CTA_LABEL: site.cta.label
  })

  const mobileSecondary = site.mobile.secondary
  const overlay = fill(partials.overlay, {
    MOBILE_NAV: renderNav(site.mobileNav, site.id, true),
    MOBILE_CTA_ACTION: site.mobile.ctaAction,
    MOBILE_CTA_LABEL: site.mobile.ctaLabel,
    MOBILE_SECONDARY_HREF: mobileSecondary.page
      ? itemHref(mobileSecondary, site.id)
      : mobileSecondary.href || '#',
    MOBILE_SECONDARY_LABEL: mobileSecondary.label
  })

  const footer = fill(partials.footer, {
    FOOTER_COPY: site.footerCopy,
    FOOTER_LINKS: renderFooterLinks(site.footerLinks, site.id)
  })

  const cookie = fill(partials.cookie, {
    PRIVACY_HREF: itemHref({ page: 'privacy' }, site.id)
  })

  const main = rewriteText(rewriteAttributes(parsed.main, site.id), site.id)

  const scripts = [
    '    <script src="./site-config.js" defer></script>',
    ...parsed.bodyScripts.map((script) => `    <script src="${script.src}"${script.attrs}></script>`)
  ].join('\n')

  const bodyOpen = [
    processBodyTag(parsed.bodyTag, site),
    '    <a href="#main" class="skip-link">Skip to content</a>',
    '    <div class="scroll-progress" id="scroll-progress"></div>',
    '    <div class="site-shell">'
  ].join('\n')

  return [
    head.trimEnd(),
    bodyOpen,
    topbar.trimEnd(),
    overlay.trimEnd(),
    main.trim(),
    footer.trimEnd(),
    cookie.trimEnd(),
    '    </div>',
    scripts,
    '  </body>',
    '</html>'
  ].join('\n') + '\n'
}

/* ----------------------------------------------------------------------
   Static config generation
   ---------------------------------------------------------------------- */

const LEGACY_BOROKO_REDIRECTS = [
  'https://borokobookings.com/* https://tsabonno.com/:splat 301!',
  'https://www.borokobookings.com/* https://tsabonno.com/:splat 301!',
  'https://borokobookings.netlify.app/* https://tsabonno.com/:splat 301!'
]

function buildRedirects(siteId) {
  const lines = []

  if (siteId === 'hub') {
    lines.push(...LEGACY_BOROKO_REDIRECTS)
    lines.push('')
    lines.push('# Ecosystem split (301): every product URL moves to its subdomain.')
    for (const [from, toSiteId] of Object.entries(HUB_MOVED)) {
      const entry = SITE_PAGES[toSiteId].find((e) => e.src === from)
      const target = SITES[toSiteId]
      const prettyTarget = `${target.origin}${entry.pretty === '' ? '/' : `/${entry.pretty}`}`
      const fileTarget = `${target.origin}${(entry.out || entry.src) === 'index' ? '/' : `/${entry.out || entry.src}.html`}`
      lines.push(`/${from} ${prettyTarget} 301`)
      lines.push(`/${from}.html ${fileTarget} 301`)
    }
    lines.push('')
    lines.push('# Hub pretty URLs (same content, stable paths).')
  } else {
    lines.push('# Pretty URLs for this site.')
  }

  for (const entry of SITE_PAGES[siteId]) {
    if (entry.src === '404') continue
    if ((entry.out || entry.src) === 'index') continue
    if (siteId === 'hub' && HUB_MOVED[entry.src]) continue // moved pages redirect above
    lines.push(`/${entry.pretty} /${entry.out || entry.src}.html 200`)
  }

  return lines.join('\n') + '\n'
}

function buildNetlifyToml(site) {
  const lines = ['[build]', '  publish = "."', '']
  if (site.functions) {
    lines.push('[functions]', '  directory = "netlify/functions"', '')
  }
  lines.push(
    '[[headers]]',
    '  for = "/*"',
    '  [headers.values]',
    '    X-Frame-Options = "DENY"',
    '    X-Content-Type-Options = "nosniff"',
    '    Referrer-Policy = "strict-origin-when-cross-origin"',
    '    Content-Security-Policy = "default-src \'self\'; script-src \'self\' https://www.googletagmanager.com https://unpkg.com; style-src \'self\' \'unsafe-inline\'; img-src \'self\' data: https: https://tsabonno.com; connect-src \'self\' https://oicgpknsmtvcsjacymum.supabase.co https://api.github.com; font-src \'self\'; base-uri \'self\'; form-action \'self\'; frame-ancestors \'none\';"'
  )
  return lines.join('\n') + '\n'
}

function buildRobots(site) {
  return `User-agent: *\nAllow: /\n\nSitemap: ${site.origin}/sitemap.xml\n`
}

function buildSitemap(siteId) {
  const urls = sitemapEntries(siteId)
    .map(({ url, isIndex, isBlog }) => {
      const changefreq = isIndex || isBlog ? 'weekly' : 'monthly'
      const priority = isIndex ? '1.0' : isBlog ? '0.7' : '0.8'
      return [
        '  <url>',
        `    <loc>${url}</loc>`,
        `    <lastmod>${BUILD_DATE}</lastmod>`,
        `    <changefreq>${changefreq}</changefreq>`,
        `    <priority>${priority}</priority>`,
        '  </url>'
      ].join('\n')
    })
    .join('\n')
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`
}

function buildSiteConfig(site) {
  const config = siteConfig(site)
  return (
    '/* Generated by scripts/build-marketing-sites.mjs — do not edit. */\n' +
    'window.TSA_SITE = ' +
    JSON.stringify(config, null, 2) +
    '\n'
  )
}

/* ----------------------------------------------------------------------
   Asset collection
   ---------------------------------------------------------------------- */

function collectAssetRefs(htmlSnippets) {
  const refs = new Set()
  for (const html of htmlSnippets) {
    for (const match of html.matchAll(/\b(?:href|src)="([^"]+)"/g)) {
      const value = match[1]
      if (!value.startsWith('./')) continue
      const file = value.slice(2).split(/[?#]/)[0]
      if (file && !file.endsWith('.html')) refs.add(file)
    }
    for (const match of html.matchAll(/\bsrcset="([^"]+)"/g)) {
      for (const part of match[1].split(',')) {
        const url = part.trim().split(/\s+/)[0]
        if (url && url.startsWith('./')) {
          const file = url.slice(2)
          if (!file.endsWith('.html')) refs.add(file)
        }
      }
    }
    // Inline style / <style> url("./…") references (e.g. brochure backgrounds)
    for (const match of html.matchAll(/url\(\s*["']?(\.\/[^"')\s]+)["']?\s*\)/g)) {
      const file = match[1].slice(2).split(/[?#]/)[0]
      if (file && !file.endsWith('.html')) refs.add(file)
    }
  }
  return refs
}

async function copyAssets(siteId, htmlSnippets) {
  const outDir = path.join(outRoot, siteId)
  const refs = collectAssetRefs(htmlSnippets)
  refs.add('assets/og-image.png') // og:image meta is absolute
  for (const ref of refs) {
    // site-config.js is generated per site (written above), not copied.
    if (ref === 'site-config.js') continue
    const from = path.join(siteRoot, ref)
    if (!(await exists(from))) {
      fail(`${siteId}: referenced file missing in source: ${ref}`)
      continue
    }
    const to = path.join(outDir, ref)
    await fs.mkdir(path.dirname(to), { recursive: true })
    await fs.copyFile(from, to)
  }
  return refs.size
}

/* ----------------------------------------------------------------------
   Validation — every generated link and anchor must resolve
   ---------------------------------------------------------------------- */

const idCache = new Map()
const fileCache = new Map()

async function loadFile(file) {
  if (!fileCache.has(file)) fileCache.set(file, await read(file).catch(() => null))
  return fileCache.get(file)
}

async function idsFor(file) {
  if (!idCache.has(file)) {
    const html = await loadFile(file)
    idCache.set(file, new Set(html ? [...html.matchAll(/id="([^"]+)"/g)].map((m) => m[1]) : []))
  }
  return idCache.get(file)
}

function siteForHost(host) {
  if (host === 'tsabonno.com' || host === 'www.tsabonno.com') return 'hub'
  const match = host.match(/^([a-z0-9-]+)\.tsabonno\.com$/)
  if (match && SITES[match[1]]) return match[1]
  return null
}

async function resolveTargetFile(siteId, pathName) {
  const outDir = path.join(outRoot, siteId)
  const clean = pathName.replace(/^\//, '')
  const candidates =
    clean === '' || clean === '/'
      ? ['index.html']
      : clean.endsWith('/')
        ? [`${clean}index.html`]
        : [clean, `${clean}.html`, `${clean}/index.html`]
  for (const candidate of candidates) {
    const file = path.join(outDir, candidate)
    if (await exists(file)) return file
  }
  return null
}

/**
 * Validate one URL reference from a generated page.
 * Returns a failure string or null (null = valid or intentionally external).
 */
async function checkRef(value, fromFile, siteId) {
  if (!value || value === '#') return null
  const hashIndex = value.indexOf('#')
  const hash = hashIndex >= 0 ? value.slice(hashIndex + 1) : ''
  const bare = hashIndex >= 0 ? value.slice(0, hashIndex) : value
  const fromDir = path.dirname(fromFile)

  let targetFile = null

  if (bare === '') {
    targetFile = fromFile // same-page anchor
  } else if (bare.startsWith('#')) {
    return null
  } else if (bare.startsWith('./')) {
    const rel = bare.slice(2).split(/[?]/)[0]
    targetFile = path.join(fromDir, rel)
    if (!(await exists(targetFile))) {
      const pretty = await resolveTargetFile(siteId, `/${rel.replace(/\.html$/, '')}`)
      if (pretty) targetFile = pretty
      else return `missing file: ${value}`
    }
  } else if (/^https?:\/\//i.test(bare)) {
    let url
    try {
      url = new URL(bare)
    } catch {
      return null
    }
    const targetSite = siteForHost(url.hostname)
    if (!targetSite) return null // external host (wa.me, github, ...) — not validated
    targetFile = await resolveTargetFile(targetSite, url.pathname)
    if (!targetFile) return `unresolvable cross-site URL: ${value} (site ${siteId})`
  } else if (bare.startsWith('/')) {
    const rel = bare.split(/[?]/)[0]
    targetFile = await resolveTargetFile(siteId, rel)
    if (!targetFile) return `missing root-relative file: ${value} (site ${siteId})`
  } else {
    return null // mailto:, tel:, data:, plain external
  }

  if (hash && targetFile) {
    const ids = await idsFor(targetFile)
    if (!ids.has(hash)) return `broken anchor: ${value} (no id="${hash}" in ${path.relative(outRoot, targetFile)})`
  }
  return null
}

async function validateSite(siteId) {
  const outDir = path.join(outRoot, siteId)
  const pages = (await fs.readdir(outDir)).filter((name) => name.endsWith('.html'))
  let checked = 0
  for (const page of pages) {
    const file = path.join(outDir, page)
    const html = await loadFile(file)
    if (!html) continue
    const refs = new Set()
    for (const match of html.matchAll(/\b(?:href|src)="([^"]+)"/g)) refs.add(match[1])
    for (const match of html.matchAll(/\bsrcset="([^"]+)"/g)) {
      for (const part of match[1].split(',')) {
        const url = part.trim().split(/\s+/)[0]
        if (url) refs.add(url)
      }
    }
    // Inline style / <style> url("./…") references
    for (const match of html.matchAll(/url\(\s*["']?(\.\/[^"')\s]+)["']?\s*\)/g)) {
      refs.add(match[1])
    }
    // Quoted absolute URLs (meta content, JSON-LD, prose)
    for (const match of html.matchAll(/https?:\/\/[a-z0-9.-]*tsabonno\.com(?:\/[^\s"'<>\\]*)?/gi)) {
      refs.add(match[0].replace(/[.,;:!?]+$/, ''))
    }
    for (const ref of refs) {
      checked++
      const problem = await checkRef(ref, file, siteId)
      if (problem) fail(`${siteId}/${page}: ${problem}`)
    }
  }
  return { pages: pages.length, checked }
}

/* ----------------------------------------------------------------------
   Build
   ---------------------------------------------------------------------- */

async function loadPartials() {
  const load = (name) => read(path.join(srcDir, 'partials', name))
  return {
    head: await load('head.html'),
    topbar: await load('topbar.html'),
    overlay: await load('mobile-overlay.html'),
    footer: await load('footer.html'),
    cookie: await load('cookie-banner.html')
  }
}

async function main() {
  console.log(`[marketing-sites] building ${Object.keys(SITES).length} sites -> output/marketing/`)
  await fs.rm(outRoot, { recursive: true, force: true })
  await fs.mkdir(outRoot, { recursive: true })

  const partials = await loadPartials()
  const sourceNames = (await fs.readdir(siteRoot)).filter((name) => name.endsWith('.html')).map((name) => name.replace(/\.html$/, ''))

  // Parse every referenced source page once.
  const parsed = new Map()
  for (const siteId of Object.keys(SITES)) {
    for (const entry of SITE_PAGES[siteId]) {
      if (parsed.has(entry.src)) continue
      if (!sourceNames.includes(entry.src)) {
        fail(`source page missing: marketing-site/${entry.src}.html`)
        continue
      }
      const html = await read(path.join(siteRoot, `${entry.src}.html`))
      parsed.set(entry.src, entry.verbatim ? { verbatim: html } : parseSource(entry.src, html))
    }
  }

  const summary = []

  for (const siteId of Object.keys(SITES)) {
    const site = SITES[siteId]
    const outDir = path.join(outRoot, siteId)
    await fs.mkdir(outDir, { recursive: true })

    const htmlSnippets = []

    for (const entry of SITE_PAGES[siteId]) {
      const source = parsed.get(entry.src)
      if (!source) continue
      const outName = `${entry.out || entry.src}.html`
      if (source.verbatim) {
        // Standalone pages (admin) ship untouched onto the hub.
        await fs.writeFile(path.join(outDir, outName), source.verbatim)
        htmlSnippets.push(source.verbatim)
        continue
      }
      const composed = composePage(site, entry, source, partials)
      await fs.writeFile(path.join(outDir, outName), composed)
      htmlSnippets.push(composed)
    }

    // Generated per-site files
    await fs.writeFile(path.join(outDir, 'site-config.js'), buildSiteConfig(site))
    await fs.writeFile(path.join(outDir, 'robots.txt'), buildRobots(site))
    await fs.writeFile(path.join(outDir, 'sitemap.xml'), buildSitemap(siteId))
    await fs.writeFile(path.join(outDir, '_redirects'), buildRedirects(siteId))
    await fs.writeFile(path.join(outDir, 'netlify.toml'), buildNetlifyToml(site))

    if (site.functions) {
      const functionsDir = path.join(outDir, 'netlify', 'functions')
      await fs.mkdir(functionsDir, { recursive: true })
      await fs.copyFile(path.join(siteRoot, 'netlify', 'functions', 'quote-download.js'), path.join(functionsDir, 'quote-download.js'))
    }

    const assetCount = await copyAssets(siteId, htmlSnippets)
    summary.push({ siteId, origin: site.origin, pages: htmlSnippets.length, assets: assetCount })
  }

  // Second pass: every site is on disk now, so cross-site URLs resolve.
  for (const row of summary) {
    const stats = await validateSite(row.siteId)
    row.refs = stats.checked
  }

  for (const warning of [...new Set(warnings)]) console.warn(`[marketing-sites] WARN ${warning}`)

  console.log('')
  for (const row of summary) {
    console.log(
      `  ${row.siteId.padEnd(11)} ${row.origin.padEnd(32)} ${String(row.pages).padStart(3)} pages  ${String(row.assets).padStart(4)} assets  ${String(row.refs).padStart(5)} refs validated`
    )
  }

  if (failures.length) {
    console.error(`\n[marketing-sites] ${failures.length} problem(s):`)
    for (const failure of failures.slice(0, 60)) console.error(`  - ${failure}`)
    if (failures.length > 60) console.error(`  ... and ${failures.length - 60} more`)
    process.exitCode = 1
    return
  }

  console.log('\n[marketing-sites] OK — all links, assets and anchors resolve.')
}

await main()
