import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8')

test('PWA bottom navigation exposes a burger menu after Inbox', async () => {
  const nav = await read('manager-pwa/src/components/BottomNav.jsx')

  assert.match(nav, /\{ to: '\/control', label: 'Inbox', icon: MessageCircle \},\s*\{ to: '\/more', label: 'Menu', icon: Menu \}/)
  assert.match(nav, /grid-cols-6/)
  assert.match(nav, /min-w-0/)
  assert.match(nav, /aria-label=\{label === 'Menu' \? 'Open more pages'/)
  assert.doesNotMatch(nav, /min-w-\[62px\]/)
})

test('PWA menu lists the previously hidden manager pages', async () => {
  const menu = await read('manager-pwa/src/pages/More.jsx')

  for (const route of ['/quotations', '/invoices', '/expenses', '/audit', '/reports', '/guests', '/staff', '/conference', '/day-use', '/inventory']) {
    assert.match(menu, new RegExp(`to: '${route.replace('/', '\\/')}'`))
  }
  assert.match(menu, />Menu<\/h1>/)
  assert.match(menu, /All manager pages in one place/)
})
