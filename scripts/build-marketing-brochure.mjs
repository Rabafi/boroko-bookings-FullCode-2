import fs from 'node:fs/promises'
import http from 'node:http'
import path from 'node:path'
import { chromium } from 'playwright'

const root = process.cwd()
const siteRoot = path.join(root, 'marketing-site')
const outputDir = path.join(root, 'output', 'pdf')
const finalPdf = path.join(outputDir, 'tsa-bonno-hospitalityos-brochure.pdf')
const sitePdf = path.join(siteRoot, 'assets', 'tsa-bonno-hospitalityos-brochure.pdf')

async function resolveChromiumExecutable() {
  const preferred = chromium.executablePath()
  try {
    await fs.access(preferred)
    return preferred
  } catch {
    const browserRoot = path.join(process.env.LOCALAPPDATA || '', 'ms-playwright')
    const entries = await fs.readdir(browserRoot, { recursive: true, withFileTypes: true })
    const chrome = entries.find((entry) => entry.isFile() && entry.name.toLowerCase() === 'chrome.exe' && entry.parentPath?.includes('chromium-'))
    if (!chrome) throw new Error('No installed Playwright Chromium executable was found.')
    return path.join(chrome.parentPath, chrome.name)
  }
}

const mime = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.avif': 'image/avif'
}

const server = http.createServer(async (request, response) => {
  try {
    const requestPath = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname)
    const relativePath = requestPath === '/' ? 'brochure.html' : requestPath.replace(/^\/+/, '')
    const target = path.resolve(siteRoot, relativePath)
    if (!target.startsWith(`${path.resolve(siteRoot)}${path.sep}`) && target !== path.resolve(siteRoot, 'brochure.html')) {
      response.writeHead(403).end('Forbidden')
      return
    }
    const body = await fs.readFile(target)
    response.writeHead(200, { 'content-type': mime[path.extname(target).toLowerCase()] || 'application/octet-stream' })
    response.end(body)
  } catch {
    response.writeHead(404).end('Not found')
  }
})

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const { port } = server.address()
// Use the full bundled Chromium executable. Some Playwright installations omit
// the matching headless-shell package while still providing Chromium itself.
const browser = await chromium.launch({ headless: true, executablePath: await resolveChromiumExecutable() })

try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 }, deviceScaleFactor: 1 })
  await page.goto(`http://127.0.0.1:${port}/brochure.html`, { waitUntil: 'networkidle' })
  await page.emulateMedia({ media: 'print' })
  await page.evaluate(async () => document.fonts?.ready)
  await page.addStyleTag({
    content: `@media print {
      html, body, main, .brochure-pages, .brochure-page, .brochure-page * {
        visibility: visible !important;
        opacity: 1 !important;
      }
      main.brochure-viewer { display: block !important; }
      .skip-link, .wa-float { display: none !important; }
    }`
  })
  await fs.mkdir(outputDir, { recursive: true })
  await page.pdf({
    path: finalPdf,
    format: 'A4',
    printBackground: true,
    preferCSSPageSize: true,
    margin: { top: '0', right: '0', bottom: '0', left: '0' }
  })
  await fs.copyFile(finalPdf, sitePdf)
  console.log(`Wrote ${finalPdf}`)
  console.log(`Updated ${sitePdf}`)
} finally {
  await browser.close()
  await new Promise((resolve) => server.close(resolve))
}
