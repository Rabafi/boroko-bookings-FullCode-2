// @ts-check
import { useState } from 'react'
import { HposNotice } from './HposUi.jsx'

export function TrainingFrame({ children }) {
  const [error, setError] = useState('')
  const reset = async () => {
    if (window.prompt('This resets practice data only. Type RESET_TRAINING to continue.') !== 'RESET_TRAINING') return
    try { await window.api.barLocal.trainingReset({ confirm: 'RESET_TRAINING' }) }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Practice reset failed. Live data was not changed.') }
  }
  return <div className="pt-16">
    <aside role="status" className="fixed inset-x-0 top-0 z-[9999] flex flex-wrap items-center justify-between gap-2 bg-amber-400 p-3 font-bold text-slate-950 print:static print:block">
      <span>TRAINING — PRACTICE ONLY · No live money, stock or cloud sync</span>
      <div className="flex gap-3 print:hidden"><button onClick={() => void reset()} className="underline">Reset practice</button><button onClick={() => window.close()} className="underline">Close practice window</button></div>
      {error && <HposNotice tone="error">{error}</HposNotice>}
    </aside>
    {children}
  </div>
}

export function TrainingSetup() {
  const [pin, setPin] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const begin = async (event) => {
    event.preventDefault(); setBusy(true); setError('')
    try { await window.api.barLocal.trainingBegin({ pin }) }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Practice setup failed. Retry the same practice workspace.') }
    finally { setBusy(false); setPin('') }
  }
  return <TrainingFrame><main className="min-h-screen bg-slate-950 p-8 text-white"><form onSubmit={begin} className="mx-auto max-w-lg space-y-5 rounded-xl bg-slate-900 p-6">
    <h1 className="text-2xl font-bold">Set up your practice Bar</h1>
    <p>This window uses its own database, staff, products, receipts and operation journal. It cannot change your real Bar. Live trading stays in the other window.</p>
    <p>Choose a practice owner PIN. After setup, use the displayed practice owner ID and this PIN to sign in. You can create sample products and staff as you would in a new Bar.</p>
    <label className="block">Practice owner PIN<input required type="password" pattern="[0-9]{4,12}" inputMode="numeric" autoComplete="new-password" value={pin} onChange={event => setPin(event.target.value)} className="mt-2 block w-full rounded bg-slate-800 p-3" /></label>
    <button disabled={busy} className="rounded bg-amber-400 p-3 font-bold text-slate-950 disabled:opacity-50">{busy ? 'Preparing the separate practice database…' : 'Create or resume practice Bar'}</button>
    {error && <HposNotice tone="error">{error}</HposNotice>}
  </form></main></TrainingFrame>
}
