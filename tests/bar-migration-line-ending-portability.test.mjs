// Newline portability of the anchored operator-attribution repair in
// supabase/migrations/20260730100000_shared_till_operator_attribution.sql.
//
// Root cause class: a dollar-quoted multiline matcher block carries the
// migration FILE's own line endings, while pg_get_functiondef returns the
// STORED definition. A CRLF checkout of the matcher against an LF-stored
// definition matches zero times and halts the chain (P0001), even though
// the contract is present.
//
// Checkout independence: matcher blocks are EXTRACTED from the real
// migration file, then canonical LF versions are derived once and explicit
// CRLF versions are built by a single conversion. Every named matrix case
// uses explicit LF_/CRLF_ variables — never raw working-tree bytes — when
// it claims a particular convention, so the suite passes identically on
// CRLF and LF checkouts (including fresh .gitattributes LF checkouts).
// The harness mirrors the migration's exact decision procedure, and anchor
// assertions pin the distinctive contract lines of the real artifact.
// No database connection.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const readBytes = (relativePath) => readFileSync(resolve(root, relativePath))
const readText = (relativePath) => readBytes(relativePath).toString('utf8')

const HALT_FILE = 'supabase/migrations/20260730100000_shared_till_operator_attribution.sql'
const rawHalt = readBytes(HALT_FILE).toString('binary')

function extractBlock(raw, tag) {
  const open = `$${tag}$`
  const first = raw.indexOf(open)
  assert.notEqual(first, -1, `migration must contain $${tag}$ block`)
  const second = raw.indexOf(open, first + open.length)
  assert.notEqual(second, -1, `migration must close $${tag}$ block`)
  return raw.slice(first + open.length, second)
}

// Raw working-tree extraction (convention depends on the checkout).
const FILE_OLD = extractBlock(rawHalt, 'old')
const FILE_NEW = extractBlock(rawHalt, 'new')
const toLF = (text) => text.replace(/\r\n/g, '\n')
// Single conversion from KNOWN-LF input only: asserting the absence of
// carriage returns first makes double-CR insertion impossible.
const toCRLF = (lfText) => {
  assert.equal(lfText.includes('\r'), false, 'CRLF construction requires LF input')
  return lfText.replace(/\n/g, '\r\n')
}

// Canonical matcher blocks, independent of the actual checkout.
const LF_OLD = toLF(FILE_OLD)
const LF_NEW = toLF(FILE_NEW)
const CRLF_OLD = toCRLF(LF_OLD)
const CRLF_NEW = toCRLF(LF_NEW)

// Faithful harness mirroring the repaired migration decision procedure:
// legacy byte-exact path first, normalized fallback, explicit
// already-installed branch, strict errors, verified output.
function transformDefinition(definition, rawOld, rawNew) {
  const count = (haystack, needle) => {
    if (!needle) throw new Error('empty matcher')
    return (haystack.length - haystack.split(needle).join('').length) / needle.length
  }
  const verifyOutput = (output, oldBlock, newBlock) => {
    assert.equal(count(output, newBlock), 1, 'output must contain the new block exactly once')
    assert.equal(count(output, oldBlock), 0, 'output must remove the old block entirely')
    return output
  }
  // Legacy path: byte-exact on the original definition (zero behavior
  // change when conventions already agree).
  if (count(definition, rawOld) === 1 && count(definition, rawNew) === 0) {
    return { action: 'execute-legacy', output: verifyOutput(definition.split(rawOld).join(rawNew), rawOld, rawNew) }
  }
  const live = toLF(definition)
  const oldBlock = toLF(rawOld)
  const newBlock = toLF(rawNew)
  const oldCount = count(live, oldBlock)
  const newCount = count(live, newBlock)
  if (oldCount === 1 && newCount === 0) {
    return { action: 'execute-normalized', output: verifyOutput(live.split(oldBlock).join(newBlock), oldBlock, newBlock) }
  }
  if (oldCount === 0 && newCount === 1) {
    return { action: 'already-installed', output: null }
  }
  if (oldCount === 0) {
    throw new Error('create_pos_order_v3 operator attribution contract is not in the expected form')
  }
  throw new Error('create_pos_order_v3 operator attribution contract is ambiguous')
}

const WRAPPER_HEAD = 'CREATE OR REPLACE FUNCTION public.create_pos_order_v3(payload jsonb) RETURNS jsonb LANGUAGE plpgsql AS $function$\ndeclare\n  v_operator_id uuid;\nbegin\n'
const WRAPPER_TAIL = '\n  return jsonb_build_object(\'success\', true);\nend;\n$function$;'
const TRAILER_TEXT = '-- trailing operator note with intentional literal content\n'
// Intentional single-line literals inside the swapped blocks must survive
// byte-identical (the harness never strips whitespace beyond CRLF->LF).
const ERROR_LITERAL = "'Authenticated POS operator could not be resolved'"
const lfDefinition = (oldBlock) => WRAPPER_HEAD + oldBlock + WRAPPER_TAIL + TRAILER_TEXT
const crlfDefinition = (oldBlock) => toCRLF(lfDefinition(toLF(oldBlock)))

test('matcher blocks extracted from the migration carry the intended contract', () => {
  assert.ok(LF_OLD.includes('coalesce(v_actor_id, v_shift.cashier_id);'), 'old block resolves operator to the manager')
  assert.ok(LF_OLD.includes("v_actor_role not in ('supervisor', 'manager', 'admin', 'super_admin')"), 'old block keeps the role gate')
  assert.ok(LF_NEW.includes('coalesce(v_shift.cashier_id, v_actor_id);'), 'new block resolves operator to the shift owner')
  assert.ok(LF_NEW.includes('v_actor_id is not null'), 'new block keeps the cashier-shift guard')
  assert.ok(LF_NEW.includes(ERROR_LITERAL), 'new block preserves the error literal')
  assert.ok(!LF_OLD.includes('v_shift.cashier_id, v_actor_id'), 'blocks are distinct revisions')
})

test('canonical matcher construction is checkout-independent and CR-safe', () => {
  assert.equal(LF_OLD.includes('\r'), false, 'LF_OLD carries no carriage returns on any checkout')
  assert.equal(LF_NEW.includes('\r'), false, 'LF_NEW carries no carriage returns on any checkout')
  assert.ok(CRLF_OLD.includes('\r\n'), 'CRLF_OLD uses CRLF sequences')
  assert.equal(CRLF_OLD.includes('\r\r\n'), false, 'no double carriage returns from conversion')
  assert.equal(CRLF_NEW.includes('\r\r\n'), false, 'no double carriage returns from conversion')
  assert.equal(toLF(CRLF_OLD), LF_OLD, 'CRLF round-trips to the canonical block')
  assert.equal(toLF(CRLF_NEW), LF_NEW, 'CRLF round-trips to the canonical block')
})

test('LF definition with LF matcher transforms on the legacy path', () => {
  const definition = lfDefinition(LF_OLD)
  const result = transformDefinition(definition, LF_OLD, LF_NEW)
  assert.equal(result.action, 'execute-legacy')
  assert.ok(result.output.includes('coalesce(v_shift.cashier_id, v_actor_id);'))
  assert.ok(!result.output.includes('coalesce(v_actor_id, v_shift.cashier_id);'))
  assert.ok(result.output.includes(TRAILER_TEXT.trim()), 'unrelated definition text is preserved')
  assert.ok(result.output.includes(ERROR_LITERAL), 'intentional literals survive byte-identical')
})

test('LF definition with CRLF matcher transforms (the live halt case)', () => {
  const definition = lfDefinition(LF_OLD)
  const result = transformDefinition(definition, CRLF_OLD, CRLF_NEW)
  assert.equal(result.action, 'execute-normalized')
  assert.ok(result.output.includes('coalesce(v_shift.cashier_id, v_actor_id);'))
  assert.ok(!result.output.includes('coalesce(v_actor_id, v_shift.cashier_id);'))
  assert.ok(!result.output.includes('\r'), 'normalized output carries no carriage returns')
})

test('CRLF definition transforms with either matcher convention', () => {
  const definition = crlfDefinition(LF_OLD)
  const viaCrlf = transformDefinition(definition, CRLF_OLD, CRLF_NEW)
  assert.equal(viaCrlf.action, 'execute-legacy')
  const viaLf = transformDefinition(definition, LF_OLD, LF_NEW)
  assert.equal(viaLf.action, 'execute-normalized')
  assert.equal(viaLf.output, toLF(viaCrlf.output), 'both paths converge on identical normalized output')
})

test('missing contract fails; ambiguous contract fails', () => {
  const unrelated = `${WRAPPER_HEAD}  v_operator_id := null;\n${WRAPPER_TAIL}`
  assert.throws(() => transformDefinition(unrelated, LF_OLD, LF_NEW), /not in the expected form/)
  assert.throws(() => transformDefinition(unrelated, CRLF_OLD, CRLF_NEW), /not in the expected form/)
  const duplicated = WRAPPER_HEAD + LF_OLD + LF_OLD + WRAPPER_TAIL
  assert.throws(() => transformDefinition(duplicated, LF_OLD, LF_NEW), /ambiguous/)
})

test('already-installed definition is an explicit proven no-op, not a silent pass', () => {
  const installed = WRAPPER_HEAD + LF_NEW + WRAPPER_TAIL
  const result = transformDefinition(installed, LF_OLD, LF_NEW)
  assert.equal(result.action, 'already-installed')
  assert.equal(result.output, null)
  // A definition with neither block is NOT treated as installed.
  const neither = `${WRAPPER_HEAD}  v_operator_id := null;\n${WRAPPER_TAIL}`
  assert.throws(() => transformDefinition(neither, LF_OLD, LF_NEW), /not in the expected form/)
})

test('migration file keeps strict guards and documents the strategy', () => {
  const sql = readText(HALT_FILE)
  assert.match(sql, /chr\(13\)/, 'normalization is explicit in SQL')
  assert.match(sql, /not in the expected form/, 'zero-match error preserved')
  assert.match(sql, /ambiguous/, 'multiple-match error preserved')
  assert.match(sql, /already installed|already-installed/i, 'already-transformed branch is explicit')
  assert.match(sql, /pg_get_functiondef\('public\.create_pos_order_v3\(jsonb\)'::regprocedure\)/, 'same anchored target')
  assert.match(sql, /coalesce\(v_shift\.cashier_id, v_actor_id\)/, 'new attribution block retained verbatim')
  assert.match(sql, /coalesce\(v_actor_id, v_shift\.cashier_id\)/, 'old attribution block retained verbatim')
})
