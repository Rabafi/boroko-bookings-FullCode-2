import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { TrainingSupervisor, trainingWorkspace } from '../../src/main/bar-local/training.ts'
import { BarLocalElectronRuntime } from '../../src/main/bar-local/electronRuntime.js'

// Explicit opt-in: never let default test discovery start a database.
test('real practice cluster provisions, trades, restarts and resets without accessing the live profile', {
  skip: process.env.BAR_LOCAL_TRAINING_INTEGRATION !== '1', timeout: 360000
}, async t => {
  const fixture = mkdtempSync(path.join(tmpdir(), 'bar-training-owned-'))
  const workspace = trainingWorkspace(fixture)
  const secure = { isEncryptionAvailable: () => true, encryptString: value => Buffer.from(value), decryptString: value => value.toString() }
  const options = { userDataPath: workspace, payloadDir: path.resolve('build/bar-local-server'), safeStorage: secure }
  let supervisor = new TrainingSupervisor(options)
  let runtime = new BarLocalElectronRuntime({ userDataPath: workspace, safeStorage: secure, buildProductId: 'hospitality-pos' })
  runtime.training = true
  t.after(async () => {
    runtime.close()
    await supervisor.stop()
    if (existsSync(path.join(workspace, 'practice-server', 'pg-data', 'postmaster.pid'))) throw new Error(`Practice fixture still active; preserved at ${fixture}`)
    rmSync(fixture, { recursive: true, force: true })
  })
  await supervisor.start(runtime, '456789')
  const ownerId = runtime.status().setup_owner_staff_id
  assert.ok(ownerId)
  assert.equal(runtime.status().authority_mode, 'bar_local')
  // The real application relaunches after the protected profile is committed.
  runtime.close()
  await supervisor.stop()
  supervisor = new TrainingSupervisor(options)
  runtime = new BarLocalElectronRuntime({ userDataPath: workspace, safeStorage: secure, buildProductId: 'hospitality-pos' })
  runtime.training = true
  runtime.trainingSupervisor = supervisor
  await supervisor.start(runtime)
  await runtime.login({ staff_id: ownerId, pin: '456789' })
  const catalogue = await runtime.query('menu.list', {})
  assert.equal(catalogue.data.filter(row => row.sku.startsWith('PRACTICE-')).length, 2)
  // Retrieve URL only from the OS-protected test authority record, never a live profile.
  const { readFileSync } = await import('node:fs')
  const authority = JSON.parse(secure.decryptString(readFileSync(path.join(workspace, 'bar-local', 'authority.bin'))))
  const blocked = await fetch(`${authority.local_service?.base_url ?? authority.base_url}/v1/admin/cloud-sync`, { signal: AbortSignal.timeout(5000) })
  assert.equal(blocked.status, 403)
  assert.equal((await blocked.json()).code, 'TRAINING_ISOLATION')
  assert.equal(existsSync(path.join(fixture, 'bar-local')), false)
  assert.throws(() => runtime.assertTrainingEndpoint('http://127.0.0.1:8787'), /does not belong/)
  const result = await supervisor.reset('RESET_TRAINING', () => runtime.close())
  assert.equal(result.live_data_changed, false)
  assert.equal(existsSync(path.join(workspace, 'bar-local')), false)
})
