import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')

function loadSourceFunctions(relativePath, wantedNames) {
  const sourceText = fs.readFileSync(path.join(root, relativePath), 'utf8')
  const source = ts.createSourceFile(relativePath, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.JSX)
  const declarations = source.statements.filter((statement) =>
    ts.isFunctionDeclaration(statement) && statement.name && wantedNames.includes(statement.name.text))
  assert.deepEqual(declarations.map((declaration) => declaration.name.text).sort(), [...wantedNames].sort())
  const context = vm.createContext({})
  vm.runInContext(declarations.map((declaration) => declaration.getText(source)).join('\n'), context)
  return Object.fromEntries(wantedNames.map((name) => [name, context[name]]))
}

function readAssignment(sourceText, name) {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = sourceText.match(new RegExp(`(?:const|let) ${escapedName} = ([^\\r\\n]+)`))
  assert.ok(match, `expected source assignment for ${name}`)
  return match[1]
}

function readAgingValueExpression(sourceText) {
  const line = sourceText.split(/\r?\n/).find((entry) => entry.includes('setAging(') && entry.includes('agingResult.status'))
  assert.ok(line, 'expected fulfilled-aging setAging source expression')
  const start = line.indexOf('setAging(') + 'setAging('.length
  return line.slice(start, line.lastIndexOf(')'))
}

function readHistoryRowsExpression(sourceText) {
  const line = sourceText.split(/\r?\n/).find((entry) => entry.includes('rows:') && entry.includes('Array.isArray(result?.rows)'))
  assert.ok(line, 'expected history rows source expression')
  return line.slice(line.indexOf('rows:') + 'rows:'.length, line.lastIndexOf(',' )).trim()
}

function readHandlerObjectField(sourceText, handlerMarker, field) {
  const handlerStart = sourceText.indexOf(handlerMarker)
  assert.notEqual(handlerStart, -1, `expected handler marker ${handlerMarker}`)
  const fieldStart = sourceText.indexOf(`${field}:`, handlerStart)
  assert.notEqual(fieldStart, -1, `expected ${field} field after ${handlerMarker}`)
  const lineEnd = sourceText.indexOf('\n', fieldStart)
  const line = sourceText.slice(fieldStart, lineEnd === -1 ? undefined : lineEnd).trim()
  const valueStart = line.indexOf(':') + 1
  const nextField = field === 'rows' ? ', source:' : field === 'source' ? ', complete:' : ', loading:'
  const nextFieldStart = line.indexOf(nextField, valueStart)
  const valueEnd = nextFieldStart === -1 ? (line.endsWith(',') ? line.length - 1 : line.length) : nextFieldStart
  return line.slice(valueStart, valueEnd).trim()
}

function renderSourceMapRow(sourceText, rowsExpression, row) {
  const source = ts.createSourceFile('HposStock.jsx', sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.JSX)
  let callback
  const visit = (node) => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) &&
        node.expression.name.text === 'map' && node.expression.expression.getText(source) === rowsExpression) {
      callback = node.arguments[0]
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  assert.ok(callback && ts.isArrowFunction(callback), `expected actual ${rowsExpression}.map row callback`)
  const renderSource = `const renderRow = ${callback.getText(source)}; renderRow`
  const compiled = ts.transpileModule(renderSource, { compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React } }).outputText
  const React = { createElement: (type, props, ...children) => ({ type, props: { ...props, ...(children.length ? { children } : {}) } }) }
  const dateSource = source.statements.flatMap((statement) => {
    if (!ts.isVariableStatement(statement)) return []
    return statement.declarationList.declarations.filter((declaration) => ts.isIdentifier(declaration.name) && declaration.name.text === 'formatAgeDate')
  })[0]
  assert.ok(dateSource?.initializer, 'expected actual formatAgeDate implementation')
  const dateCompiled = ts.transpileModule(`const formatAgeDate = ${dateSource.initializer.getText(source)}; formatAgeDate`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
  const formatAgeDate = vm.runInNewContext(dateCompiled, {})
  const renderRow = vm.runInNewContext(compiled, { React, formatAgeDate })
  try {
    return { value: JSON.stringify(renderRow(row, formatAgeDate)) }
  } catch (error) {
    return { thrown: `${error?.name}:${error?.message}` }
  }
}

for (const componentPath of [
  'src/renderer/src/components/NotificationInbox.jsx',
]) {
  test(`${componentPath} narrows notification RPC values without dropping SQL-shaped rows`, () => {
    const { isAdminNotificationRecord, readAdminNotifications, readUnreadCount, hasOwnKey } = loadSourceFunctions(
      componentPath,
      ['isAdminNotificationRecord', 'readAdminNotifications', 'readUnreadCount', 'hasOwnKey'],
    )
    const sqlRow = {
      id: 'a1b2c3d4-e5f6-4711-8111-123456789abc',
      type: 'custom_future_type',
      title: 'Server message',
      body: null,
      entity_type: null,
      entity_id: null,
      lodge_id: null,
      lodge_name: null,
      action_url: null,
      actor_email: null,
      read_at: null,
      created_at: '2026-10-15T09:30:00.000Z',
    }
    const rows = [sqlRow]
    assert.equal(isAdminNotificationRecord(sqlRow), true)
    assert.deepEqual(Array.from(readAdminNotifications(rows)), rows)
    assert.equal(readAdminNotifications(rows)[0], sqlRow)
    assert.deepEqual(Array.from(readAdminNotifications([])), [])

    const malformed = [null, 7, 'row', { ...sqlRow, title: undefined }, { ...sqlRow, read_at: 0 }]
    assert.deepEqual(Array.from(readAdminNotifications(malformed)), [])
    assert.deepEqual(Array.from(readAdminNotifications({ rows })), [])
    assert.equal(readUnreadCount(4), 4)
    assert.equal(readUnreadCount(0), 0)
    assert.equal(readUnreadCount('4'), 0)
    assert.equal(readUnreadCount(Number.POSITIVE_INFINITY), 0)
    const typeConfig = { info: {}, warning: {} }
    assert.equal(hasOwnKey(typeConfig, 'warning'), true)
    assert.equal(hasOwnKey(typeConfig, 'future_type'), false)
    assert.equal(hasOwnKey(typeConfig, '__proto__'), false)
    assert.equal(hasOwnKey(typeConfig, 'toString'), false)
  })
}

test('HposStock preserves malformed and cached inventory/aging rows from its original source expressions', () => {
  const componentPath = 'src/renderer/src/components/hospitality-pos/HposStock.jsx'
  const current = fs.readFileSync(path.join(root, componentPath), 'utf8')
  const baselinePath = path.join(root, 'docs/engineering/typescript-migration/evidence/L02-preimages-workerA-2026-10-14/HposStock.jsx')
  const baseline = fs.readFileSync(baselinePath, 'utf8')
  const currentRowsExpression = readAssignment(current, 'rows')
  const baselineRowsExpression = readAssignment(baseline, 'rows')
  const currentAgingExpression = readAgingValueExpression(current)
  const baselineAgingExpression = readAgingValueExpression(baseline)
  const currentHistoryRowsExpression = readHistoryRowsExpression(current)
  const baselineHistoryRowsExpression = readHistoryRowsExpression(baseline)
  const movementMarker = 'const result = await window.api.inventory.getMovementsWithReadStatus('
  const allHistoryMarker = 'const result = await window.api.inventory.getBarStockCountHistory('
  const runRows = (expression, inventoryRead) => Function('inventoryRead', 'unpackTransport', `return ${expression}`)(inventoryRead, (value) => value)
  const runAging = (expression, agingResult) => Function('agingResult', `return ${expression}`)(agingResult)
  const runHistoryRows = (expression, result) => Function('result', `return ${expression}`)(result)
  const runResultExpression = (expression, result) => Function('result', `return ${expression}`)(result)

  const malformedRows = [null, 7, 'cached-row', { id: 'legacy', current_stock: '12' }]
  for (const items of [malformedRows, [], null, { cached: true }]) {
    const inventoryRead = { items }
    assert.deepEqual(runRows(currentRowsExpression, inventoryRead), runRows(baselineRowsExpression, inventoryRead))
  }
  for (const value of [malformedRows, [], null, { cached: true }]) {
    const agingResult = { value }
    assert.deepEqual(runAging(currentAgingExpression, agingResult), runAging(baselineAgingExpression, agingResult))
  }
  for (const result of [
    { rows: malformedRows, source: 'cache' },
    { rows: [], source: 'server' },
    { rows: null, source: 'cache' },
    null,
    'cached-result',
  ]) {
    assert.deepEqual(runHistoryRows(currentHistoryRowsExpression, result), runHistoryRows(baselineHistoryRowsExpression, result))
  }

  for (const [handlerMarker, fields] of [
    [movementMarker, ['rows', 'source', 'complete']],
    [allHistoryMarker, ['rows', 'source', 'complete']],
  ]) {
    for (const result of [
      { rows: malformedRows, source: 7, complete: true },
      { rows: [], source: '', complete: false },
      { rows: null, source: null, complete: 'true' },
      null,
      'cached-result',
    ]) {
      for (const field of fields) {
        const currentExpression = readHandlerObjectField(current, handlerMarker, field)
        const baselineExpression = readHandlerObjectField(baseline, handlerMarker, field)
        assert.deepEqual(runResultExpression(currentExpression, result), runResultExpression(baselineExpression, result))
      }
    }
  }
})

test('HposStock history JSX preserves baseline fields and keys for normal and malformed rows', () => {
  const componentPath = 'src/renderer/src/components/hospitality-pos/HposStock.jsx'
  const current = fs.readFileSync(path.join(root, componentPath), 'utf8')
  const baseline = fs.readFileSync(path.join(root, 'docs/engineering/typescript-migration/evidence/L02-preimages-workerA-2026-10-14/HposStock.jsx'), 'utf8')
  const rows = [
    { id: 'move-1', operation_id: 'op-1', item_id: 'item-1', created_at: '2026-10-15T09:30:00Z', item_name: 'Water', item_unit: 'bottle', reference_type: 'bar_physical_count', expected_qty: 5, actual_qty: 4, delta: -1, reason_code: 'routine_count', notes: 'weekly', actor_name: 'Operator' },
    { id: 7, operation_id: 22, item_id: null, created_at: 0, item_name: 4, item_unit: {}, reference_type: 'delivery', expected_qty: {}, actual_qty: 'bad', delta: '1', reason_code: 9, notes: 12, actor_name: false, actor_id: {} },
    null,
  ]
  for (const [rowsExpression, marker] of [
    ['allHistory.rows', 'allHistory.rows.map((row) => '],
    ['movementHistory[historyItemId].rows', 'movementHistory[historyItemId].rows.map((row) => '],
  ]) {
    assert.ok(current.includes(marker) && baseline.includes(marker), `expected ${marker} in source files`)
    for (const row of rows) {
      assert.deepEqual(
        renderSourceMapRow(current, rowsExpression, row),
        renderSourceMapRow(baseline, rowsExpression, row),
      )
    }
  }
})

test('Notifications preserves original notification row and error outcomes at its RPC boundaries', () => {
  const {
    readAdminNotifications,
    readUnreadCount,
    readNotificationRules,
    readNotificationEvents,
    readErrorMessage,
  } = loadSourceFunctions('src/renderer/src/components/Notifications.jsx', [
    'readAdminNotifications',
    'readUnreadCount',
    'readNotificationRules',
    'readNotificationEvents',
    'readErrorMessage',
  ])
  const rule = {
    id: 'a1b2c3d4-e5f6-4711-8111-123456789abc',
    rule_key: 'trial_ending',
    label: 'Trial Ending',
    description: 'Alerts when a company trial is near expiry',
    enabled: true,
    severity: 'warning',
    channel: 'inbox',
    cooldown_minutes: 60,
    created_at: '2026-10-01T00:00:00Z',
    updated_at: '2026-10-10T00:00:00Z',
  }
  const event = {
    id: 'b1b2c3d4-e5f6-4711-8111-123456789abc',
    rule_key: 'trial_ending',
    entity_type: 'company',
    entity_id: null,
    entity_label: null,
    payload: { nested: ['unvalidated', null] },
    dispatched: false,
    dispatched_at: null,
    created_at: '2026-10-15T00:00:00Z',
  }
  const malformedRule = { ...rule, severity: 'unexpected' }
  const malformedEvent = { ...event, dispatched_at: 7 }
  const rawNotifications = [null, { id: 'unvalidated' }]
  assert.equal(readAdminNotifications(rawNotifications), rawNotifications)
  assert.deepEqual(Array.from(readAdminNotifications(null)), [])
  const rawEnvelope = { results: [] }
  assert.equal(readAdminNotifications(rawEnvelope), rawEnvelope)
  assert.equal(readUnreadCount('4'), '4')
  assert.equal(readUnreadCount(0), 0)
  assert.equal(readUnreadCount(false), 0)
  const rules = [rule, malformedRule, null]
  assert.equal(readNotificationRules(rules), rules)
  const events = [event, malformedEvent, null]
  assert.equal(readNotificationEvents(events), events)
  assert.deepEqual(Array.from(readNotificationRules({ data: [rule] })), [])
  assert.deepEqual(readErrorMessage({ message: { code: 'E' } }, 'fallback'), { code: 'E' })
  assert.equal(readErrorMessage({ message: '' }, 'fallback'), 'fallback')
  assert.equal(readErrorMessage('failure', 'fallback'), 'fallback')
})

test('Notifications preserves own-key fallback behavior at the actual map callsites', () => {
  const beforePath = path.join(root, 'docs/engineering/typescript-migration/evidence/workerA-Notifications-before-callers-and-runtime-preservation-2026-10-15.jsx.txt')
  const before = fs.readFileSync(beforePath, 'utf8')
  const current = fs.readFileSync(path.join(root, 'src/renderer/src/components/Notifications.jsx'), 'utf8')
  const expressions = (text) => ({
    type: text.match(/const cfg = (hasOwnKey\(TYPE_CONFIG, n\.type\) \? TYPE_CONFIG\[n\.type\] : TYPE_CONFIG\.info)/)?.[1],
    meta: text.match(/const meta = (hasOwnKey\(RULE_LABELS, rule\.rule_key\) \? RULE_LABELS\[rule\.rule_key\] : \{ label: rule\.rule_key, desc: '' \})/)?.[1],
    ruleLabel: text.match(/\{(hasOwnKey\(RULE_LABELS, r\.rule_key\) \? RULE_LABELS\[r\.rule_key\]\.label : r\.rule_key)\}/)?.[1],
  })
  const beforeExpressions = expressions(before)
  const currentExpressions = expressions(current)
  assert.deepEqual(currentExpressions, beforeExpressions)

  function actualHasOwnKey(text) {
    const source = ts.createSourceFile('Notifications.jsx', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JSX)
    const declaration = source.statements.find((statement) =>
      ts.isFunctionDeclaration(statement) && statement.name?.text === 'hasOwnKey')
    assert.ok(declaration)
    const context = vm.createContext({})
    vm.runInContext(declaration.getText(source), context)
    return context.hasOwnKey
  }
  const beforeHasOwnKey = actualHasOwnKey(before)
  const currentHasOwnKey = actualHasOwnKey(current)
  const typeConfig = { info: { icon: 'info' }, warning: { icon: 'warning' } }
  const ruleLabels = { trial_ending: { label: 'Trial Ending', desc: 'Trial notice' } }
  for (const key of ['info', 'toString', '__proto__', 'future_type']) {
    const beforeCfg = new Function('TYPE_CONFIG', 'n', 'hasOwnKey', `return ${beforeExpressions.type}`)(typeConfig, { type: key }, beforeHasOwnKey)
    const currentCfg = new Function('TYPE_CONFIG', 'n', 'hasOwnKey', `return ${currentExpressions.type}`)(typeConfig, { type: key }, currentHasOwnKey)
    assert.equal(currentCfg, beforeCfg, `TYPE_CONFIG.${key}`)
    const beforeMeta = new Function('RULE_LABELS', 'rule', 'hasOwnKey', `return ${beforeExpressions.meta}`)(ruleLabels, { rule_key: key }, beforeHasOwnKey)
    const currentMeta = new Function('RULE_LABELS', 'rule', 'hasOwnKey', `return ${currentExpressions.meta}`)(ruleLabels, { rule_key: key }, currentHasOwnKey)
    assert.deepEqual(currentMeta, beforeMeta, `RULE_LABELS metadata ${key}`)
    const beforeLabel = new Function('RULE_LABELS', 'r', 'hasOwnKey', `return ${beforeExpressions.ruleLabel}`)(ruleLabels, { rule_key: key }, beforeHasOwnKey)
    const currentLabel = new Function('RULE_LABELS', 'r', 'hasOwnKey', `return ${currentExpressions.ruleLabel}`)(ruleLabels, { rule_key: key }, currentHasOwnKey)
    assert.equal(currentLabel, beforeLabel, `RULE_LABELS row label ${key}`)
  }
  assert.equal(new Function('RULE_LABELS', 'r', 'hasOwnKey', `return ${currentExpressions.ruleLabel}`)(ruleLabels, { rule_key: 'toString' }, currentHasOwnKey), 'toString')
  assert.equal(new Function('RULE_LABELS', 'r', 'hasOwnKey', `return ${currentExpressions.ruleLabel}`)(ruleLabels, { rule_key: '__proto__' }, currentHasOwnKey), '__proto__')
})
