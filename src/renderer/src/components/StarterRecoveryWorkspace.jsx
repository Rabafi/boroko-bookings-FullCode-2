import { useEffect, useState } from 'react'
import { AlertTriangle, CheckCircle2, Eye, EyeOff, FileArchive, Loader2, RefreshCw, ShieldAlert, Trash2 } from 'lucide-react'

function safeError(value) {
  return String(value || 'The recovery action could not be completed.')
    .replace(/(passphrase\s*(?:value)?\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi, '$1[hidden]')
}

function formatAt(value) {
  if (!value) return 'Not yet'
  try { return new Date(value).toLocaleString('en-GB') } catch { return 'Unknown' }
}

function StatusPill({ value }) {
  const complete = value === 'verified'
  const failed = value === 'failed' || value === 'discarded'
  return <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${complete ? 'bg-emerald-500/15 text-emerald-300' : failed ? 'bg-red-500/15 text-red-300' : 'bg-amber-500/15 text-amber-300'}`}>{String(value || 'draft').replaceAll('_', ' ')}</span>
}

export default function StarterRecoveryWorkspace({ companies = [], unlocked = false }) {
  const [operations, setOperations] = useState([])
  const [operation, setOperation] = useState(null)
  const [preview, setPreview] = useState(null)
  const [selectedLodgeId, setSelectedLodgeId] = useState('')
  const [reason, setReason] = useState('')
  const [ticketRef, setTicketRef] = useState('')
  const [sourcePath, setSourcePath] = useState('')
  const [sourceName, setSourceName] = useState('')
  const [passphrase, setPassphrase] = useState('')
  const [showPassphrase, setShowPassphrase] = useState(false)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')

  const refresh = async () => {
    const result = await window.api?.backup?.recoveryList?.()
    if (result?.success) setOperations(Array.isArray(result.operations) ? result.operations : [])
    else if (result?.error) setNotice(safeError(result.error))
  }

  useEffect(() => { refresh().catch(() => {}) }, [])

  const run = async (action, onSuccess) => {
    setBusy(true)
    setNotice('')
    try {
      const result = await action()
      if (!result?.success) throw new Error(result?.error || 'The recovery action was rejected.')
      await onSuccess?.(result)
      await refresh()
    } catch (error) {
      setNotice(safeError(error?.message))
    } finally {
      setBusy(false)
    }
  }

  const begin = () => {
    if (!selectedLodgeId) return setNotice('Select the exact customer lodge first.')
    if (reason.trim().length < 8) return setNotice('Enter a clear recovery reason of at least 8 characters.')
    if (ticketRef.trim().length < 3) return setNotice('Enter the support ticket reference.')
    return run(
      () => window.api?.backup?.recoveryBegin?.({ lodge_id: selectedLodgeId, reason: reason.trim(), ticket_ref: ticketRef.trim() }),
      (result) => { setOperation(result.operation); setPreview(null); setNotice('Recovery operation created. Choose the customer backup file.') }
    )
  }

  const choosePackage = () => run(
    () => window.api?.backup?.recoveryChoosePackage?.(),
    (result) => {
      if (result.canceled) return
      setSourcePath(result.path || '')
      setSourceName(result.fileName || '')
      setNotice('Backup selected. Enter its passphrase, then validate it.')
    }
  )

  const validatePackage = () => {
    if (!operation?.operation_id) return setNotice('Start a recovery operation first.')
    if (!sourcePath) return setNotice('Choose the customer backup file.')
    if (!passphrase) return setNotice('Enter the backup passphrase.')
    return run(async () => {
      const staged = await window.api?.backup?.recoveryStage?.({ operation_id: operation.operation_id, source_path: sourcePath, passphrase })
      if (!staged?.success) return staged
      const sealed = await window.api?.backup?.recoverySeal?.({ operation_id: operation.operation_id, passphrase })
      if (!sealed?.success) return sealed
      const checked = await window.api?.backup?.recoveryPreview?.(operation.operation_id)
      if (!checked?.success) return checked
      return { success: true, operation: sealed.operation, preview: checked.preview }
    }, (result) => {
      setOperation(result.operation)
      setPreview(result.preview)
      setNotice('File validated locally. No lodge has been restored. Review the counts and disposable target before approval.')
    })
  }

  const approve = () => run(
    () => window.api?.backup?.recoveryApprove?.({ operation_id: operation?.operation_id, reason: reason.trim(), ticket_ref: ticketRef.trim() }),
    (result) => { setOperation(result.operation); setNotice('Recovery approved. Execute only after confirming the target and counts.') }
  )

  const execute = () => run(
    () => window.api?.backup?.recoveryExecute?.({ operation_id: operation?.operation_id, passphrase }),
    (result) => {
      setOperation(result.operation)
      if (result.operation?.status === 'verified') {
        setNotice('Disposable recovery lodge restored and confirmed by the server.')
        setPassphrase('')
      } else {
        setNotice('The server did not confirm a completed restore. Review the operation details before retrying.')
      }
    }
  )

  const verify = () => run(
    () => window.api?.backup?.recoveryVerify?.(operation?.operation_id),
    (result) => setNotice(result.success ? 'Server confirmed the disposable recovery lodge and its checks.' : 'The server did not confirm the disposable recovery checks.')
  )

  const discard = () => run(
    () => window.api?.backup?.recoveryDiscard?.(operation?.operation_id),
    (result) => { setOperation(result.operation); setPreview(null); setPassphrase(''); setNotice('Recovery operation discarded. Live lodge data was not changed.') }
  )

  const selectExisting = async (item) => {
    setOperation(item)
    setSelectedLodgeId(item.lodge_id || '')
    setReason(item.reason || '')
    setTicketRef(item.ticket_ref || '')
    setSourcePath('')
    setSourceName('')
    setPassphrase('')
    setPreview(null)
    setNotice('')
    if (['sealed', 'preview_ready', 'approved'].includes(item.status)) {
      const result = await window.api?.backup?.recoveryPreview?.(item.operation_id)
      if (result?.success) setPreview(result.preview)
    }
  }

  const counts = Object.entries(preview?.table_counts || operation?.table_counts || {})
  const canMutate = unlocked && !busy

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-purple-500/30 bg-purple-500/10 p-5">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-purple-300">Support recovery</p>
        <h2 className="mt-2 text-xl font-bold text-white">Restore into a disposable recovery lodge</h2>
        <p className="mt-2 max-w-3xl text-sm text-gray-300">This workflow never overwrites the customer’s live lodge. A result is complete only after the server confirms the quarantined recovery lodge and verification checks pass.</p>
      </div>

      {!unlocked && <div className="flex items-start gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-200"><ShieldAlert className="mt-0.5 h-5 w-5 shrink-0" /><p>Select <strong>Unlock changes</strong> in the Command Central header before beginning, staging, approving, executing, or discarding recovery work.</p></div>}
      {notice && <div className="rounded-xl border border-gray-700 bg-gray-900 px-4 py-3 text-sm text-gray-200" role="status">{notice}</div>}

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
        <section className="space-y-4 rounded-xl border border-gray-800 bg-gray-900/60 p-5">
          <div className="flex items-center justify-between gap-3"><h3 className="font-bold text-white">Current operation</h3>{operation && <StatusPill value={operation.status} />}</div>

          {!operation && <>
            <label className="block text-xs font-semibold uppercase tracking-wide text-gray-400">Customer lodge<select value={selectedLodgeId} onChange={(event) => setSelectedLodgeId(event.target.value)} className="mt-2 w-full rounded-lg border border-gray-700 bg-gray-950 px-3 py-2.5 text-sm font-normal normal-case text-white"><option value="">Select the exact lodge</option>{companies.map((company) => <option key={company.lodge_id} value={company.lodge_id}>{company.name || company.lodge_name || company.lodge_id}</option>)}</select></label>
            <label className="block text-xs font-semibold uppercase tracking-wide text-gray-400">Support ticket<input value={ticketRef} onChange={(event) => setTicketRef(event.target.value)} className="mt-2 w-full rounded-lg border border-gray-700 bg-gray-950 px-3 py-2.5 text-sm font-normal normal-case text-white" placeholder="Example: SUP-1042" /></label>
            <label className="block text-xs font-semibold uppercase tracking-wide text-gray-400">Reason<textarea value={reason} onChange={(event) => setReason(event.target.value)} className="mt-2 min-h-20 w-full rounded-lg border border-gray-700 bg-gray-950 px-3 py-2.5 text-sm font-normal normal-case text-white" placeholder="Why is this recovery required?" /></label>
            <button type="button" onClick={begin} disabled={!canMutate} className="inline-flex items-center gap-2 rounded-lg bg-purple-600 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-40">{busy && <Loader2 className="h-4 w-4 animate-spin" />}Start recovery</button>
          </>}

          {operation && <>
            <div className="grid gap-3 text-sm sm:grid-cols-2"><div className="rounded-lg bg-gray-950 p-3"><p className="text-xs text-gray-500">Operation</p><p className="mt-1 break-all font-mono text-gray-200">{operation.operation_id}</p></div><div className="rounded-lg bg-gray-950 p-3"><p className="text-xs text-gray-500">Customer lodge</p><p className="mt-1 break-all font-mono text-gray-200">{operation.lodge_id}</p></div></div>

            {['draft', 'staging', 'failed'].includes(operation.status) && <div className="space-y-3 rounded-xl border border-gray-700 bg-gray-950 p-4">
              <button type="button" onClick={choosePackage} disabled={!canMutate} className="inline-flex items-center gap-2 rounded-lg border border-purple-500/40 bg-purple-500/10 px-3 py-2 text-sm font-semibold text-purple-200 disabled:opacity-40"><FileArchive className="h-4 w-4" />Choose .tbbackup file</button>
              {sourceName && <p className="text-sm text-gray-300">Selected: <strong>{sourceName}</strong></p>}
              <label className="block text-xs font-semibold uppercase tracking-wide text-gray-400">Backup passphrase<div className="mt-2 flex overflow-hidden rounded-lg border border-gray-700 bg-gray-900"><input type={showPassphrase ? 'text' : 'password'} value={passphrase} onChange={(event) => setPassphrase(event.target.value)} autoComplete="new-password" className="min-w-0 flex-1 bg-transparent px-3 py-2.5 text-sm font-normal normal-case text-white outline-none" /><button type="button" onClick={() => setShowPassphrase((value) => !value)} className="border-l border-gray-700 px-3 text-gray-300" aria-label={showPassphrase ? 'Hide passphrase' : 'Show passphrase'}>{showPassphrase ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</button></div></label>
              <button type="button" onClick={validatePackage} disabled={!canMutate || !sourcePath || !passphrase} className="rounded-lg bg-purple-600 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-40">Validate file locally</button>
            </div>}

            {preview && <div className="rounded-xl border border-gray-700 bg-gray-950 p-4"><div className="flex items-start gap-3"><CheckCircle2 className="mt-0.5 h-5 w-5 text-emerald-400" /><div><h4 className="font-semibold text-white">Local validation passed — not restored</h4><p className="mt-1 text-sm text-gray-400">The file is valid on this computer. It has not restored any lodge yet. Approval sends a metadata-bound request for a new quarantined disposable lodge; the live customer lodge will not be overwritten.</p></div></div><div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{counts.map(([name, count]) => <div key={name} className="flex justify-between rounded-lg bg-gray-900 px-3 py-2 text-sm"><span className="text-gray-400">{name.replaceAll('_', ' ')}</span><strong className="text-white">{Number(count || 0).toLocaleString()}</strong></div>)}</div>{preview.snapshot_coherence?.snapshot_coherent !== true && <p className="mt-3 flex items-start gap-2 text-xs text-amber-300"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />The source export was not captured in one database transaction. Review its warnings before approval.</p>}</div>}

            {['sealed', 'preview_ready'].includes(operation.status) && <button type="button" onClick={approve} disabled={!canMutate || !preview} className="rounded-lg bg-amber-600 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-40">Approve server restore</button>}
            {operation.status === 'approved' && <button type="button" onClick={execute} disabled={!canMutate || !passphrase} className="rounded-lg bg-red-600 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-40">Execute server restore</button>}
            {operation.status === 'verified' && <button type="button" onClick={verify} disabled={!canMutate} className="rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-40">Run server verification again</button>}
            {!['executing', 'verified', 'discarded'].includes(operation.status) && <button type="button" onClick={discard} disabled={!canMutate} className="inline-flex items-center gap-2 rounded-lg border border-red-500/40 px-3 py-2 text-sm font-semibold text-red-300 disabled:opacity-40"><Trash2 className="h-4 w-4" />Discard operation</button>}
          </>}
        </section>

        <aside className="rounded-xl border border-gray-800 bg-gray-900/60 p-4">
          <div className="flex items-center justify-between"><h3 className="font-bold text-white">Recent operations</h3><button type="button" onClick={() => refresh()} disabled={busy} className="rounded-lg p-2 text-gray-400 hover:bg-gray-800 hover:text-white" aria-label="Refresh recovery operations"><RefreshCw className="h-4 w-4" /></button></div>
          <div className="mt-3 space-y-2">{operations.length === 0 && <p className="text-sm text-gray-500">No recovery operations yet.</p>}{operations.map((item) => <button key={item.operation_id} type="button" onClick={() => selectExisting(item)} className="w-full rounded-lg border border-gray-800 bg-gray-950 p-3 text-left hover:border-purple-500/50"><div className="flex items-center justify-between gap-2"><span className="truncate text-sm font-semibold text-gray-200">{item.ticket_ref || item.operation_id}</span><StatusPill value={item.status} /></div><p className="mt-2 truncate font-mono text-xs text-gray-500">{item.lodge_id}</p><p className="mt-1 text-xs text-gray-600">{formatAt(item.created_at)}</p></button>)}</div>
          {operation && <button type="button" onClick={() => { setOperation(null); setPreview(null); setPassphrase(''); setSourcePath(''); setSourceName(''); setNotice('') }} className="mt-4 text-xs font-semibold text-purple-300 underline underline-offset-4">Start another operation</button>}
        </aside>
      </div>
    </div>
  )
}
