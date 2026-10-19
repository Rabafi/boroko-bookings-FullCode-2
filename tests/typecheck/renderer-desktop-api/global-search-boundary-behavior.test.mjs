import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const currentPath = path.join(root, 'src/renderer/src/components/GlobalSearch.jsx')
const baselinePath = path.join(root, 'docs/engineering/typescript-migration/evidence/workerA-GlobalSearch-before-unknown-rpc-boundary-2026-10-15.jsx.txt')

function readExpressions(sourcePath) {
  const sourceText = fs.readFileSync(sourcePath, 'utf8')
  const source = ts.createSourceFile(sourcePath, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.JSX)
  let resultExpression
  let groupExpression
  let errorExpression
  let errorViewInitializer
  let responseViewInitializer
  let titleExpression
  let subtitleExpression
  const mapInitializers = {}
  const mapLookups = {}
  function visit(node) {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'setResults') {
      const arg = node.arguments[0]
      if (arg && arg.getText(source).includes('?.results')) resultExpression = arg.getText(source)
    }
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === 'grouped' && node.initializer) {
      groupExpression = node.initializer.getText(source)
    }
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === 'responseView' && node.initializer) {
      responseViewInitializer = node.initializer.getText(source)
    }
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && ['TYPE_ICONS', 'TYPE_COLORS', 'TYPE_NAV_MAP'].includes(node.name.text) && node.initializer) {
      mapInitializers[node.name.text] = node.initializer.getText(source)
    }
    if (ts.isElementAccessExpression(node)) {
      let target = node.expression
      while (ts.isParenthesizedExpression(target)) target = target.expression
      if (ts.isIdentifier(target) && ['TYPE_ICONS', 'TYPE_COLORS', 'TYPE_NAV_MAP'].includes(target.text)) {
        mapLookups[target.text] = node.getText(source)
      }
    }
    if (ts.isCatchClause(node)) {
      function findCatchExpressions(child) {
        if (ts.isCallExpression(child) && ts.isIdentifier(child.expression) && child.expression.text === 'setError') {
          errorExpression = child.arguments[0]?.getText(source)
        }
        if (ts.isVariableDeclaration(child) && ts.isIdentifier(child.name) && child.name.text === 'errorView') {
          errorViewInitializer = child.initializer?.getText(source)
        }
        ts.forEachChild(child, findCatchExpressions)
      }
      findCatchExpressions(node.block)
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  titleExpression = sourceText.match(/\{(item\.title)\}/)?.[1]
  subtitleExpression = sourceText.match(/\{(item\.subtitle)\}/)?.[1]
  assert.ok(resultExpression, `setResults result expression found in ${sourcePath}`)
  assert.ok(groupExpression, `grouped reducer found in ${sourcePath}`)
  assert.ok(errorExpression, `catch setError expression found in ${sourcePath}`)
  return { resultExpression, groupExpression, errorExpression, errorViewInitializer, responseViewInitializer, titleExpression, subtitleExpression, mapInitializers, mapLookups }
}

function compileFunction(param, expression) {
  const jsSource = ts.transpile(`function evaluate(${param}) { return ${expression}; }`, { target: ts.ScriptTarget.ES2022, allowJs: true })
  const context = vm.createContext({})
  vm.runInContext(jsSource, context)
  return context.evaluate
}

function compileResultFunction(parsed) {
  const declaration = parsed.responseViewInitializer ? `const responseView = ${parsed.responseViewInitializer};` : ''
  const jsSource = ts.transpile(`function evaluate(res) { ${declaration} return ${parsed.resultExpression}; }`, { target: ts.ScriptTarget.ES2022, allowJs: true })
  const context = vm.createContext({})
  vm.runInContext(jsSource, context)
  return context.evaluate
}

function compileCatchFunction(parsed) {
  const declaration = parsed.errorViewInitializer ? `const errorView = ${parsed.errorViewInitializer};` : ''
  const jsSource = ts.transpile(`function evaluate(e) { ${declaration} return ${parsed.errorExpression}; }`, { target: ts.ScriptTarget.ES2022, allowJs: true })
  const context = vm.createContext({})
  vm.runInContext(jsSource, context)
  return context.evaluate
}

function compileTypeMapLookup(parsed, mapName) {
  const declaration = parsed.mapInitializers[mapName]
  const expression = parsed.mapLookups[mapName]
  assert.ok(declaration, `${mapName} initializer found in source`)
  assert.ok(expression, `${mapName} lookup found in source`)
  const jsSource = ts.transpile(`const ${mapName} = ${declaration}; function evaluate(type, item) { return { value: ${expression}, map: ${mapName} }; }`, { target: ts.ScriptTarget.ES2022, allowJs: true })
  const context = vm.createContext({
    Building2: function Building2() {},
    Home: function Home() {},
    Receipt: function Receipt() {},
    LifeBuoy: function LifeBuoy() {},
    Users: function Users() {},
    Server: function Server() {},
    Search: function Search() {},
  })
  vm.runInContext(jsSource, context)
  return context.evaluate
}

function outcome(run, input) {
  try { return { value: run(input) } }
  catch (error) { return { error: { name: error?.name, message: error?.message } } }
}

const baseline = readExpressions(baselinePath)
const current = readExpressions(currentPath)
const baselineResults = compileResultFunction(baseline)
const currentResults = compileResultFunction(current)
const baselineGroups = compileFunction('results', baseline.groupExpression)
const currentGroups = compileFunction('results', current.groupExpression)
const baselineCatch = compileCatchFunction(baseline)
const currentCatch = compileCatchFunction(current)

test('GlobalSearch result boundary and grouping retain baseline behavior for valid and malformed values', () => {
  const sqlRows = [
    { type: 'lodge', id: 'lodge-1', title: 'Metsi Lodge', subtitle: null, icon: 'Home', payload: { raw: true } },
    { type: 'ticket', id: 'ticket-1', title: 'Late check-in', subtitle: 'high — open', icon: 'LifeBuoy' },
  ]
  const inputs = [null, undefined, {}, { results: null }, { results: 0 }, { results: false }, { results: '' },
    { results: sqlRows }, { results: 'truthy but not an array' }, { results: { length: 1 } }]
  for (const input of inputs) {
    const before = outcome(baselineResults, input)
    const after = outcome(currentResults, input)
    assert.deepEqual(after.error, before.error)
    if ('value' in before) {
      if (Array.isArray(before.value)) assert.deepEqual(Array.from(after.value), Array.from(before.value))
      else assert.equal(after.value, before.value)
    }
  }
  assert.equal(currentResults({ results: sqlRows }), sqlRows)
  assert.equal(currentResults(null).length, 0)
  assert.deepEqual(Array.from(currentGroups(sqlRows).lodge), [sqlRows[0]])
  assert.deepEqual(Array.from(currentGroups(sqlRows).ticket), [sqlRows[1]])

  const rowCases = [[], [7], [{ type: 'lodge' }], [null], [{ type: '__proto__', title: 'prototype key', subtitle: null }]]
  for (const rows of rowCases) {
    const before = outcome(baselineGroups, rows)
    const after = outcome(currentGroups, rows)
    assert.deepEqual(after.error, before.error)
    if ('value' in before) assert.deepEqual(Object.keys(after.value), Object.keys(before.value))
  }
})

test('GlobalSearch catch preserves the original optional message read and fallback behavior', () => {
  const cases = [new Error('search unavailable'), { message: 'serialized failure' }, { message: 7 }, 'failure', null, undefined]
  for (const value of cases) assert.deepEqual(outcome(currentCatch, value), outcome(baselineCatch, value))
})

test('GlobalSearch leaves SQL row fields unknown and passes malformed title/subtitle values through', () => {
  assert.equal(current.titleExpression, baseline.titleExpression)
  assert.equal(current.subtitleExpression, baseline.subtitleExpression)
  const title = { raw: 'title' }
  const subtitle = 23
  const beforeTitle = compileFunction('item', baseline.titleExpression)
  const currentTitle = compileFunction('item', current.titleExpression)
  const beforeSubtitle = compileFunction('item', baseline.subtitleExpression)
  const currentSubtitle = compileFunction('item', current.subtitleExpression)
  assert.equal(currentTitle({ title }), beforeTitle({ title }))
  assert.equal(currentSubtitle({ subtitle }), beforeSubtitle({ subtitle }))
  assert.equal(currentTitle({ title }), title)
  assert.equal(currentSubtitle({ subtitle }), 23)
})

test('GlobalSearch type maps preserve ordinary-object inherited-key lookups', () => {
  for (const mapName of ['TYPE_ICONS', 'TYPE_COLORS', 'TYPE_NAV_MAP']) {
    const beforeLookup = compileTypeMapLookup(baseline, mapName)
    const currentLookup = compileTypeMapLookup(current, mapName)
    for (const type of ['toString', '__proto__']) {
      const item = { type }
      const before = outcome(() => beforeLookup(type, item))
      const after = outcome(() => currentLookup(type, item))
      assert.deepEqual(after.error, before.error, `${mapName}[${type}] error`)
      if ('value' in before) {
        assert.equal(typeof after.value.value, typeof before.value.value, `${mapName}[${type}] result type`)
        assert.equal(after.value.value == null, before.value.value == null, `${mapName}[${type}] nullish result`)
        if (type === 'toString') {
          assert.equal(before.value.value, before.value.map.toString, `${mapName} baseline inherited toString`)
          assert.equal(after.value.value, after.value.map.toString, `${mapName} current inherited toString`)
        } else {
          assert.equal(before.value.value, Object.getPrototypeOf(before.value.map), `${mapName} baseline inherited prototype`)
          assert.equal(after.value.value, Object.getPrototypeOf(after.value.map), `${mapName} current inherited prototype`)
        }
      }
    }
  }
})
