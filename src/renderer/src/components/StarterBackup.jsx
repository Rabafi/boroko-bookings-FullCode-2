import { useEffect, useState } from 'react'
import { AlertCircle, CalendarClock, CheckCircle2, Copy, Download, Eye, EyeOff, FileCheck2, FileKey2, FolderOpen, Loader2, ShieldCheck } from 'lucide-react'

function hideSensitiveError(value) {
  return String(value || '').replace(
    /(passphrase\s*(?:value)?\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi,
    '$1[hidden]'
  )
}

function titleForKey(key) {
  return String(key || '').replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function formatAt(value) {
  if (!value) return 'Never'
  try { return new Date(value).toLocaleString('en-GB') } catch { return 'Unknown' }
}

function PassphraseField({ value, onChange, visible, onToggle, id = 'starter-backup-passphrase', label = 'Passphrase' }) {
  return (
    <div>
      <label className="text-sm font-semibold text-slate-800" htmlFor={id}>{label}</label>
      <div className="mt-1 flex overflow-hidden rounded-xl border border-slate-300 bg-white focus-within:border-indigo-500 focus-within:ring-2 focus-within:ring-indigo-100">
        <input
          id={id}
          type={visible ? 'text' : 'password'}
          autoComplete="new-password"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="min-w-0 flex-1 border-0 px-3 py-2.5 text-sm outline-none"
          placeholder="At least 12 characters"
        />
        <button
          type="button"
          onClick={onToggle}
          aria-label={visible ? 'Hide passphrase' : 'Show passphrase'}
          aria-pressed={visible}
          className="inline-flex min-w-20 items-center justify-center gap-1.5 border-l border-slate-200 px-3 text-xs font-semibold text-slate-600 hover:bg-slate-50"
        >
          {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          {visible ? 'Hide' : 'Show'}
        </button>
      </div>
    </div>
  )
}

function BackupResult({
  result,
  passphrase,
  showPassphrase,
  onPassphraseChange,
  onTogglePassphrase,
  onOpenFolder,
  onVerify,
  onCopy,
  onRehearse,
  onStartNew,
  busy
}) {
  if (!result) return null

  if (!result.success) {
    return (
      <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-900" role="alert">
        <div className="flex items-start gap-3">
          <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-red-600" />
          <div>
            <p className="font-semibold">Backup was not confirmed</p>
            <p className="mt-1">{hideSensitiveError(result.error || 'No backup file was confirmed.')}</p>
            {result.fileWritten && result.fileName && (
              <>
                <p className="mt-2 text-xs">The file <span className="font-semibold">{result.fileName}</span> was saved, but its audit record was not confirmed. Keep it secure and reconnect before relying on it.</p>
                {result.destination && <p className="mt-2 break-all font-mono text-xs">{result.destination}</p>}
                {result.encrypted && (
                  <div className="mt-3 rounded-xl border border-red-200 bg-white p-3 text-slate-900">
                    <PassphraseField
                      id="starter-backup-unconfirmed-passphrase"
                      label="Passphrase for verification"
                      value={passphrase}
                      onChange={onPassphraseChange}
                      visible={showPassphrase}
                      onToggle={onTogglePassphrase}
                    />
                  </div>
                )}
                <div className="mt-3 flex flex-wrap gap-2">
                  <button type="button" onClick={onVerify} disabled={busy} className="inline-flex items-center gap-2 rounded-lg border border-red-200 bg-white px-3 py-2 text-xs font-semibold text-red-800"><FileCheck2 className="h-4 w-4" />Verify file</button>
                  <button type="button" onClick={onOpenFolder} disabled={busy} className="inline-flex items-center gap-2 rounded-lg border border-red-200 bg-white px-3 py-2 text-xs font-semibold text-red-800"><FolderOpen className="h-4 w-4" />Open folder</button>
                </div>
                <button type="button" onClick={onStartNew} disabled={busy} className="mt-3 text-xs font-semibold text-red-800 underline decoration-red-300 underline-offset-4">Create a new backup</button>
              </>
            )}
          </div>
        </div>
      </div>
    )
  }

  const counts = result.counts && typeof result.counts === 'object' ? Object.entries(result.counts) : []
  const warnings = Array.isArray(result.warnings) ? result.warnings : []
  const verified = result.verified === true
  const resultTitle = result.complete === false
    ? (verified ? 'Backup checked, but some data needs attention' : 'Backup saved, but some data needs attention')
    : verified
      ? 'Backup checked and ready'
      : 'Check this backup'

  return (
    <section className={`rounded-2xl border p-5 ${result.complete === false ? 'border-amber-200 bg-amber-50' : 'border-emerald-200 bg-emerald-50'}`} data-testid="starter-backup-result" aria-live="polite">
      <div className="flex items-start gap-3">
        {result.complete === false ? <AlertCircle className="mt-0.5 h-6 w-6 shrink-0 text-amber-600" /> : <CheckCircle2 className="mt-0.5 h-6 w-6 shrink-0 text-emerald-600" />}
        <div className="min-w-0 flex-1">
          <p className={`text-lg font-bold ${result.complete === false ? 'text-amber-950' : 'text-emerald-950'}`}>{resultTitle}</p>
          <p className="mt-1 text-sm text-slate-700">{verified ? 'Keep a second copy in another secure location.' : 'Enter the passphrase and check the file before relying on it.'}</p>
          <p className="mt-3 rounded-xl bg-white/80 px-3 py-2 text-sm text-slate-700">Saved as <span className="font-semibold text-slate-900">{result.fileName || 'backup file'}</span></p>

          {result.encrypted && !verified && (
            <div className="mt-4 rounded-xl border border-indigo-100 bg-white/80 p-3">
              <PassphraseField
                id="starter-backup-verification-passphrase"
                label="Passphrase for verification"
                value={passphrase}
                onChange={onPassphraseChange}
                visible={showPassphrase}
                onToggle={onTogglePassphrase}
              />
              <p className="mt-1.5 text-xs text-slate-500">We do not store this passphrase. Keep it somewhere safe.</p>
            </div>
          )}

          <div className="mt-4 flex flex-wrap gap-2">
            {verified ? (
              <button type="button" onClick={onCopy} disabled={busy} className="inline-flex items-center gap-2 rounded-xl bg-indigo-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-indigo-800 disabled:opacity-60"><Copy className="h-4 w-4" />Save second copy</button>
            ) : (
              <button type="button" onClick={onVerify} disabled={busy} className="inline-flex items-center gap-2 rounded-xl bg-indigo-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-indigo-800 disabled:opacity-60"><FileCheck2 className="h-4 w-4" />Check backup</button>
            )}
          </div>

          <details className="mt-4 rounded-xl border border-slate-200 bg-white/70 p-3">
            <summary className="cursor-pointer text-sm font-semibold text-slate-700">More options</summary>
            <div className="mt-3 flex flex-wrap gap-2">
              {verified && <button type="button" onClick={onVerify} disabled={busy} className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"><FileCheck2 className="h-4 w-4" />Check backup again</button>}
              <button type="button" onClick={onRehearse} disabled={busy} className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"><ShieldCheck className="h-4 w-4" />Test recovery locally</button>
              <button type="button" onClick={onOpenFolder} disabled={busy} className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"><FolderOpen className="h-4 w-4" />Open folder</button>
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <div className="rounded-xl bg-slate-50 px-3 py-2 sm:col-span-2"><p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Saved location</p><p className="mt-1 break-all font-mono text-xs font-semibold text-slate-900">{result.destination || 'Unavailable'}</p></div>
              <div className="rounded-xl bg-slate-50 px-3 py-2"><p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Protection</p><p className="mt-1 text-sm font-semibold text-slate-900">{result.encrypted ? 'Encrypted with your passphrase' : 'Not encrypted'}</p></div>
              <div className="rounded-xl bg-slate-50 px-3 py-2"><p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">SHA-256 fingerprint</p><p className="mt-1 break-all font-mono text-xs font-semibold text-slate-900">{result.sha256 || 'Unavailable'}</p></div>
            </div>
            <div className="mt-4">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Included records</p>
              <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {counts.map(([key, count]) => <div key={key} className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 text-sm"><span className="text-slate-600">{titleForKey(key)}</span><span className="font-semibold text-slate-900">{Number(count || 0).toLocaleString()}</span></div>)}
              </div>
            </div>
            <div className="mt-4 rounded-xl bg-slate-50 px-3 py-3"><p className="text-sm font-semibold text-slate-900">Data included: {result.complete === false ? 'Needs attention' : 'Complete'}</p>{warnings.length > 0 && <ul className="mt-2 space-y-1 text-xs text-amber-900">{warnings.map((warning, index) => <li key={`${warning}-${index}`}>• {warning}</li>)}</ul>}</div>
          </details>

          <button type="button" onClick={onStartNew} disabled={busy} className="mt-5 text-sm font-semibold text-slate-600 underline decoration-slate-300 underline-offset-4 hover:text-slate-900">Create a new backup</button>
        </div>
      </div>
    </section>
  )
}

export default function StarterBackup() {
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState(null)
  const [notice, setNotice] = useState('')
  const [history, setHistory] = useState(null)
  const [encrypt, setEncrypt] = useState(true)
  const [passphrase, setPassphrase] = useState('')
  const [showPassphrase, setShowPassphrase] = useState(false)
  const [automation, setAutomation] = useState(null)
  const [automationBusy, setAutomationBusy] = useState(false)
  const [automationNotice, setAutomationNotice] = useState('')
  const [showAutomationSetup, setShowAutomationSetup] = useState(false)
  const [automationFolder, setAutomationFolder] = useState('')
  const [automationPassphrase, setAutomationPassphrase] = useState('')
  const [automationPassphraseConfirm, setAutomationPassphraseConfirm] = useState('')
  const [showAutomationPassphrase, setShowAutomationPassphrase] = useState(false)
  const backupSaved = result?.success === true || result?.fileWritten === true

  const refreshHistory = async () => {
    try {
      const next = await window.api?.backup?.starterHistory?.()
      if (next?.success) setHistory(next)
    } catch {}
  }

  useEffect(() => { refreshHistory() }, [])

  const refreshAutomation = async () => {
    try {
      const next = await window.api?.backup?.automationStatus?.()
      if (next?.success) {
        setAutomation(next)
        if (next.config?.destination_folder) setAutomationFolder(next.config.destination_folder)
      }
    } catch {}
  }

  useEffect(() => { refreshAutomation() }, [])

  const chooseAutomationFolder = async () => {
    setAutomationBusy(true)
    setAutomationNotice('')
    try {
      const next = await window.api?.backup?.chooseStarterAutomationFolder?.()
      if (next?.success && next.path) setAutomationFolder(next.path)
      else if (!next?.canceled) setAutomationNotice(hideSensitiveError(next?.error || 'The folder could not be selected.'))
    } finally {
      setAutomationBusy(false)
    }
  }

  const saveAutomation = async () => {
    if (!automationFolder) return setAutomationNotice('Choose a folder for weekly backups.')
    if (automationPassphrase.length < 12) return setAutomationNotice('Use a passphrase with at least 12 characters.')
    if (automationPassphrase !== automationPassphraseConfirm) return setAutomationNotice('The two passphrases do not match.')
    setAutomationBusy(true)
    setAutomationNotice('')
    try {
      const next = await window.api?.backup?.automationConfigure?.({
        destination_folder: automationFolder,
        passphrase: automationPassphrase,
        confirm_passphrase: automationPassphraseConfirm,
        enabled: true
      })
      if (next?.success) {
        setAutomationPassphrase('')
        setAutomationPassphraseConfirm('')
        setShowAutomationPassphrase(false)
        setShowAutomationSetup(false)
        setAutomationNotice('Weekly backups are on. The app will create and check a backup when it is due and online.')
        await refreshAutomation()
      } else setAutomationNotice(hideSensitiveError(next?.error || 'Weekly backups could not be enabled.'))
    } catch (error) {
      setAutomationNotice(hideSensitiveError(error?.message || 'Weekly backups could not be enabled.'))
    } finally {
      setAutomationBusy(false)
    }
  }

  const runAutomationAction = async (action, successMessage) => {
    setAutomationBusy(true)
    setAutomationNotice('')
    try {
      const next = await action()
      if (next?.success) {
        setAutomationNotice(successMessage)
        await refreshAutomation()
        await refreshHistory()
      } else setAutomationNotice(hideSensitiveError(next?.error || 'The action could not be completed.'))
    } catch (error) {
      setAutomationNotice(hideSensitiveError(error?.message || 'The action could not be completed.'))
    } finally {
      setAutomationBusy(false)
    }
  }

  const updatePassphrase = (value) => {
    setPassphrase(value)
    setNotice('')
  }

  const createBackup = async () => {
    if (encrypt && passphrase.length < 12) {
      setNotice('Enter a passphrase with at least 12 characters.')
      return
    }
    setBusy(true)
    setResult(null)
    setNotice('')
    try {
      const bridge = window.api?.backup?.starterExport
      if (typeof bridge !== 'function') throw new Error('Backup is not available in this desktop build.')
      const next = await bridge({ passphrase: encrypt ? passphrase : '' })
      if (next?.canceled) setNotice('Backup cancelled. No file was created.')
      else {
        setResult(next || { success: false, error: 'The backup service returned no result.' })
        if (next?.success) {
          await refreshHistory()
          try {
            const verification = await window.api?.backup?.starterVerify?.({
              destination: next.destination,
              passphrase: next.encrypted ? passphrase : ''
            })
            if (verification?.success) {
              setResult({ ...next, verified: true })
              setNotice('Backup checked and ready.')
            } else {
              setResult({ ...next, verified: false })
              setNotice(`The backup was saved but could not be checked automatically. ${hideSensitiveError(verification?.error || 'Check it before relying on it.')}`)
            }
          } catch (error) {
            setResult({ ...next, verified: false })
            setNotice(`The backup was saved but could not be checked automatically. ${hideSensitiveError(error?.message || 'Check it before relying on it.')}`)
          }
        }
      }
    } catch (error) {
      setResult({ success: false, error: error?.message || 'Backup could not be created.' })
    } finally {
      setBusy(false)
    }
  }

  const withBusy = async (action, successCopy = 'Done.', onSuccess) => {
    setBusy(true)
    setNotice('')
    try {
      const next = await action()
      if (next?.success === false) setNotice(hideSensitiveError(next.error || 'This action could not be completed.'))
      else if (next?.success) {
        onSuccess?.(next)
        setNotice(next.rehearsalDirectory ? `Recovery test passed. No lodge data was changed. Report: ${next.rehearsalDirectory}` : successCopy)
      }
    } catch (error) {
      setNotice(hideSensitiveError(error?.message || 'This action could not be completed.'))
    } finally {
      setBusy(false)
    }
  }

  const verify = () => withBusy(
    () => window.api?.backup?.starterVerify?.({ destination: result?.destination, passphrase: result?.encrypted ? passphrase : '' }),
    'Backup checked and ready.',
    () => setResult((current) => ({ ...current, verified: true }))
  )
  const copy = () => withBusy(
    () => window.api?.backup?.starterCopy?.({ destination: result?.destination, passphrase: result?.encrypted ? passphrase : '' }),
    'The second backup copy was saved.',
    (next) => { setResult((current) => ({ ...current, ...next })); refreshHistory() }
  )
  const rehearse = () => withBusy(() => window.api?.backup?.starterRestoreRehearsal?.({ destination: result?.destination, passphrase: result?.encrypted ? passphrase : '' }), 'Local recovery test passed. No lodge data was changed.')
  const startNewBackup = () => {
    setResult(null)
    setNotice('')
    setPassphrase('')
    setShowPassphrase(false)
    setEncrypt(true)
  }

  const checkLastBackup = () => {
    const latest = history?.history?.[0]
    if (!latest?.destination) {
      setNotice('The last backup file could not be found. Create a new backup instead.')
      return
    }
    setResult({ ...latest, success: true, verified: false })
    setPassphrase('')
    setShowPassphrase(false)
    setNotice('Enter the backup passphrase, then select Check backup.')
  }

  return (
    <main className="mx-auto max-w-4xl space-y-5 p-6" data-testid="starter-backup">
      <header>
        <p className="text-xs font-bold uppercase tracking-[.18em] text-indigo-700">Starter backup</p>
        <h1 className="mt-1 text-3xl font-bold text-slate-950">Back up your lodge data</h1>
        <p className="mt-2 max-w-2xl text-sm text-slate-600">Save your rooms, guests, bookings, payments, quotations, settings, and maintenance records in one secure file.</p>
      </header>

      <section className="rounded-2xl border border-indigo-100 bg-indigo-50 p-4">
        <div className="flex items-start gap-3"><ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-indigo-700" /><div><h2 className="font-semibold text-indigo-950">Safe and read-only</h2><p className="mt-1 text-sm text-indigo-900">Creating, checking, or testing a backup never changes your live lodge data. Recovery is handled with support.</p></div></div>
      </section>

      <section className="grid gap-4 md:grid-cols-2">
        <div className="rounded-2xl border border-amber-100 bg-amber-50 p-4"><div className="flex items-start gap-3"><FileKey2 className="mt-0.5 h-5 w-5 shrink-0 text-amber-700" /><div><h2 className="font-semibold text-amber-950">Keep the file private</h2><p className="mt-1 text-sm text-amber-900">It contains guest and payment records. Store it securely and share it only with authorised staff or support.</p></div></div></div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <h2 className="font-semibold text-slate-900">Last backup</h2>
          <p className="mt-1 text-sm text-slate-600">{formatAt(history?.lastBackupAt)}{history?.lastBackupFileName ? ` · ${history.lastBackupFileName}` : ''}</p>
          <p className="mt-2 text-xs text-slate-500">{!history || history?.state === 'never' ? 'Create your first backup now.' : history?.state === 'due' ? 'It is time to create a fresh backup.' : history?.state === 'incomplete' ? 'The latest backup needs support attention.' : 'Keep a second copy in another secure location.'}</p>
          {history?.history?.[0]?.destination && !backupSaved && (
            <button type="button" onClick={checkLastBackup} disabled={busy} className="mt-3 inline-flex items-center gap-2 rounded-xl border border-indigo-200 bg-indigo-50 px-3 py-2 text-sm font-semibold text-indigo-700 hover:bg-indigo-100 disabled:opacity-60">
              <FileCheck2 className="h-4 w-4" />Check last backup
            </button>
          )}
        </div>
      </section>

      {automation && (
        <section className="rounded-2xl border border-sky-200 bg-sky-50 p-5" data-testid="starter-backup-automation">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex items-start gap-3">
              <CalendarClock className="mt-0.5 h-6 w-6 shrink-0 text-sky-700" />
              <div>
                <h2 className="text-lg font-bold text-sky-950">Weekly backup</h2>
                <p className="mt-1 text-sm text-sky-900">
                  {automation.enabled
                    ? automation.status?.state === 'due'
                      ? 'A backup is due. Keep the app online and the backup folder connected.'
                      : `On · next check ${formatAt(automation.status?.next_due_at)}`
                    : 'Turn this on once and the app will create a checked backup every week.'}
                </p>
              </div>
            </div>
            <span className={`rounded-full px-3 py-1 text-xs font-bold ${automation.enabled ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-200 text-slate-700'}`}>{automation.enabled ? 'On' : 'Off'}</span>
          </div>

          {automation.enabled && (
            <div className="mt-4 grid gap-2 text-sm sm:grid-cols-2">
              <div className="rounded-xl bg-white/80 px-3 py-2"><span className="text-slate-500">Last checked backup</span><p className="mt-1 font-semibold text-slate-900">{formatAt(automation.status?.last_verified_at)}</p></div>
              <div className="rounded-xl bg-white/80 px-3 py-2"><span className="text-slate-500">Folder</span><p className="mt-1 break-all font-semibold text-slate-900">{automation.config?.destination_label || automation.config?.destination_folder || 'Unavailable'}</p></div>
            </div>
          )}

          {automation.status?.last_failure_reason && <p className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">Needs attention: {hideSensitiveError(automation.status.last_failure_reason)}</p>}
          {automationNotice && <p className="mt-3 rounded-xl bg-white/80 px-3 py-2 text-sm font-medium text-slate-700" role="status">{automationNotice}</p>}

          {!showAutomationSetup && (
            <div className="mt-4 flex flex-wrap gap-2">
              <button type="button" onClick={() => setShowAutomationSetup(true)} disabled={automationBusy} className="rounded-xl bg-sky-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-sky-800 disabled:opacity-60">{automation.enabled ? 'Change setup' : 'Set up weekly backup'}</button>
              {automation.enabled && <button type="button" onClick={() => runAutomationAction(() => window.api?.backup?.automationRunNow?.({ force: true }), 'A new weekly backup was created and checked.')} disabled={automationBusy} className="rounded-xl border border-sky-300 bg-white px-4 py-2.5 text-sm font-semibold text-sky-800 disabled:opacity-60">Back up now</button>}
              {automation.enabled && <button type="button" onClick={() => runAutomationAction(() => window.api?.backup?.automationDisable?.(), 'Weekly backups are off. Existing backup files were not removed.')} disabled={automationBusy} className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 disabled:opacity-60">Turn off</button>}
            </div>
          )}

          {showAutomationSetup && (
            <div className="mt-4 space-y-4 rounded-xl border border-sky-200 bg-white p-4">
              <div>
                <label className="text-sm font-semibold text-slate-800" htmlFor="starter-automation-folder">Backup folder</label>
                <div className="mt-1 flex gap-2">
                  <input id="starter-automation-folder" readOnly value={automationFolder} placeholder="Choose a secure folder" className="min-w-0 flex-1 rounded-xl border border-slate-300 px-3 py-2.5 text-sm" />
                  <button type="button" onClick={chooseAutomationFolder} disabled={automationBusy} className="rounded-xl border border-sky-300 px-3 py-2 text-sm font-semibold text-sky-800">Choose</button>
                </div>
              </div>
              <PassphraseField id="starter-automation-passphrase" label="Backup passphrase" value={automationPassphrase} onChange={setAutomationPassphrase} visible={showAutomationPassphrase} onToggle={() => setShowAutomationPassphrase((current) => !current)} />
              <PassphraseField id="starter-automation-passphrase-confirm" label="Enter the passphrase again" value={automationPassphraseConfirm} onChange={setAutomationPassphraseConfirm} visible={showAutomationPassphrase} onToggle={() => setShowAutomationPassphrase((current) => !current)} />
              <p className="text-xs text-slate-500">The passphrase is protected by Windows secure storage. Keep your own secure copy—you will need it to check or recover a backup.</p>
              <div className="flex gap-2">
                <button type="button" onClick={saveAutomation} disabled={automationBusy} className="inline-flex items-center gap-2 rounded-xl bg-sky-700 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60">{automationBusy && <Loader2 className="h-4 w-4 animate-spin" />}Turn on weekly backups</button>
                <button type="button" onClick={() => { setShowAutomationSetup(false); setAutomationPassphrase(''); setAutomationPassphraseConfirm('') }} disabled={automationBusy} className="rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700">Cancel</button>
              </div>
            </div>
          )}
        </section>
      )}

      {!backupSaved && (
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm" data-testid="starter-backup-create">
          <h2 className="text-lg font-bold text-slate-900">Create a backup</h2>
          <p className="mt-1 text-sm text-slate-600">Choose a passphrase, then select where to save the file.</p>
          <label className="mt-4 flex items-center gap-2 text-sm font-semibold text-slate-800"><input type="checkbox" checked={encrypt} onChange={(event) => { setEncrypt(event.target.checked); setNotice('') }} />Protect this backup with a passphrase</label>
          {encrypt && (
            <div className="mt-3 max-w-xl">
              <PassphraseField value={passphrase} onChange={updatePassphrase} visible={showPassphrase} onToggle={() => setShowPassphrase((current) => !current)} />
              <p className="mt-1.5 text-xs text-slate-500">Use at least 12 characters. We cannot recover this passphrase, so keep it somewhere safe.</p>
            </div>
          )}
          <button type="button" onClick={createBackup} disabled={busy} className="mt-5 inline-flex items-center gap-2 rounded-xl bg-indigo-700 px-5 py-3 text-sm font-semibold text-white transition hover:bg-indigo-800 disabled:cursor-not-allowed disabled:opacity-60">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}{busy ? 'Creating backup…' : 'Create backup file'}</button>
        </section>
      )}

      {notice && <p className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-700" role="status">{notice}</p>}
      <BackupResult
        result={result}
        passphrase={passphrase}
        showPassphrase={showPassphrase}
        onPassphraseChange={updatePassphrase}
        onTogglePassphrase={() => setShowPassphrase((current) => !current)}
        onOpenFolder={() => withBusy(() => window.api?.backup?.starterOpenFolder?.({ destination: result?.destination }), 'Backup folder opened.')}
        onVerify={verify}
        onCopy={copy}
        onRehearse={rehearse}
        onStartNew={startNewBackup}
        busy={busy}
      />
      <footer className="text-xs text-slate-500">This page creates and tests backup files only. It never restores or overwrites live lodge data.</footer>
    </main>
  )
}
