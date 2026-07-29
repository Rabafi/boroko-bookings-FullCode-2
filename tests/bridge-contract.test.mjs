import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'fs'
import { resolve } from 'path'

const ROOT = resolve(import.meta.dirname, '..')
const PRELOAD_PATH = resolve(ROOT, 'src/preload/index.js')
const INDEX_PATH = resolve(ROOT, 'src/main/index.js')

const PRELOAD = readFileSync(PRELOAD_PATH, 'utf8')
const INDEX = readFileSync(INDEX_PATH, 'utf8')

/**
 * Extract bridge function entries for a given namespace from the preload.
 * Returns an array of { name, channel, params } objects.
 */
function extractPreloadBridge(namespace) {
  // Match: functionName:  (param1, param2)  => ipcRenderer.invoke('namespace:channel', arg1, arg2)
  const blockMatch = PRELOAD.match(
    new RegExp(
      `${namespace}:\\s*\\{([\\s\\S]*?)\\}`,
      'm'
    )
  )
  if (!blockMatch) throw new Error(`Could not find ${namespace} block in preload`)

  const block = blockMatch[1]
  const functions = []
  // Match each bridge function entry
  // Pattern: functionName:\s*(paramList)\s*=>\s*ipcRenderer\.invoke\('namespace:channel', args\)
  const funcRegex = new RegExp(
    `(\\w+):\\s*\\(([^)]*)\\)\\s*=>\\s*ipcRenderer\\.invoke\\('(${namespace}:[^']+)'`,
    'g'
  )
  let match
  while ((match = funcRegex.exec(block)) !== null) {
    const name = match[1]
    const channel = match[3]
    const params = match[2].trim()
    const paramCount = params === '' ? 0 : params.split(',').length
    functions.push({ name, channel, paramCount, rawParams: params })
  }
  return functions
}

/**
 * Extract IPC handler registrations matching a channel prefix from index.js.
 * Returns an array of { channel, paramCount } objects.
 */
function extractIpcHandlers(channelPrefix) {
  // Match: ipcMain.handle('channelPrefix:X', async (_, param1, param2) => {
  const handlerRegex = new RegExp(
    `ipcMain\\.handle\\('(${channelPrefix.replace(/:/g, '\\:')}:[^']+)'\\s*,\\s*async\\s*\\(([^)]*)\\)`,
    'g'
  )
  const handlers = []
  let match
  while ((match = handlerRegex.exec(INDEX)) !== null) {
    const channel = match[1]
    const params = match[2].trim()
    // First param is usually `_` (the event), count remaining as real params
    const allParams = params === '' ? [] : params.split(',').map(p => p.trim())
    const realParams = allParams.filter(p => p !== '_' && p !== '' && !p.startsWith('{'))
    const paramCount = realParams.length
    handlers.push({ channel, paramCount, totalParams: allParams.length })
  }
  return handlers
}

describe('bridge contract: staffOperations', () => {
  const bridges = extractPreloadBridge('staffOperations')
  const handlers = extractIpcHandlers('staffOperations')

  it(`has ${bridges.length} bridge functions in preload`, () => {
    assert.ok(bridges.length >= 19, `expected at least 19 staffOperations bridges, got ${bridges.length}`)
  })

  it(`has ${handlers.length} IPC handlers in index.js`, () => {
    assert.ok(handlers.length >= 19, `expected at least 19 staffOperations handlers, got ${handlers.length}`)
  })

  for (const bridge of bridges) {
    it(`bridge ${bridge.name} → ${bridge.channel} (${bridge.paramCount} params) has matching handler`, () => {
      const handler = handlers.find(h => h.channel === bridge.channel)
      assert.ok(handler, `no IPC handler for channel ${bridge.channel}`)

      // Handler param count should be >= bridge param count
      // (handlers often have additional params like destructured objects)
      assert.ok(
        handler.paramCount >= bridge.paramCount,
        `param count mismatch: bridge ${bridge.name} has ${bridge.paramCount} params but handler for ${bridge.channel} has ${handler.paramCount} real params`
      )
    })
  }

  it('every IPC handler has a matching bridge function', () => {
    const bridgeChannels = new Set(bridges.map(b => b.channel))
    const missing = handlers.filter(h => !bridgeChannels.has(h.channel))
    assert.equal(
      missing.length, 0,
      `IPC handlers without matching bridge: ${missing.map(m => m.channel).join(', ')}`
    )
  })
})

describe('bridge contract: assetManagement', () => {
  const bridges = extractPreloadBridge('assetManagement')
  const handlers = extractIpcHandlers('assetManagement')

  it(`has ${bridges.length} bridge functions in preload`, () => {
    assert.ok(bridges.length >= 17, `expected at least 17 assetManagement bridges, got ${bridges.length}`)
  })

  it(`has ${handlers.length} IPC handlers in index.js`, () => {
    assert.ok(handlers.length >= 17, `expected at least 17 assetManagement handlers, got ${handlers.length}`)
  })

  for (const bridge of bridges) {
    it(`bridge ${bridge.name} → ${bridge.channel} (${bridge.paramCount} params) has matching handler`, () => {
      const handler = handlers.find(h => h.channel === bridge.channel)
      assert.ok(handler, `no IPC handler for channel ${bridge.channel}`)

      assert.ok(
        handler.paramCount >= bridge.paramCount,
        `param count mismatch: bridge ${bridge.name} has ${bridge.paramCount} params but handler for ${bridge.channel} has ${handler.paramCount} real params`
      )
    })
  }

  it('every IPC handler has a matching bridge function', () => {
    const bridgeChannels = new Set(bridges.map(b => b.channel))
    const missing = handlers.filter(h => !bridgeChannels.has(h.channel))
    assert.equal(
      missing.length, 0,
      `IPC handlers without matching bridge: ${missing.map(m => m.channel).join(', ')}`
    )
  })
})

describe('bridge contract: venueManagement', () => {
  const bridges = extractPreloadBridge('venueManagement')
  const handlers = extractIpcHandlers('venueManagement')

  it(`has ${bridges.length} bridge functions in preload`, () => {
    assert.ok(bridges.length >= 17, `expected at least 17 venueManagement bridges, got ${bridges.length}`)
  })

  it(`has ${handlers.length} IPC handlers in index.js`, () => {
    assert.ok(handlers.length >= 17, `expected at least 17 venueManagement handlers, got ${handlers.length}`)
  })

  for (const bridge of bridges) {
    it(`bridge ${bridge.name} → ${bridge.channel} (${bridge.paramCount} params) has matching handler`, () => {
      const handler = handlers.find(h => h.channel === bridge.channel)
      assert.ok(handler, `no IPC handler for channel ${bridge.channel}`)

      assert.ok(
        handler.paramCount >= bridge.paramCount,
        `param count mismatch: bridge ${bridge.name} has ${bridge.paramCount} params but handler for ${bridge.channel} has ${handler.paramCount} real params`
      )
    })
  }

  it('every IPC handler has a matching bridge function', () => {
    const bridgeChannels = new Set(bridges.map(b => b.channel))
    const missing = handlers.filter(h => !bridgeChannels.has(h.channel))
    assert.equal(
      missing.length, 0,
      `IPC handlers without matching bridge: ${missing.map(m => m.channel).join(', ')}`
    )
  })

  it('bridge function names match IPC handler parameter expectations', () => {
    const checks = [
      { name: 'settleEvent', channel: 'venueManagement:settleEvent', expectedParams: 6 },
      { name: 'markMilestonePaid', channel: 'venueManagement:markMilestonePaid', expectedParams: 4 },
      { name: 'updateSupplierStatus', channel: 'venueManagement:updateSupplierStatus', expectedParams: 3 },
      { name: 'getVenueAvailabilityCalendar', channel: 'venueManagement:getVenueAvailabilityCalendar', expectedParams: 3 }
    ]
    for (const check of checks) {
      const bridge = bridges.find(b => b.name === check.name)
      assert.ok(bridge, `bridge ${check.name} not found`)
      const handler = handlers.find(h => h.channel === check.channel)
      assert.ok(handler, `handler ${check.channel} not found`)
      assert.equal(
        bridge.paramCount, check.expectedParams,
        `bridge ${check.name} expected ${check.expectedParams} params, got ${bridge.paramCount}`
      )
      assert.ok(
        handler.paramCount >= check.expectedParams,
        `handler ${check.channel} expected >= ${check.expectedParams} params, got ${handler.paramCount}`
      )
    }
  })
})
