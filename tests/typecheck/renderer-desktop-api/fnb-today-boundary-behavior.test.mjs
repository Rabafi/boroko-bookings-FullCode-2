import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const currentText = fs.readFileSync(path.join(root, 'src/renderer/src/components/fnb/FnbTodayView.jsx'), 'utf8')
const baselineText = fs.readFileSync(path.join(root, 'docs/engineering/typescript-migration/evidence/workerA-FnbTodayView-before-unknown-boundary-2026-10-15.jsx.txt'), 'utf8')

function runtimeExpressions(text, label) {
  const setData = text.match(/setData\((result)\)/)?.[1]
  const stale = text.match(/setStale\(((?:result|resultView)\?\._source === 'cache')\)/)?.[1]
  const condition = text.match(/if \(((?:result|resultView)\?\.success === false)\) setError\(([^\n]+)\)/)
  const thrown = text.match(/setError\(((?:e|errorView)\?\.message \|\| '[^']+')\)/)?.[1]
  const counts = text.match(/const counts = (data\?\.counts \|\| \{\}|dataView\?\.counts \|\| \{\})/)?.[1]
  assert.ok(setData, `${label}: original response assignment is present`)
  assert.ok(stale, `${label}: stale marker expression is present`)
  assert.ok(condition, `${label}: producer error expression is present`)
  assert.ok(thrown, `${label}: thrown error expression is present`)
  assert.ok(counts, `${label}: original count fallback is present`)
  return { stale, condition: condition[1], producer: condition[2], thrown, counts }
}

const baselineExpressions = runtimeExpressions(baselineText, 'baseline')
const currentExpressions = runtimeExpressions(currentText, 'current')
function runResult(expressions, result) {
  const resultView = result
  return {
    stored: result,
    stale: new Function('result', 'resultView', `return ${expressions.stale};`)(result, resultView),
    error: new Function('result', 'resultView', `if (${expressions.condition}) return ${expressions.producer}; return undefined;`)(result, resultView),
  }
}
const runThrown = (expression, e) => new Function('e', 'errorView', `return ${expression};`)(e, e)
function runCounts(expressions, data) {
  const dataView = data
  const counts = new Function('data', 'dataView', `return ${expressions.counts};`)(data, dataView)
  return counts.open_checks ?? '—'
}

test('FnbTodayView response, stale, and count behavior match the exact preimage', () => {
  const producerEnvelope = { success: true, lodge_id: 'lodge-1', outlet_id: null, counts: { open_checks: 0, waiting_tickets: 2 }, source: 'server', _source: 'server', _complete: true }
  const cachedEnvelope = { ...producerEnvelope, _source: 'cache', _complete: false }
  const cases = [null, undefined, 'bad cache', 12, [producerEnvelope], producerEnvelope, cachedEnvelope]
  for (const result of cases) assert.deepEqual(runResult(currentExpressions, result), runResult(baselineExpressions, result))
  const malformedArray = Object.assign([producerEnvelope], { success: false, error: 'array error', _source: 'cache' })
  assert.deepEqual(runResult(currentExpressions, malformedArray), runResult(baselineExpressions, malformedArray))
  assert.equal(runResult(currentExpressions, malformedArray).error, 'array error')
  for (const data of [null, 'bad cache', [], { counts: null }, { counts: { open_checks: { malformed: true } } }]) {
    assert.deepEqual(runCounts(currentExpressions, data), runCounts(baselineExpressions, data))
  }
  assert.deepEqual(runCounts(currentExpressions, { counts: { open_checks: { malformed: true } } }), { malformed: true })
})

test('producer string, malformed truthy, falsy, thrown-message, and null outcomes match the exact preimage', () => {
  const cases = [
    { label: 'producer string error', result: { success: false, error: 'SQL unavailable' } },
    { label: 'producer truthy non-string error', result: { success: false, error: { code: 'E_RPC' } } },
    { label: 'producer falsy zero error', result: { success: false, error: 0 } },
    { label: 'producer falsy empty error', result: { success: false, error: '' } },
    { label: 'null response', result: null },
  ]
  for (const { label, result } of cases) {
    assert.deepEqual(runResult(currentExpressions, result), runResult(baselineExpressions, result), label)
  }
  assert.equal(runResult(currentExpressions, cases[0].result).error, 'SQL unavailable')
  assert.deepEqual(runResult(currentExpressions, cases[1].result).error, { code: 'E_RPC' })
  assert.equal(runResult(currentExpressions, cases[2].result).error, 'Today view is unavailable.')
  assert.equal(runResult(currentExpressions, null).error, undefined)

  const truthyObjectMessage = { code: 'E_THROWN' }
  const thrownCases = [new Error('RPC denied'), { message: truthyObjectMessage }, { message: 0 }, { message: '' }, null]
  for (const thrown of thrownCases) {
    assert.deepEqual(runThrown(currentExpressions.thrown, thrown), runThrown(baselineExpressions.thrown, thrown))
  }
  assert.deepEqual(runThrown(currentExpressions.thrown, { message: truthyObjectMessage }), truthyObjectMessage)
  assert.equal(runThrown(currentExpressions.thrown, { message: 0 }), 'Today view is unavailable. Reconnect and retry.')
})
