import { useEffect, useState } from 'react'

type Data = Record<string, unknown>
function record(value: unknown): Data { return value && typeof value === 'object' && !Array.isArray(value) ? value as Data : {} }
function unwrap(value: unknown, key: string): Data { const data = record(value); return record(data[key] ?? record(data.data)[key]) }
const savedJobPrefix = 'bar-local-recovery-job'

/** Owner-only controls; service independently enforces backup capability and loopback mutations. */
export default function BarRecoveryPanel({ blocked }: { blocked: boolean }) {
  const [status, setStatus] = useState<Data>({})
  const [job, setJob] = useState<Data>({})
  const [reason, setReason] = useState('')
  const [base, setBase] = useState('')
  const [target, setTarget] = useState('')
  const [passphrase, setPassphrase] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [savedJob, setSavedJob] = useState('')
  const [pending, setPending] = useState(false)
  const refresh = async () => setStatus(unwrap(await window.api.barLocal.adminRecoveryStatus(), 'recovery'))
  useEffect(() => {
    void (async () => {
      const profile = record(await window.api.barLocal.getStatus())
      const authority = record(record(profile.adapter).authority)
      const staff = record(record(profile.session).staff)
      const staffId = staff.staff_id ?? staff.id
      if (!authority.authority_id || !staffId) throw new Error('Sign in to the local Bar before managing recovery.')
      setSavedJob(`${savedJobPrefix}:${String(authority.authority_id)}:${String(authority.authority_epoch)}:${String(staffId)}`)
      await refresh()
    })().catch(e => setError(String(e.message ?? e)))
  }, [])
  useEffect(() => {
    let stopped = false
    const poll = async () => {
      if (!savedJob) return
      const encoded = localStorage.getItem(savedJob)
      if (!encoded) return
      try {
        const saved = record(JSON.parse(encoded))
        const request = record(saved.request)
        setPending(true)
        const result = unwrap(await window.api.barLocal.adminRecoveryJob(String(request.request_id)), 'job')
        if (stopped) return
        setJob(result.state ? result : { state: 'awaiting dispatch — retry the saved request' })
        if (['complete', 'failed', 'interrupted'].includes(String(result.state))) { localStorage.removeItem(savedJob); setPending(false); await refresh() }
      } catch (e) { if (!stopped) setError(e instanceof Error ? e.message : 'Reconnect to retrieve the saved recovery result.') }
    }
    void poll()
    const timer = setInterval(() => void poll(), 3000)
    return () => { stopped = true; clearInterval(timer) }
  }, [savedJob])
  const sendSaved = async () => {
    const encoded = savedJob ? localStorage.getItem(savedJob) : null
    if (!encoded) throw new Error('No saved request is available.')
    const saved = record(JSON.parse(encoded)), request = record(saved.request)
    if (saved.kind !== 'base' && saved.kind !== 'drill' && saved.kind !== 'copy') throw new Error('The saved recovery request is invalid. Preserve it for support.')
    const result = saved.kind === 'base' ? await window.api.barLocal.adminCreateRecoveryBase(request) : saved.kind === 'copy' ? await window.api.barLocal.adminCopyRecoverySet(request) : await window.api.barLocal.adminVerifyRecoveryPoint(request)
    setJob(unwrap(result, 'result'))
  }
  const act = async (kind: 'base' | 'drill' | 'keys' | 'copy') => {
    setBusy(true); setError('')
    try {
      if (reason.trim().length < 8) throw new Error('Enter a reason of at least eight characters.')
      if (kind === 'keys') {
        const result = record(await window.api.barLocal.adminExportRecoveryKeys({ confirm: 'EXPORT_RECOVERY_KEYS', reason, passphrase }))
        setPassphrase(''); setJob({ state: result.cancelled ? 'cancelled' : 'keys saved', result })
      } else {
        if (!savedJob) throw new Error('Wait for the signed-in authority to load.')
        if (localStorage.getItem(savedJob)) throw new Error('Wait for the saved recovery job before starting another.')
        if (kind === 'drill' && (!base || !Number.isFinite(Date.parse(target)))) throw new Error('Choose a backup and a valid target time with timezone.')
        const request_id = crypto.randomUUID()
        const request = { request_id, reason, confirm: kind === 'base' ? 'CREATE_RECOVERY_BASE' : kind === 'copy' ? 'COPY_RECOVERY_SET' : 'VERIFY_RECOVERY_POINT', ...(kind === 'drill' ? { base_id: base, target_time: target } : {}) }
        localStorage.setItem(savedJob, JSON.stringify({ kind, request }))
        setPending(true)
        try {
          await sendSaved()
        } catch (e) {
          // Preserve the ID after uncertain replies; never silently create a new operation.
          throw e
        }
      }
    } catch (e) { setError(e instanceof Error ? e.message : 'Recovery request could not be completed.') }
    finally { setBusy(false) }
  }
  const packages = Array.isArray(status.packages) ? status.packages.map(record) : []
  return <section className="rounded-xl border border-slate-700 bg-slate-900 p-4 space-y-3">
    <h2 className="font-semibold">Encrypted recovery points</h2>
    <p className="text-sm text-slate-300">Create a full encrypted database backup, then verify a past time using archived changes. Verification uses a separate temporary database and never replaces the live Bar.</p>
    <p className="text-xs text-slate-400">Keep a separate drive copy and export the encrypted keys. A backup on this laptop alone cannot protect against losing the laptop. Recovery files are retained together; automatic deletion is disabled.</p>
    {error && <p role="alert" className="text-red-300">{error}</p>}
    {pending && <button disabled={blocked || busy || job.state === 'running'} className="border rounded px-3 py-2 disabled:opacity-50" onClick={() => { setBusy(true); void sendSaved().catch(e => setError(String(e.message ?? e))).finally(() => setBusy(false)) }}>Retry saved recovery request</button>}
    <p className="text-sm">WAL archiving: {record(status.archive).enabled === true ? 'enabled' : 'unavailable — repair server setup first'}</p>
    <p className="text-xs text-slate-400">Second destination: {String(status.copy_destination ?? 'not selected')}. Prefer a removable drive kept separately. A folder selection does not prove a second physical device.</p>
    <button disabled={blocked || busy || pending} className="border rounded px-3 py-2 disabled:opacity-50" onClick={() => { setBusy(true); void window.api.barLocal.adminChooseRecoveryDestination().then(refresh).catch(e => setError(String(e.message ?? e))).finally(() => setBusy(false)) }}>Choose attached recovery drive folder…</button>
    <label className="block text-sm">Reason<input className="block w-full bg-slate-950 border p-2" value={reason} onChange={e => setReason(e.target.value)} maxLength={500}/></label>
    <button disabled={blocked || busy || job.state === 'running'} onClick={() => void act('base')} className="border rounded px-3 py-2 disabled:opacity-50">Create encrypted recovery base</button>
    <button disabled={blocked || busy || job.state === 'running'} onClick={() => void act('copy')} className="ml-2 border rounded px-3 py-2 disabled:opacity-50">Copy encrypted recovery set to second destination</button>
    <label className="block text-sm">Recovery base<select value={base} onChange={e => setBase(e.target.value)} className="block w-full bg-slate-950 border p-2"><option value="">Choose an authenticated backup</option>{packages.filter(p => p.authenticated === true).map(p => <option key={String(p.id)} value={String(p.id)}>{String(p.created_at)}</option>)}</select></label>
    <label className="block text-sm">Target time including timezone<input placeholder="2026-10-29T12:00:00+02:00" value={target} onChange={e => setTarget(e.target.value)} className="block w-full bg-slate-950 border p-2"/></label>
    <button disabled={blocked || busy || !base || !target || job.state === 'running'} onClick={() => void act('drill')} className="border rounded px-3 py-2 disabled:opacity-50">Verify isolated recovery to this time</button>
    <label className="block text-sm">Recovery key passphrase (at least 12 characters)<input type="password" autoComplete="new-password" value={passphrase} onChange={e => setPassphrase(e.target.value)} className="block w-full bg-slate-950 border p-2"/></label>
    <button disabled={blocked || busy || passphrase.length < 12} onClick={() => void act('keys')} className="border rounded px-3 py-2 disabled:opacity-50">Save encrypted recovery keys…</button>
    {job.state && <div role="status" className="text-sm">Recovery job: {String(job.state)}{job.error ? ` — ${String(job.error)}` : ''}{record(job.result).verified === true ? ' — isolated restore verified; live database unchanged.' : ''}</div>}
  </section>
}
