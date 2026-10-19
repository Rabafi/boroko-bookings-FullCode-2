import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import sharp from 'sharp'
import { PRODUCT_BRANDS } from '../../../src/shared/brandIdentity.js'
import { ANNOTATION_MARKS, annotateScreenshot } from './annotate_screenshots.mjs'

// Recaptures S00 (00-first-launch-splash.png) from the REAL Electron splash
// template in src/main/index.js. S00 has no harness page in
// capture_screenshots.mjs (it is an isolated fictional first-launch capture),
// so this script renders buildSplashHtml('hospitality-pos') verbatim:
// the theme map, splash builder and HTML escaper are extracted from the
// shipped source and evaluated with stubs, then fidelity-checked before
// the screenshot is taken. Any template change in src/main/index.js flows
// into the next recapture instead of silently going stale.
//
// Usage: node docs/bar-manual/build/capture_splash_s00.mjs
// Honors BAR_GUIDE_CAPTURE_DIR like the other capture scripts.

const dir = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(dir, '..', '..', '..')
const captureRoot = process.env.BAR_GUIDE_CAPTURE_DIR
  ? path.resolve(process.env.BAR_GUIDE_CAPTURE_DIR)
  : path.join(repoRoot, 'docs', 'bar-manual', 'assets', 'screenshots')

const PRODUCT_ID = 'hospitality-pos'
const SPLASH_FILE = '00-first-launch-splash.png'
// Historical S00 dimensions; keep them stable for manual layout and inventories.
const VIEWPORT = { width: 444, height: 420 }
const LOGO_PATH = path.join(repoRoot, 'src', 'main', 'assets', 'tsa-bonno-restaurant-bar-os-logo-light.png')

// JS-aware balanced-brace extractor: strings, template literals (with
// ${} nesting tracked by recorded depth), and comments are skipped so CSS
// braces inside the splash template literal cannot end the scan early.
// NOTE: regex literals are not specially handled; none of the extracted
// regions may contain a regex with a brace or quote character.
function extractBalanced(source, openIndex) {
  let depth = 0
  let i = openIndex
  const modes = []
  const top = () => modes[modes.length - 1]
  while (i < source.length) {
    const ch = source[i]
    const mode = top()
    if (mode === 'single' || mode === 'double') {
      if (ch === '\\') { i += 2; continue }
      if ((mode === 'single' && ch === "'") || (mode === 'double' && ch === '"')) modes.pop()
      i += 1
      continue
    }
    if (mode && mode.marker === 'template') {
      if (ch === '\\') { i += 2; continue }
      if (ch === '`') { modes.pop(); i += 1; continue }
      if (ch === '$' && source[i + 1] === '{') { depth += 1; modes.push({ marker: 'expr', depth }); i += 2; continue }
      i += 1
      continue
    }
    if (mode === 'lineComment') {
      if (ch === '\n') modes.pop()
      i += 1
      continue
    }
    if (mode === 'blockComment') {
      if (ch === '*' && source[i + 1] === '/') { modes.pop(); i += 2; continue }
      i += 1
      continue
    }
    if (ch === "'") { modes.push('single'); i += 1; continue }
    if (ch === '"') { modes.push('double'); i += 1; continue }
    if (ch === '`') { modes.push({ marker: 'template' }); i += 1; continue }
    if (ch === '/' && source[i + 1] === '/') { modes.push('lineComment'); i += 2; continue }
    if (ch === '/' && source[i + 1] === '*') { modes.push('blockComment'); i += 2; continue }
    if (ch === '{') { depth += 1; i += 1; continue }
    if (ch === '}') {
      depth -= 1
      i += 1
      const t = top()
      if (t && t.marker === 'expr' && t.depth - 1 === depth) modes.pop()
      if (depth === 0) return i
      if (depth < 0) throw new Error('Unbalanced braces while extracting splash source')
      continue
    }
    i += 1
  }
  throw new Error('Unbalanced braces while extracting splash source')
}

function extractStatement(source, marker) {
  const start = source.indexOf(marker)
  if (start < 0) throw new Error(`Splash source marker not found: ${marker}`)
  const open = source.indexOf('{', start)
  if (open < 0) throw new Error(`No block found after marker: ${marker}`)
  let end = extractBalanced(source, open)
  while (end < source.length && /[\s);]/.test(source[end])) end += 1
  return source.slice(start, end)
}

// escapeHtml is regex-heavy (regex-contained quotes would confuse the brace
// scanner), but it has no nested blocks, so its closing brace is the first
// column-zero "}" after its declaration.
function extractFlatFunction(source, name) {
  const marker = `function ${name}(`
  const start = source.indexOf(marker)
  if (start < 0) throw new Error(`Splash source marker not found: ${marker}`)
  const end = source.indexOf('\n}', start)
  if (end < 0) throw new Error(`No closing brace found for function: ${name}`)
  return source.slice(start, end + 2)
}

const mainSource = fs.readFileSync(path.join(repoRoot, 'src', 'main', 'index.js'), 'utf8')
const escapeHtmlSource = extractFlatFunction(mainSource, 'escapeHtml')
if (!escapeHtmlSource.includes('&amp;') || !escapeHtmlSource.includes('&#39;')) {
  throw new Error('Extracted escaper does not match the expected implementation; extraction is stale')
}
const splashSource = [
  extractStatement(mainSource, 'const PRODUCT_SPLASH_THEMES = Object.freeze('),
  extractStatement(mainSource, 'function getSplashTheme('),
  extractStatement(mainSource, 'function buildSplashHtml('),
  escapeHtmlSource
].join('\n')

if (!splashSource.includes('Checking internet connection')) {
  throw new Error('Extracted splash source does not contain the expected template; extraction is stale')
}

const renderSplash = new Function(
  'fs',
  'getAppDarkLogoPath',
  'APP_BRAND_NAME',
  'productId',
  `${splashSource}\nreturn buildSplashHtml(productId);`
)

const brandName = PRODUCT_BRANDS[PRODUCT_ID].name
const html = renderSplash(fs, () => LOGO_PATH, brandName, PRODUCT_ID)

// Fidelity gates: the render must carry the real product theme, the escaped
// brand name, and the real packaged light logo bytes.
if (!html.includes('linear-gradient(180deg, #2f222a 0%, #211920 100%)')) {
  throw new Error('Rendered splash is not the hospitality-pos plum theme; refusing to capture')
}
if (!html.includes('Tsa Bonno Restaurant &amp; Bar POS')) {
  throw new Error('Rendered splash lost the escaped product brand name; refusing to capture')
}
const embedded = html.match(/data:image\/png;base64,([A-Za-z0-9+/=]+)/)
if (!embedded || !Buffer.from(embedded[1], 'base64').equals(fs.readFileSync(LOGO_PATH))) {
  throw new Error('Rendered splash does not embed the packaged hospitality-pos light logo; refusing to capture')
}

let browser
try {
  browser = await chromium.launch({ headless: true, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' })
} catch {
  browser = await chromium.launch({ headless: true })
}
const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1 })
const page = await context.newPage()
await page.setContent(html, { waitUntil: 'load' })
await page.evaluate(() => document.fonts?.ready)
await page.waitForTimeout(900)
// Deterministic end-state: finish the one-shot entrance, pin the
// indeterminate indicators instead of catching a random sweep frame.
await page.evaluate(() => {
  for (const anim of document.getAnimations()) {
    if (anim.animationName === 'progressSweep') { anim.currentTime = 450; anim.pause() }
    else if (anim.animationName === 'pulse') { anim.currentTime = 300; anim.pause() }
    else if (typeof anim.finish === 'function') { try { anim.finish() } catch { /* keep first frame */ } }
  }
})
// Let the compositor commit the pinned frame before capturing.
await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))
const rawPath = path.join(captureRoot, 'raw', SPLASH_FILE)
await page.screenshot({ path: rawPath })
await context.close()
await browser.close()

// Pixel gates: 444x420, plum gradient edges, lodge green gone.
const shot = sharp(rawPath)
const metadata = await shot.metadata()
if (metadata.width !== VIEWPORT.width || metadata.height !== VIEWPORT.height) {
  throw new Error(`Unexpected S00 dimensions ${metadata.width}x${metadata.height}; expected 444x420`)
}
const { data, info } = await sharp(rawPath).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
const pixel = (x, y) => [...data.slice((y * info.width + x) * 4, (y * info.width + x) * 4 + 3)]
const near = (actual, expected, tolerance = 10) =>
  actual.every((channel, index) => Math.abs(channel - expected[index]) <= tolerance)
const topLeft = pixel(4, 4)
const bottomRight = pixel(info.width - 5, info.height - 5)
if (!near(topLeft, [47, 34, 42]) || !near(bottomRight, [33, 25, 32])) {
  throw new Error(`S00 gradient edges are not hospitality-pos plum (top ${topLeft}, bottom ${bottomRight})`)
}

const points = ANNOTATION_MARKS[SPLASH_FILE]
if (!points) throw new Error(`No annotation marks registered for ${SPLASH_FILE}`)
const annotatedPath = await annotateScreenshot(captureRoot, SPLASH_FILE, points)
const annotatedMeta = await sharp(annotatedPath).metadata()
if (annotatedMeta.width !== VIEWPORT.width || annotatedMeta.height !== VIEWPORT.height) {
  throw new Error('Annotated S00 dimensions diverged from the raw capture')
}

console.log('S00 recaptured from buildSplashHtml(hospitality-pos):')
console.log(' raw:      ', rawPath)
console.log(' annotated:', annotatedPath)
