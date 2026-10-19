import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import ts from 'typescript'

const root = process.cwd()
const beforePath = path.join(root, 'docs/engineering/typescript-migration/evidence/workerA-DailyBriefingCard-before-typing-2026-10-15.jsx.txt')
const currentPath = path.join(root, 'src/renderer/src/components/shared/DailyBriefingCard.jsx')
const beforeText = fs.readFileSync(beforePath, 'utf8')
const currentText = fs.readFileSync(currentPath, 'utf8')

function findBriefingIf(text) {
  const source = ts.createSourceFile('DailyBriefingCard.jsx', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JSX)
  let found
  function visit(node) {
    if (ts.isIfStatement(node) && node.expression.getText(source).includes('get_daily_briefing')) found = node
    if (!found) ts.forEachChild(node, visit)
  }
  visit(source)
  assert.ok(found, 'actual DailyBriefingCard source contains the briefing response branch')
  return found.getText(source)
}

function findActionsGuard(text) {
  const source = ts.createSourceFile('DailyBriefingCard.jsx', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JSX)
  let found
  function visit(node) {
    if (ts.isJsxExpression(node) && node.expression && ts.isBinaryExpression(node.expression) && node.expression.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken && node.expression.getText(source).includes('actions')) {
      found = node.expression.left.getText(source)
    }
    if (!found) ts.forEachChild(node, visit)
  }
  visit(source)
  assert.ok(found, 'actual DailyBriefingCard source contains the suggested-actions guard')
  return found
}

function evaluate(expression, args) {
  const js = ts.transpileModule(`return (${expression})`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None, allowJs: true },
  }).outputText
  return Function(...args.names, js)(...args.values)
}

function runBriefingBranch(statement, res) {
  let called = false
  let value
  const js = ts.transpileModule(`function run(res, setBriefing) { ${statement} }`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None, allowJs: true },
  }).outputText
  const run = Function(`${js}; return run;`)()
  run(res, (next) => { called = true; value = next })
  return { called, value }
}

function outcome(run) {
  try {
    const result = run()
    return { kind: 'value', result }
  } catch (error) {
    return { kind: 'throw', name: error?.name, message: error?.message }
  }
}

test('briefing RPC branch preserves exact baseline behavior for valid, malformed, and getter-backed responses', () => {
  const beforeBranch = findBriefingIf(beforeText)
  const currentBranch = findBriefingIf(currentText)
  const inherited = Object.create({ toolResult: { tool: 'get_daily_briefing', result: { occupancy: 42 } } })
  const getterCalls = []
  const proxied = new Proxy({}, { get(_target, key) { getterCalls.push(String(key)); return key === 'toolResult' ? { tool: 'get_daily_briefing', result: 'proxy-result' } : undefined } })
  const cases = [
    undefined,
    null,
    {},
    false,
    9,
    'response',
    { toolResult: null },
    { toolResult: { tool: 'other', result: { occupancy: 8 } } },
    { toolResult: { tool: 'get_daily_briefing', result: { occupancy: 42 } } },
    { toolResult: { tool: 'get_daily_briefing' } },
    inherited,
    proxied,
  ]
  for (const res of cases) {
    getterCalls.length = 0
    const baseline = runBriefingBranch(beforeBranch, res)
    const baselineGetterCalls = [...getterCalls]
    getterCalls.length = 0
    const current = runBriefingBranch(currentBranch, res)
    assert.equal(current.called, baseline.called)
    assert.equal(current.value, baseline.value)
    if (res === proxied) assert.deepEqual(getterCalls, baselineGetterCalls)
  }
})

test('suggested-actions guard preserves truthiness, malformed values, and getter reads', () => {
  const beforeGuard = findActionsGuard(beforeText)
  const currentGuard = findActionsGuard(currentText)
  const cases = [
    undefined,
    null,
    {},
    { actions: null },
    { actions: [] },
    { actions: [{ label: 'Review' }] },
    { actions: { length: 0 } },
    { actions: { length: '0' } },
    { actions: { length: '1' } },
  ]
  for (const briefing of cases) {
    const baseline = outcome(() => evaluate(beforeGuard, { names: ['briefing'], values: [briefing] }))
    const current = outcome(() => evaluate(currentGuard, { names: ['briefing'], values: [briefing] }))
    assert.deepEqual(current, baseline)
  }

  const reads = []
  const getterBacked = Object.defineProperty({}, 'actions', { get() { reads.push('actions'); return { length: 1 } } })
  const beforeReads = []
  const currentReads = []
  const originalReadLog = reads
  const baseline = outcome(() => evaluate(beforeGuard, { names: ['briefing'], values: [getterBacked] }))
  beforeReads.push(...originalReadLog)
  reads.length = 0
  const current = outcome(() => evaluate(currentGuard, { names: ['briefing'], values: [getterBacked] }))
  currentReads.push(...reads)
  assert.deepEqual(current, baseline)
  assert.deepEqual(currentReads, beforeReads)
})
