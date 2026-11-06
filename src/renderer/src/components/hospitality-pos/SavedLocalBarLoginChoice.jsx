import { useEffect, useState } from 'react'

/** An explicit workspace switch; never forward credentials between businesses. */
export default function SavedLocalBarLoginChoice() {
  const [entry, setEntry] = useState(/** @type {{status: string, label?: string}|null} */ (null))
  const [working, setWorking] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    let active = true
    Promise.resolve(window.api?.barLocal?.getChooserEntry?.()).then((value) => {
      if (active && ['ready', 'draft', 'recovery'].includes(value?.status)) setEntry(value)
    }).catch(() => { if (active) setError('Saved Bar selection could not be checked. Use Switch business and retry before entering Bar credentials.') })
    return () => { active = false }
  }, [])
  const open = async () => {
    if (working) return
    setWorking(true)
    setError('')
    try {
      const result = await window.api.barLocal.selectLocalBarWorkspace()
      if (result?.restart_required !== true || result?.workspace !== 'local_bar') throw new Error('The saved Bar switch was not confirmed. Your existing setup is preserved.')
      // Keep the switch fenced until the main-owned relaunch completes.
    } catch (cause) {
      setError(cause?.message || 'The saved Bar could not be opened. Keep the existing setup and retry from Switch business.')
      setWorking(false)
    }
  }
  if (!entry && !error) return null
  return <section className="mb-4 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3" aria-label="Saved local Bar">
    {entry && <>
      <p className="text-sm font-semibold text-slate-800">Looking for {entry.label || 'your saved Bar'}?</p>
      <p className="mt-1 text-xs text-slate-700">This sign-in is for the selected cloud business. Open the saved local Bar before entering its email and password.</p>
      <button type="button" disabled={working} onClick={open} className="mt-2 rounded-lg bg-amber-700 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">
        {working ? 'Opening saved local Bar…' : `Open saved local Bar — ${entry.label || 'Local Bar'}`}
      </button>
    </>}
    {error && <p role="alert" className="mt-2 text-sm text-red-800">{error}</p>}
  </section>
}
