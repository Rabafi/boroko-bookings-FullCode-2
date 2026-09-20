import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const css = () => fs.readFileSync(path.join(root, 'src/renderer/src/styles/hospitality-pos.css'), 'utf8')

test('product card header wraps instead of pushing actions out of the box', () => {
  const source = css()
  // Narrow grid columns (min 270px) plus Edit/Receive/Delete cannot fit on
  // one row with long names — the header must wrap.
  assert.match(source, /\.hpos-service-menu-card__top\{[^}]*flex-wrap:wrap[^}]*\}/)
  // Title column must shrink (min-width 0) so long names break inside it.
  assert.match(source, /\.hpos-service-menu-card__top>div:first-child\{[^}]*min-width:0[^}]*\}/)
})

test('product card actions wrap inside the card, Delete included', () => {
  const source = css()
  // Actions stay right-aligned but drop to their own line when crowded and
  // never exceed the card width.
  assert.match(source, /\.hpos-service-row-actions\{[^}]*flex-wrap:wrap[^}]*\}/)
  assert.match(source, /\.hpos-service-row-actions\{[^}]*max-width:100%[^}]*\}/)
  // Buttons keep one line each so Delete never splits or slides out.
  assert.match(source, /\.hpos-service-row-actions button\{[^}]*white-space:nowrap[^}]*\}/)
})
