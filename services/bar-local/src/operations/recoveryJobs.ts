import { createHash, randomUUID } from 'node:crypto'
import { mkdir, open, readFile, rename } from 'node:fs/promises'
import path from 'node:path'
import type { ServiceConfig } from '../config.js'
import { createRecoveryBase, recoveryRoot, recoveryStatus, runPointInTimeDrill } from './recovery.js'
import { copyRecoverySet } from './recoveryCopy.js'
import { recoveryCopyDestination } from './recoveryDestination.js'

const instance = randomUUID()
const active = new Map<string, Promise<void>>()
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/
export type RecoveryJobRequest = { id: string; kind: 'base' | 'drill' | 'copy'; base_id?: string; target_time?: string; reason: string }
type Job = { id: string; kind: string; request_hash: string; instance: string; state: 'running' | 'complete' | 'failed' | 'interrupted'; started_at: string; completed_at?: string; result?: unknown; error?: string }

function location(config: ServiceConfig, id: string) {
  if (!UUID.test(id)) throw new Error('A stable recovery request UUID is required.')
  return path.join(recoveryRoot(config), 'jobs', `${id}.json`)
}
async function replace(file: string, job: Job) {
  const staging = `${file}.${randomUUID()}.tmp`
  const handle = await open(staging, 'wx', 0o600)
  try { await handle.writeFile(JSON.stringify(job)); await handle.sync() }
  finally { await handle.close() }
  await rename(staging, file)
}
export async function recoveryJobStatus(config: ServiceConfig, id: string): Promise<Job | null> {
  const file = location(config, id)
  let encoded: string
  try { encoded = await readFile(file, 'utf8') }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error }
  const record = JSON.parse(encoded) as Job
  if (record.id !== id || !['running', 'complete', 'failed', 'interrupted'].includes(record.state)) throw new Error('Saved recovery job is invalid; keep its evidence for repair.')
  if (record.state === 'running' && record.instance !== instance) return { ...record, state: 'interrupted', error: 'The service restarted before this recovery result was recorded. Inspect retained recovery evidence and repair any orphaned recovery lock before starting a new request.' }
  return record
}
/** A lost HTTP reply never creates a second backup/drill. Same ID + changed payload is refused. */
export async function startRecoveryJob(config: ServiceConfig, request: RecoveryJobRequest) {
  if (!['base', 'drill', 'copy'].includes(request.kind) || request.reason.trim().length < 8 || request.reason.length > 500) throw new Error('Choose a recovery action and a reason of8–500 characters.')
  if (request.kind === 'drill' && (!request.base_id || !UUID.test(request.base_id) || !request.target_time)) throw new Error('Choose a recovery package and an explicit target time.')
  const file = location(config, request.id)
  const requestHash = createHash('sha256').update(JSON.stringify([request.kind, request.base_id ?? null, request.target_time ?? null, request.reason])).digest('hex')
  await mkdir(path.dirname(file), { recursive: true })
  let handle
  try { handle = await open(file, 'wx', 0o600) }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    const existing = await recoveryJobStatus(config, request.id)
    if (!existing) throw new Error('The saved recovery job disappeared. Preserve recovery evidence before retrying.')
    if (existing.request_hash !== requestHash) throw new Error('This recovery request ID belongs to a different action. Keep the original request.')
    return existing
  }
  const job: Job = { id: request.id, kind: request.kind, request_hash: requestHash, instance, state: 'running', started_at: new Date().toISOString() }
  try { await handle.writeFile(JSON.stringify(job)); await handle.sync() }
  finally { await handle.close() }
  const work = (async () => {
    try {
      job.result = request.kind === 'base' ? await createRecoveryBase(config) : request.kind === 'copy' ? await copyRecoverySet(config) : await runPointInTimeDrill(config, request.base_id!, request.target_time!)
      if (request.kind === 'base' && await recoveryCopyDestination(config)) job.result = { ...job.result as Record<string, unknown>, secondary_copy: await copyRecoverySet(config) }
      job.state = 'complete'
    } catch (error) {
      job.state = 'failed'; job.error = error instanceof Error ? error.message : 'Recovery could not be verified.'
    }
    job.completed_at = new Date().toISOString()
    await replace(file, job)
  })().finally(() => active.delete(file))
  active.set(file, work)
  // Retain failure in the job record; do not turn a disconnected response into
  // a second operation or an unhandled worker rejection.
  void work.catch(() => {})
  return { ...job }
}
export async function drainRecoveryJobs() { await Promise.allSettled([...active.values()]) }

/** Daily encrypted base; WAL continues independently through PostgreSQL archiving. */
export function startRecoverySchedule(config: ServiceConfig, logger: { error?: (value: { event: string; message: string }) => void }) {
  if (!config.recovery?.enabled || config.training || config.replication.role === 'standby') return () => {}
  let checking = false
  let stopped = false
  const tick = async () => {
    if (checking || stopped || active.size) return
    checking = true
    try {
      const status = await recoveryStatus(config)
      if (!status.archive.enabled) return
      const last = status.packages.find(item => item.authenticated)
      if (last && Date.now() - Date.parse(last.created_at) < 86400000) return
      const today = new Date().toISOString().slice(0, 10)
      // Stable across service restarts; a failed daily job is visible rather than
      // endlessly generating new backup attempts and filling the disk.
      const hash = createHash('sha256').update(`recovery-base:${today}`).digest('hex')
      const id = `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`
      if (!stopped) await startRecoveryJob(config, { id, kind: 'base', reason: 'Scheduled daily encrypted physical recovery base' })
    } catch (error) { logger.error?.({ event: 'recovery.schedule.failed', message: error instanceof Error ? error.message : 'Recovery schedule unavailable' }) }
    finally { checking = false }
  }
  const timer = setInterval(() => void tick(), 60000)
  timer.unref()
  return () => { stopped = true; clearInterval(timer) }
}
