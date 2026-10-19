import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const require = createRequire(import.meta.url)
const esbuild = require('esbuild')
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const evidence = resolve(repoRoot, 'docs/engineering/typescript-migration/evidence')
const beforePath = resolve(evidence, 'L02-preimages-workerA-2026-10-14/GuestMessaging-before-raw-rpc-state-2026-10-15.jsx.txt')
const read = (path) => readFileSync(path, 'utf8')

function importComponent(source, payload) {
  const states = []
  const effects = []
  let hook = 0
  const react = {
    Fragment: Symbol.for('react.fragment'),
    useState(initial) {
      const index = hook++
      if (!(index in states)) states[index] = typeof initial === 'function' ? initial() : initial
      return [states[index], (value) => { states[index] = typeof value === 'function' ? value(states[index]) : value }]
    },
    useEffect(effect) { effects.push(effect) },
    useCallback(callback) { return callback }
  }
  const jsxRuntime = {
    jsx: (type, props, key) => ({ type, props: props || {}, key }),
    jsxs: (type, props, key) => ({ type, props: props || {}, key }),
    Fragment: react.Fragment
  }
  const icon = () => null
  const mockRequire = (specifier) => {
    if (specifier === 'react') return react
    if (specifier === 'react/jsx-runtime') return jsxRuntime
    if (specifier === 'lucide-react') return new Proxy({}, { get: () => icon })
    if (specifier === './shared/Modal') return { Modal: icon }
    if (specifier === './shared/ConfirmDialog') return { ConfirmDialog: icon }
    if (specifier === './shared/ErrorNotice') return { ErrorNotice: icon }
    return new Proxy({ default: icon }, { get: (target, key) => key in target ? target[key] : icon })
  }
  const code = esbuild.transformSync(source, { loader: 'jsx', format: 'cjs', jsx: 'automatic', target: 'es2022' }).code
  const module = { exports: {} }
  const api = { guestMessaging: {
    getTemplates: async () => payload.templates,
    getTriggers: async () => payload.triggers,
    getChannelReadiness: async () => payload.readiness,
    getDeliveryStatus: async () => payload.delivery
  } }
  new Function('require', 'module', 'exports', 'window', code)(mockRequire, module, module.exports, { api })
  return {
    states,
    render() { hook = 0; effects.length = 0; return module.exports.default() },
    async load() {
      for (const effect of effects) effect()
      await new Promise((resolve) => setTimeout(resolve, 5))
    },
    async openDeliveryTab() {
      const find = (node) => {
        if (!node || typeof node !== 'object') return null
        const props = node.props || {}
        if (node.type === 'button' && props.children === 'delivery') return props.onClick
        for (const child of Array.isArray(props.children) ? props.children : [props.children]) {
          const found = find(child)
          if (found) return found
        }
        return null
      }
      const onClick = find(this.render())
      assert.equal(typeof onClick, 'function')
      onClick()
      this.render()
      await this.load()
      let error = null
      try { this.render() } catch (caught) { error = [caught.name, caught.message] }
      return error
    }
  }
}

async function outcome(source, payload) {
  const runtime = importComponent(source, payload)
  runtime.render()
  await runtime.load()
  let error = null
  try { runtime.render() } catch (caught) { error = [caught.name, caught.message] }
  return { states: runtime.states, error }
}

test('actual GuestMessaging import preserves raw template and trigger row behavior', async () => {
  const before = read(beforePath)
  const current = read(resolve(repoRoot, 'src/renderer/src/components/GuestMessaging.jsx'))
  const validTemplate = { id: 'fictional-template-1', name: 'Example', template_key: 'example', channel: 'email', category: 'custom', variables: [] }
  const validTrigger = { id: 'fictional-trigger-1', trigger_event: 'booking_confirmed', template_id: validTemplate.id }
  const readiness = { email: { ready: false, status: 'not_configured', label: 'Example', message: 'Example' } }
  for (const payload of [
    { templates: [validTemplate], triggers: [validTrigger], delivery: [], readiness },
    { templates: [null], triggers: [], delivery: [null], readiness: 'raw-readiness' },
    { templates: { cached: [null] }, triggers: { cached: 'raw-cache' }, delivery: { malformed: true }, readiness },
    { templates: [], triggers: [], delivery: 'not-an-array', readiness }
  ]) {
    const oldResult = await outcome(before, payload)
    const newResult = await outcome(current, payload)
    assert.deepEqual(newResult.error, oldResult.error)
    assert.deepEqual(newResult.states, oldResult.states)
    assert.equal(newResult.states[0], oldResult.states[0])
    assert.equal(newResult.states[1], oldResult.states[1])
    assert.equal(newResult.states[22], payload.readiness)
    assert.equal(oldResult.states[22], payload.readiness)
    const expectedTemplates = Array.isArray(payload.templates) ? payload.templates : (payload.templates?.cached || [])
    const expectedTriggers = Array.isArray(payload.triggers) ? payload.triggers : (payload.triggers?.cached || [])
    assert.equal(newResult.states[0], expectedTemplates)
    assert.equal(newResult.states[1], expectedTriggers)
  }
  for (const delivery of [[{ id: 'fictional-message-1', status: 'queued' }], [null], 'not-an-array']) {
    const payload = { templates: [], triggers: [], delivery, readiness: 'raw-readiness' }
    const oldRuntime = importComponent(before, payload)
    const newRuntime = importComponent(current, payload)
    oldRuntime.render()
    newRuntime.render()
    await oldRuntime.load()
    await newRuntime.load()
    const oldError = await oldRuntime.openDeliveryTab()
    const newError = await newRuntime.openDeliveryTab()
    assert.deepEqual(newError, oldError)
    assert.deepEqual(newRuntime.states[19], oldRuntime.states[19])
    assert.equal(newRuntime.states[22], payload.readiness)
    assert.equal(oldRuntime.states[22], payload.readiness)
    if (Array.isArray(delivery)) {
      assert.equal(newRuntime.states[19], delivery)
      assert.equal(oldRuntime.states[19], delivery)
    } else {
      assert.deepEqual(newRuntime.states[19], [])
      assert.deepEqual(oldRuntime.states[19], [])
    }
  }
  assert.match(current, /@type \{unknown\} \*\/ \(\[\]\)/)
  assert.match(current, /@type \{unknown\} \*\/ \(null\)/)
})
