import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8')

test('PWA theme is applied before first paint and synchronized with browser chrome', async () => {
  const [html, initializer, app, manifest, vercel] = await Promise.all([
    read('manager-pwa/index.html'),
    read('manager-pwa/public/theme-init.js'),
    read('manager-pwa/src/App.jsx'),
    read('manager-pwa/public/manifest.json'),
    read('manager-pwa/vercel.json')
  ])

  assert.match(html, /<script src="\/theme-init\.js"><\/script>/)
  assert.match(initializer, /prefers-color-scheme: light/)
  assert.match(initializer, /document\.documentElement\.style\.colorScheme/)
  assert.match(initializer, /meta\[name="theme-color"\]/)
  assert.match(app, /classList\.toggle\('light-mode'/)
  assert.match(app, /classList\.toggle\('dark-mode'/)
  assert.match(app, /apple-mobile-web-app-status-bar-style/)

  const parsedManifest = JSON.parse(manifest)
  assert.equal(parsedManifest.background_color, '#174c3a')
  assert.equal(parsedManifest.theme_color, '#174c3a')
  assert.match(vercel, /script-src 'self'/)
  assert.doesNotMatch(html, /<script>\s*\(\(\) =>/)
})

test('light mode defines native controls, autofill, safe areas, and compact phones', async () => {
  const [css, login] = await Promise.all([
    read('manager-pwa/src/index.css'),
    read('manager-pwa/src/pages/Login.jsx')
  ])

  assert.match(css, /html\.light-mode\s*\{[\s\S]*color-scheme:\s*light/)
  assert.match(css, /input:-webkit-autofill/)
  assert.match(css, /-webkit-backdrop-filter/)
  assert.match(css, /@media \(max-height: 700px\)/)
  assert.match(css, /env\(safe-area-inset-top\)/)
  assert.match(login, /Switch to light mode/)
  assert.match(login, /pwa-login-shell/)
})
