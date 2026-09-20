import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { QUICK_CASH_AMOUNTS } from '../src/shared/tillBasketRecovery.js'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8')

const terminal = () => read('src/renderer/src/components/hospitality-pos/HposTerminal.jsx')

test('quick cash offers P20 alongside P50, P100 and P200', () => {
  assert.deepEqual([...QUICK_CASH_AMOUNTS], [20, 50, 100, 200])
  // The Till renders the shared list after Exact, so P20 appears with no
  // extra wiring when the list grows.
  assert.match(terminal(), /QUICK_CASH_AMOUNTS\.map\(\(amount\)/)
})

test('Bar cash sales block Pay while cash received is blank', () => {
  const source = terminal()
  assert.match(source, /Enter the cash received before taking payment/)
  assert.match(source, /tap Exact, P20, P50, P100, P200, or type the amount/)
  assert.match(source, /Cash received\{barOnly \? " \(required\)" : ""\}/)
})

test('blankReceived block is Bar-only and retry-safe', () => {
  const source = terminal()
  // Restaurant table service keeps the old optional behavior.
  assert.match(source, /if \(barOnly && String\(cashReceived \?\? ""\)\.trim\(\) === ""\)/)
  // Uncertain-attempt retries still reuse their original tendering aids and
  // never re-prompt: the guard sits inside the fresh-attempt cash branch.
  assert.match(source, /\} else if \(retryingSubmit\) \{/)
})
