import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { startRecoveryJob, recoveryJobStatus, drainRecoveryJobs } from '../dist/operations/recoveryJobs.js'
import { repairRecoveryLock } from '../dist/operations/recovery.js'

test('recovery jobs persist failure and matching replay while refusing changed request reuse', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'bar-recovery-jobs-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const config = { training: { instanceId: randomUUID() }, backup: { dir: root } }
  const request = { id: randomUUID(), kind: 'base', reason: 'A synthetic isolated request' }
  assert.equal(await recoveryJobStatus(config, request.id), null)
  await startRecoveryJob(config, request)
  await drainRecoveryJobs()
  const first = await recoveryJobStatus(config, request.id)
  assert.equal(first.state, 'failed')
  assert.match(first.error, /Practice mode/)
  const second = await startRecoveryJob(config, request)
  assert.deepEqual(second, first)
  await assert.rejects(startRecoveryJob(config, { ...request, reason: 'A different recovery request' }), /different action/)
  const rootPath = path.join(root, 'physical-recovery')
  await writeFile(path.join(rootPath, 'recovery.lock'), JSON.stringify({ pid: process.pid, started_at: new Date().toISOString() }))
  await assert.rejects(repairRecoveryLock(config), /still present/)
  const interrupted = { ...first, id: randomUUID(), instance: 'a previous service process', state: 'running' }
  await writeFile(path.join(rootPath, 'jobs', `${interrupted.id}.json`), JSON.stringify(interrupted))
  assert.equal((await recoveryJobStatus(config, interrupted.id)).state, 'interrupted')
})
