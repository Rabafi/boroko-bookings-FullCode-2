import assert from 'node:assert/strict'
import fs from 'node:fs'
import Module from 'node:module'
import path from 'node:path'
import test from 'node:test'
import ts from 'typescript'

const root = process.cwd()
const sourcePath = path.join(root, 'src/renderer/src/components/shared/UsageUpgradePrompt.jsx')
const beforePath = path.join(root, 'docs/engineering/typescript-migration/evidence/workerA-UsageUpgradePrompt-before-typing-2026-10-15.jsx.txt')

function icon(name) {
  const component = () => null
  component.displayName = name
  return component
}

const iconExports = Object.fromEntries(['Lock', 'Mail', 'MessageCircle', 'Sparkles', 'TrendingUp'].map((name) => [name, icon(name)]))
const jsxRuntime = {
  Fragment: Symbol.for('react.fragment'),
  jsx: (type, props, key) => ({ type, props, key }),
  jsxs: (type, props, key) => ({ type, props, key })
}

function importComponent(sourceText) {
  const emitted = ts.transpileModule(sourceText, {
    fileName: 'UsageUpgradePrompt.jsx',
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX,
      allowJs: true,
      removeComments: true
    }
  }).outputText
  const compiled = new Module(sourcePath)
  compiled.filename = sourcePath
  compiled.paths = Module._nodeModulePaths(path.dirname(sourcePath))
  const actualRequire = Module.createRequire(sourcePath)
  compiled.require = (specifier) => {
    if (specifier === 'react/jsx-runtime') return jsxRuntime
    if (specifier === 'react') return { useEffect() {}, useMemo: (fn) => fn(), useState: (value) => [value, () => {}] }
    if (specifier === 'lucide-react') return iconExports
    if (specifier === './Modal') return { Modal: icon('Modal') }
    return actualRequire(specifier)
  }
  compiled._compile(emitted, sourcePath)
  return compiled.exports
}

function describe(value) {
  if (typeof value === 'function') return { function: value.displayName || value.name, source: value.toString() }
  if (typeof value === 'symbol') return { symbol: Symbol.keyFor(value) || value.description }
  if (Array.isArray(value)) return value.map(describe)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, describe(value[key])]))
  }
  return value
}

test('actual imported component exports and rendered trees match the preimage', () => {
  const baseline = importComponent(fs.readFileSync(beforePath, 'utf8'))
  const current = importComponent(fs.readFileSync(sourcePath, 'utf8'))
  assert.deepEqual(Object.keys(current).sort(), Object.keys(baseline).sort())
  assert.equal(current.default.name, baseline.default.name)

  const cases = [
    {},
    { open: false },
    { open: true },
    { open: true, currentPlan: 'Standard', used: 8, limit: 10, grace: 2, status: { isBlocked: false, isInGrace: true, remainingGrace: 2 } },
    { open: true, currentPlan: 'Pro', used: 20, limit: 10, status: { isBlocked: true, isInGrace: false, remainingGrace: 0 }, message: 'At limit' },
    { open: true, currentPlan: 'Enterprise', usage: { bookings: 10, rooms: 3, users: 4 }, recommendation: { recommendedPlan: 'Enterprise', reason: 'review' } }
  ]
  for (const props of cases) {
    assert.deepEqual(describe(current.default(props)), describe(baseline.default(props)))
  }
})
