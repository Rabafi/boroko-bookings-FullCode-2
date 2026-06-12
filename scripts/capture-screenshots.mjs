import { createClient } from '@supabase/supabase-js'
import http from 'http'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { chromium, _electron as electron } from 'playwright'
import sharp from 'sharp'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '..')
const outDir = path.resolve(repoRoot, 'marketing-site', 'assets', 'screenshots')

const EMAIL = 'botswapelostudios2@gmail.com'
const PASSWORD = 'Fillmeup12'

const SUPABASE_URL = 'https://oicgpknsmtvcsjacymum.supabase.co'
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9pY2dwa25zbXR2Y3NqYWN5bXVtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM2OTM1MTEsImV4cCI6MjA4OTI2OTUxMX0.WbC5C1QaVeNaTbTG0_xdcsUlK3BoA8onWC607B_uGlY'

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
}

function mimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase()
  const map = {
    '.html': 'text/html',
    '.js': 'application/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.woff2': 'font/woff2',
    '.woff': 'font/woff'
  }
  return map[ext] || 'application/octet-stream'
}

function startStaticServer(root, port) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      let filePath = path.join(root, req.url === '/' ? 'index.html' : req.url)
      if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
        filePath = path.join(root, 'index.html')
      }
      fs.readFile(filePath, (err, data) => {
        if (err) {
          res.writeHead(404)
          res.end('Not found')
          return
        }
        res.writeHead(200, { 'Content-Type': mimeType(filePath) })
        res.end(data)
      })
    })
    server.listen(port, '127.0.0.1', () => {
      console.log(`Static server listening on http://127.0.0.1:${port}`)
      resolve(server)
    })
    server.on('error', reject)
  })
}

// Known lodge slug for Botswapelo Inn
const KNOWN_SLUG = 'botswapeloinn'

async function getLodgeSlug() {
  // First try the Supabase RPC which the PWA uses for authentication
  try {
    const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
      email: EMAIL,
      password: PASSWORD
    })
    if (!authError && authData.session?.access_token) {
      const authed = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        global: { headers: { Authorization: `Bearer ${authData.session.access_token}` } }
      })
      const { data: lodgeData } = await authed.rpc('authenticate_manager_from_supabase', {
        p_email: EMAIL,
        p_password: PASSWORD
      })
      if (lodgeData?.lodge?.slug) {
        await supabase.auth.signOut()
        return lodgeData.lodge.slug
      }
      const { data: users } = await authed.from('users').select('lodge_id').eq('email', EMAIL).limit(1)
      if (users?.[0]?.lodge_id) {
        const { data: lodge } = await authed.from('lodges').select('slug, name').eq('id', users[0].lodge_id).limit(1)
        if (lodge?.[0]?.slug) {
          await supabase.auth.signOut()
          return lodge[0].slug
        }
      }
      await supabase.auth.signOut()
    }
  } catch (e) {
    console.warn('Supabase slug lookup failed:', e.message)
  }

  console.log('Using known slug:', KNOWN_SLUG)
  return KNOWN_SLUG
}

async function capturePwaScreenshots(port) {
  const browser = await chromium.launch({
    headless: true,
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
  })
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } })
  const page = await context.newPage()

  try {
    await page.goto(`http://127.0.0.1:${port}/`)
    await page.waitForTimeout(2000)

    // Login
    const emailInput = page.locator('input[type="email"]').first()
    const passwordInput = page.locator('input[type="password"]').first()
    if (await emailInput.isVisible().catch(() => false)) {
      await emailInput.fill(EMAIL)
      await passwordInput.fill(PASSWORD)
      await page.getByRole('button', { name: /Sign In/i }).click()
      await page.waitForTimeout(4000)

      // Lodge picker
      const lodgePicker = page.locator('h1').filter({ hasText: 'Select Your Lodge' })
      if (await lodgePicker.isVisible().catch(() => false)) {
        const firstLodge = page.locator('button').filter({ has: page.locator('p') }).first()
        if (await firstLodge.isVisible().catch(() => false)) {
          await firstLodge.click()
          await page.waitForTimeout(3000)
        }
      }
    }

    // Toggle to light mode (default is dark). The toggle button is in the top-right.
    const themeBtn = page.locator('button[title*="Switch to light mode"], button[title*="Switch to dark mode"]').first()
    if (await themeBtn.isVisible().catch(() => false)) {
      await themeBtn.click()
      await page.waitForTimeout(1500)
    }

    const shots = [
      { name: 'pwa-dashboard', path: '/' },
      { name: 'pwa-rooms', path: '/#/rooms' },
      { name: 'pwa-bookings', path: '/#/bookings' },
      { name: 'pwa-money', path: '/#/money' },
      { name: 'pwa-alerts', path: '/#/alerts' }
    ]

    for (const shot of shots) {
      await page.goto(`http://127.0.0.1:${port}${shot.path}`)
      await page.waitForTimeout(6000)
      await page.screenshot({ path: path.join(outDir, `${shot.name}.png`), fullPage: false })
      console.log(`Captured ${shot.name}.png`)
    }
  } finally {
    await browser.close()
  }
}

async function captureDesktopScreenshots() {
  let app
  try {
    app = await electron.launch({
      args: [repoRoot],
      cwd: repoRoot,
      env: {
        ...process.env,
        BOROKO_TEST_FORCE_OFFLINE: 'false',
        NODE_ENV: 'development'
      }
    })

    // The app creates a splash window first, then the main window.
    // The splash gets destroyed when the main window is ready.
    // Wait up to 30s for a valid (non-destroyed) window.
    let window = null
    for (let i = 0; i < 30; i++) {
      const wins = app.windows()
      for (const win of wins) {
        try {
          await win.waitForLoadState('domcontentloaded', { timeout: 2000 })
          const url = win.url()
          // Skip splash window (data: URL) — main window loads a file or renderer URL
          if (url && !url.startsWith('data:')) {
            window = win
            break
          }
        } catch {
          // Window was destroyed (splash) or not ready yet
        }
      }
      if (window) break
      await new Promise(r => setTimeout(r, 1000))
    }

    if (!window) {
      // Fallback: try firstWindow()
      window = await app.firstWindow()
      await window.waitForLoadState('domcontentloaded')
    }

    console.log('Desktop main window found, waiting for app to stabilise...')
    await window.waitForTimeout(8000)

    // Check for lodge picker screen: "Choose a Lodge on This Computer"
    const chooseLodgeHeading = window.locator('h1, h2').filter({ hasText: /Choose.*Lodge|Select.*Lodge/i })
    if (await chooseLodgeHeading.isVisible().catch(() => false)) {
      console.log('Lodge picker screen detected, clicking "Use Lodge"...')
      const useLodgeBtn = window.locator('button').filter({ hasText: /Use Lodge/i })
      if (await useLodgeBtn.isVisible().catch(() => false)) {
        await useLodgeBtn.click()
        await window.waitForTimeout(5000)
      }
    }

    // Check for login screen (Email + Password fields + Sign In)
    const emailInput = window.locator('input[type="email"]')
    const passwordInput = window.locator('input[type="password"]')
    if (await emailInput.isVisible().catch(() => false)) {
      console.log('Login screen detected, entering credentials and signing in...')
      await emailInput.fill(EMAIL)
      await passwordInput.fill(PASSWORD)
      const signInBtn = window.locator('button').filter({ hasText: /Sign In/i })
      if (await signInBtn.isVisible().catch(() => false)) {
        await signInBtn.click()
        await window.waitForTimeout(10000)
      }
    }

    // Wait for navigation away from login/choose-lodge to the main app
    for (let i = 0; i < 30; i++) {
      const hash = await window.evaluate(() => window.location.hash).catch(() => '')
      if (!hash.includes('choose-lodge') && !hash.includes('/login')) break
      await window.waitForTimeout(1000)
    }
    await window.waitForTimeout(5000)

    const currentUrl = await window.evaluate(() => window.location.href).catch(() => 'N/A')
    console.log('Current URL after login:', currentUrl)

    // Navigate via sidebar links instead of direct hash manipulation
    const shots = [
      { name: 'desktop-dashboard', label: 'Dashboard' },
      { name: 'desktop-bookings', label: 'Bookings' },
      { name: 'desktop-room-grid', label: 'Room Board' },
      { name: 'desktop-invoices', label: 'Invoices' },
      { name: 'desktop-guests', label: 'Guests' },
      { name: 'desktop-reports', label: 'Reports' },
      { name: 'desktop-pos', label: 'POS' }
    ]

    for (const shot of shots) {
      const navLink = window.locator('a').filter({ hasText: new RegExp(`^${shot.label}$`) })
      if (await navLink.isVisible().catch(() => false)) {
        await navLink.click()
      }
      await window.waitForTimeout(5000)
      await window.screenshot({ path: path.join(outDir, `${shot.name}.png`), fullPage: false })
      console.log(`Captured ${shot.name}.png`)
    }
  } catch (e) {
    console.warn('Desktop screenshot failed:', e.message)
  } finally {
    if (app) await app.close().catch(() => {})
  }
}

async function captureBookingSiteScreenshots(port, slug) {
  const targetSlug = slug || 'demo-lodge'
  const browser = await chromium.launch({
    headless: true,
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
  })
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  const page = await context.newPage()

  try {
    // Capture lodge page
    await page.goto(`http://127.0.0.1:${port}/${targetSlug}`, { waitUntil: 'networkidle', timeout: 30000 }).catch(() => {})
    await page.waitForTimeout(5000)
    await page.screenshot({ path: path.join(outDir, 'booking-site-lodge.png'), fullPage: false })
    console.log('Captured booking-site-lodge.png')

    // Navigate the booking flow: set dates, search, click first room
    // The lodge page has date inputs and a "Search rooms" button
    const checkInInput = page.locator('input[type="date"]').first()
    const checkOutInput = page.locator('input[type="date"]').nth(1)
    if (await checkInInput.isVisible().catch(() => false)) {
      const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10)
      const dayAfter = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10)
      await checkInInput.fill(tomorrow)
      await checkOutInput.fill(dayAfter)
      const searchBtn = page.getByRole('button', { name: /Search rooms/i })
      if (await searchBtn.isVisible().catch(() => false)) {
        await searchBtn.click()
        await page.waitForTimeout(5000)
      }
    }

    // Click the first room card or "Book" link
    const firstRoomLink = page.locator('a[href*="/book"]').first()
    if (await firstRoomLink.isVisible().catch(() => false)) {
      await firstRoomLink.click()
      await page.waitForTimeout(5000)
    } else {
      // Fallback: direct URL
      await page.goto(`http://127.0.0.1:${port}/${targetSlug}/book`, { waitUntil: 'networkidle', timeout: 30000 }).catch(() => {})
      await page.waitForTimeout(5000)
    }

    await page.screenshot({ path: path.join(outDir, 'booking-site-book.png'), fullPage: false })
    console.log('Captured booking-site-book.png')
  } finally {
    await browser.close()
  }
}

async function generateOgImage() {
  const logoPath = path.resolve(repoRoot, 'marketing-site', 'assets', 'boroko-bookings-logo-light.png')
  const ogDir = path.resolve(repoRoot, 'marketing-site', 'assets')
  const ogPath = path.join(ogDir, 'og-image.png')

  // Create a 1200x630 branded OG image with the logo
  const svgText = `
    <svg width="1200" height="630" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" style="stop-color:#18352b"/>
          <stop offset="100%" style="stop-color:#1a4a3a"/>
        </linearGradient>
      </defs>
      <rect width="1200" height="630" fill="url(#bg)"/>
      <text x="600" y="280" text-anchor="middle" font-family="system-ui, sans-serif" font-size="56" font-weight="700" fill="#ffffff">Boroko Bookings</text>
      <text x="600" y="350" text-anchor="middle" font-family="system-ui, sans-serif" font-size="24" fill="#c8e6d9">Lodge Operations, Billing, and Online Reservations</text>
      <text x="600" y="420" text-anchor="middle" font-family="system-ui, sans-serif" font-size="18" fill="#8ab4a0">Built by Batswana for Batswana hospitality businesses</text>
    </svg>
  `

  try {
    const logoBuffer = fs.readFileSync(logoPath)
    const logoComposite = await sharp(logoBuffer).resize(80, 80).toBuffer()
    const svgBuffer = Buffer.from(svgText)
    await sharp(svgBuffer)
      .resize(1200, 630)
      .composite([
        { input: logoComposite, top: 140, left: 560 }
      ])
      .png()
      .toFile(ogPath)
    console.log('Generated OG image:', ogPath)
  } catch (e) {
    // Fallback: just create a simple green image with text
    console.warn('Logo composite failed, creating simple OG image:', e.message)
    const simpleSvg = `
      <svg width="1200" height="630" xmlns="http://www.w3.org/2000/svg">
        <rect width="1200" height="630" fill="#18352b"/>
        <text x="600" y="280" text-anchor="middle" font-family="system-ui, sans-serif" font-size="56" font-weight="700" fill="#ffffff">Boroko Bookings</text>
        <text x="600" y="350" text-anchor="middle" font-family="system-ui, sans-serif" font-size="24" fill="#c8e6d9">Lodge Operations, Billing, and Online Reservations</text>
      </svg>
    `
    await sharp(Buffer.from(simpleSvg)).png().toFile(ogPath)
  }
  return './assets/og-image.png'
}

async function main() {
  ensureDir(outDir)
  console.log('Output dir:', outDir)

  const slug = await getLodgeSlug()
  console.log('Lodge slug:', slug || 'not found')

  const pwaServer = await startStaticServer(path.join(repoRoot, 'manager-pwa', 'dist'), 5173)
  const bookingServer = await startStaticServer(path.join(repoRoot, 'booking-site', 'dist'), 5174)

  try {
    await capturePwaScreenshots(5173)
    await captureBookingSiteScreenshots(5174, slug)
    await captureDesktopScreenshots()
  } finally {
    pwaServer.close()
    bookingServer.close()
  }

  // Generate OG image
  await generateOgImage()

  console.log('Done. Screenshots saved to', outDir)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
