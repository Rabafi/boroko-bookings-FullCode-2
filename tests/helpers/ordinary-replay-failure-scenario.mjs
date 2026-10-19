import fs from 'node:fs'
import { importDomain, importState, makeTempCacheDir, scriptSupabase } from './domain-test-setup.mjs'

const LODGE = '11111111-1111-4111-8111-111111111111'

export async function createOrdinaryReplayFailureSnapshot() {
  const infrastructure = await importDomain('infrastructure.js')
  const syncStore = await importDomain('syncStore.js')
  const syncDomain = await importDomain('sync.js')
  const statusDomain = await importDomain('syncStatus.js')
  const { BrowserWindow } = await import('electron')
  const previousGetAllWindows = BrowserWindow.getAllWindows
  const { state } = await importState()
  const cacheDir = makeTempCacheDir('bar-ordinary-replay-failure-guide')
  const keys = ['cacheDir', 'lodgeId', 'currentUser', 'supabase', 'isOnline', 'replayAuthReady', 'syncInProgress', 'syncQueuePromise']
  const previousState = Object.fromEntries(keys.map((key) => [key, state[key]]))
  const queueItem = {
    type: 'rpc',
    table: 'save_bar_product_with_stock',
    _queue_id: 'ordinary-bar-replay-failure-0001',
    _state: 'pending',
    data: {
      payload: {
        operation_key: 'bar-product-stable-intent-00000001',
        lodge_id: LODGE,
        product: { id: '22222222-2222-4222-8222-222222222222', name: 'Cola' }
      }
    }
  }

  try {
    BrowserWindow.getAllWindows = () => []
    Object.assign(state, {
      cacheDir,
      lodgeId: LODGE,
      currentUser: { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' },
      isOnline: true,
      replayAuthReady: true,
      syncInProgress: false,
      syncQueuePromise: null,
      supabase: scriptSupabase(async (name) => {
        assertOperation(name)
        state.isOnline = false
        return { data: { success: false, code: '23505', error: 'A product named Cola already exists. Review the existing product before retrying this save.' }, error: null }
      })
    })
    syncStore.writeSyncQueue([queueItem])
    await infrastructure.processSyncQueue()
    const details = syncDomain.getSyncDetails()
    const status = statusDomain.buildSyncStatusSnapshot()
    const clean = (row) => ({
      _queue_id: row._queue_id,
      table: row.table,
      type: row.type,
      isFinancial: row.isFinancial === true,
      manualRetryOnly: row.manualRetryOnly === true,
      displayError: row.displayError || row.lastError || '',
      dependencyLabel: row.dependencyLabel || undefined,
      data: { payload: { operation_key: row.data?.payload?.operation_key, product: row.data?.payload?.product } }
    })
    return JSON.parse(JSON.stringify({
      scenario: 'ordinary-replay-failure',
      generatedAt: new Date().toISOString(),
      syncStatus: { pending: status.pending, failed: status.failed, isOnline: status.isOnline },
      syncDetails: {
        pendingCount: details.pendingCount,
        failedCount: details.failedCount,
        pending: details.pending.map(clean),
        failed: details.failed.map(clean),
        faults: details.faults.map((fault) => ({ type: fault.type, severity: fault.severity, message: fault.message }))
      },
      quarantine: fs.existsSync(`${cacheDir}/sync-mesh-quarantine.json`)
        ? JSON.parse(fs.readFileSync(`${cacheDir}/sync-mesh-quarantine.json`, 'utf8')).length
        : 0
    }))
  } finally {
    Object.assign(state, previousState)
    if (previousGetAllWindows === undefined) delete BrowserWindow.getAllWindows
    else BrowserWindow.getAllWindows = previousGetAllWindows
    fs.rmSync(cacheDir, { recursive: true, force: true })
  }
}

function assertOperation(name) {
  if (name !== 'save_bar_product_with_stock') throw new Error(`Unexpected replay RPC: ${name}`)
}
