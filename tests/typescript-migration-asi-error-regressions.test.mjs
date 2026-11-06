import assert from 'node:assert/strict'
import { rmSync } from 'node:fs'
import test from 'node:test'

import { importDomain, importState, makeTempCacheDir } from './helpers/domain-test-setup.mjs'

const { state } = await importState()
const { getAllTemplates, getAllTriggers } = await importDomain('guestMessaging.js')
const { createStaffDepartment } = await importDomain('staffOperations.js')
const { writeCache } = await importDomain('cacheStore.js')

const initialState = {
  cacheDir: state.cacheDir,
  isOnline: state.isOnline,
  lodgeId: state.lodgeId,
  supabase: state.supabase
}

test('staff offline errors retain the onlineOnly marker', async () => {
  state.isOnline = false

  await assert.rejects(
    createStaffDepartment('Housekeeping', null, null),
    (error) => error instanceof Error && error.message === 'Staff operations require an internet connection' && error.onlineOnly === true
  )
})

test('guest template and trigger cache fallbacks retain STALE_CACHE errors', async (t) => {
  const cacheDir = makeTempCacheDir('hospitality-asi-regression')
  t.after(() => {
    state.cacheDir = initialState.cacheDir
    state.isOnline = initialState.isOnline
    state.lodgeId = initialState.lodgeId
    state.supabase = initialState.supabase
    rmSync(cacheDir, { recursive: true, force: true })
  })

  state.cacheDir = cacheDir
  state.lodgeId = 'migration-regression-lodge'
  state.supabase = {
    rpc: async () => ({ data: null, error: new Error('offline') })
  }
  writeCache('guest-message-templates', [{ id: 'cached-template' }])
  writeCache('guest-message-triggers', [{ id: 'cached-trigger' }])

  await assert.rejects(
    getAllTemplates(),
    (error) => error instanceof Error && error.message === 'offline' && error.code === 'STALE_CACHE' && Array.isArray(error.cached)
  )
  await assert.rejects(
    getAllTriggers(),
    (error) => error instanceof Error && error.message === 'offline' && error.code === 'STALE_CACHE' && Array.isArray(error.cached)
  )
})
