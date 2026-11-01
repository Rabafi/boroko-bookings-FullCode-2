import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { TrainingSupervisor, trainingEnvironment, trainingWorkspace } from '../../src/main/bar-local/training.ts'

const secure = { isEncryptionAvailable: () => true, encryptString: value => Buffer.from(value), decryptString: value => value.toString() }
test('practice profile and inherited environment cannot select live DB, cloud, provider or test targets', () => {
  const workspace = trainingWorkspace(path.join(tmpdir(), 'live-owner'))
  assert.equal(path.basename(path.dirname(workspace)), 'bar-training')
  const state = { version: 1, id: randomUUID(), dbPort: 55001, httpPort: 55002, password: 'a'.repeat(64), runtimePassword: 'b'.repeat(64), setupSecret: 'c'.repeat(64), backupKey: 'd'.repeat(64) }
  const env = trainingEnvironment({ DATABASE_URL: 'https://live', SUPABASE_SERVICE_ROLE_KEY: 'live-secret', PGHOST: 'live', BAR_LOCAL_DB_NAME: 'bar_local_live', BAR_LOCAL_CLOUD_SYNC_TRANSPORT: 'approved', BAR_LOCAL_FAILOVER_KEY: 'live', ELECTRON_RUN_AS_NODE: '1', PATH: 'safe' }, workspace, state, '/packaged/pg')
  assert.equal(env.DATABASE_URL, undefined)
  assert.equal(env.SUPABASE_SERVICE_ROLE_KEY, undefined)
  assert.equal(env.PGHOST, undefined)
  assert.equal(env.BAR_LOCAL_FAILOVER_KEY, undefined)
  assert.equal(env.ELECTRON_RUN_AS_NODE, undefined)
  assert.equal(env.BAR_LOCAL_DB_NAME, 'bar_local_training')
  assert.equal(env.BAR_LOCAL_HTTP_HOST, '127.0.0.1')
  assert.equal(env.BAR_LOCAL_CLOUD_SYNC_TRANSPORT, 'disabled')
  assert.equal(env.BAR_LOCAL_UPDATE_APPLY_ENABLED, 'false')
  assert.equal(env.BAR_LOCAL_PG_DATA_DIR.startsWith(workspace), true)
  assert.equal(env.PATH, 'safe')
})
test('practice supervisor refuses live profile roots and wrong reset confirmation', async t => {
  const root = mkdtempSync(path.join(tmpdir(), 'bar-training-unit-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  assert.throws(() => new TrainingSupervisor({ userDataPath: root, payloadDir: root, safeStorage: secure }), /live profile/)
  const workspace = trainingWorkspace(root)
  const live = path.join(root, 'bar-local')
  mkdirSync(live); writeFileSync(path.join(live, 'live-evidence'), 'keep')
  const supervisor = new TrainingSupervisor({ userDataPath: workspace, payloadDir: root, safeStorage: secure })
  await assert.rejects(supervisor.reset('RESET_LIVE', () => {}), /RESET_TRAINING/)
  assert.equal(existsSync(path.join(live, 'live-evidence')), true)
})
test('practice reset archives only practice files and leaves the live profile untouched', async t => {
  const root = mkdtempSync(path.join(tmpdir(), 'bar-training-reset-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const workspace = trainingWorkspace(root)
  mkdirSync(path.join(root, 'bar-local'), { recursive: true })
  writeFileSync(path.join(root, 'bar-local', 'live-evidence'), 'keep')
  mkdirSync(path.join(workspace, 'bar-local'), { recursive: true })
  mkdirSync(path.join(workspace, 'practice-server'), { recursive: true })
  const supervisor = new TrainingSupervisor({ userDataPath: workspace, payloadDir: root, safeStorage: secure })
  let closed = false
  const result = await supervisor.reset('RESET_TRAINING', () => { closed = true })
  assert.equal(result.live_data_changed, false)
  assert.equal(closed, true)
  assert.equal(existsSync(path.join(root, 'bar-local', 'live-evidence')), true)
  assert.equal(existsSync(path.join(workspace, 'bar-local')), false)
})
