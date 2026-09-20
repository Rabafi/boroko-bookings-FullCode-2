import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8')

test('recovery inbox keeps its automation contract', () => {
  const source = read('src/renderer/src/components/hospitality-pos/HposOpenChecks.jsx')
  // Pinned by the Playwright recovery suite and unit suites.
  assert.match(source, /data-testid="recovery-inbox"/)
  assert.match(source, /Unresolved operations \(\{inbox\.length\}\)/)
  assert.match(source, /Check status/)
})

test('recovery inbox rows read as plain language, not record dumps', () => {
  const source = read('src/renderer/src/components/hospitality-pos/HposOpenChecks.jsx')
  // No truncated ids, raw outcome tokens, server codes, or storage jargon
  // in the visible row.
  assert.doesNotMatch(source, /legacy record/)
  assert.doesNotMatch(source, /· key \{String\(/)
  assert.doesNotMatch(source, /\{row\.envelope\?\.outcome\}/)
  assert.doesNotMatch(source, /row\.envelope\.lastCode \?/)
  assert.match(source, /Not confirmed yet/)
  assert.match(source, /For a tab that is no longer open/)
  assert.match(source, /same reference, so it can never post twice/)
  // Technical identifiers stay available to support via tooltip.
  assert.match(source, /inboxSupportTitle/)
})

test('inbox Check status always answers visibly, even when unresolved', () => {
  const source = read('src/renderer/src/components/hospitality-pos/HposOpenChecks.jsx')
  // The replay outcome message is stored per row instead of discarded, and
  // transport failures get a plain-language note — previously both were
  // swallowed and the button looked dead.
  assert.match(source, /recoveryResultMessage\(row\.kind, out\.classification, out\.result/)
  assert.match(source, /inboxNotes/)
  assert.match(source, /Check status could not reach the server/)
  // Every press leaves a trace even when the outcome does not change.
  assert.match(source, /Last checked \{new Date\(row\.envelope\.lastCheckedAt\)/)
  assert.match(source, /hpos-service-inbox__note/)
})

test('inbox Check status replays by the listed record key', () => {
  const source = read('src/renderer/src/components/hospitality-pos/HposOpenChecks.jsx')
  // The inbox lists by scanning stored keys; replay must use that exact key
  // or records stored outside the derived shapes report "no saved operation".
  assert.match(source, /storageKey: row\.key/)
})

test('unresolvable records get a manager-gated archive, never deletion advice', () => {
  const source = read('src/renderer/src/components/hospitality-pos/HposOpenChecks.jsx')
  // Records that can never replay (missing tab, unreadable) need a way out
  // that preserves evidence: archive keeps the resolved record for audit.
  assert.match(source, /archiveInboxItem/)
  assert.match(source, /archiveRecoveryEnvelope\(row\.kind, row\.envelope/)
  assert.match(source, /removeRecoveryKey\(row\.key\)/)
  assert.match(source, /REPLAY_MANAGER_ROLES/)
  assert.match(source, /window\.confirm\(/)
  assert.match(source, />\s*Archive\s*</)
  // Archive only ever appears for review-state rows, behind the manager gate.
  assert.match(source, /NEEDS_REVIEW\) && isManagerForRecovery/)
})

test('recovery inbox has card styling instead of bare text', () => {
  const css = read('src/renderer/src/styles/hospitality-pos.css')
  assert.match(css, /\.hpos-service-inbox\{[^}]*border[^}]*\}/)
  assert.match(css, /\.hpos-service-inbox__row\{[^}]*\}/)
  assert.match(css, /\.hpos-service-inbox__row>div\{[^}]*min-width:0[^}]*\}/)
})
