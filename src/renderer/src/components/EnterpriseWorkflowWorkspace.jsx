import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, CheckCircle2, ClipboardList, Save, ShieldCheck } from 'lucide-react'
import { getEnterpriseWorkflow } from '../../../shared/enterpriseWorkflows'

function storageKey(workflowKey) {
  return `bb:enterprise-workflow:${workflowKey}`
}

function readDraft(workflowKey, fallback) {
  try {
    const raw = window.localStorage.getItem(storageKey(workflowKey))
    return raw ? { ...fallback, ...JSON.parse(raw) } : fallback
  } catch {
    return fallback
  }
}

function writeDraft(workflowKey, value) {
  try {
    window.localStorage.setItem(storageKey(workflowKey), JSON.stringify(value))
    return true
  } catch {
    return false
  }
}

export default function EnterpriseWorkflowWorkspace({ workflowKey }) {
  const workflow = getEnterpriseWorkflow(workflowKey)
  const initial = useMemo(() => ({
    owner: '',
    targetDate: '',
    notes: '',
    completed: [],
    updatedAt: null
  }), [])
  const [draft, setDraft] = useState(initial)
  const [saved, setSaved] = useState(false)
  const [source, setSource] = useState('local')
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false

    async function load() {
      setSaved(false)
      setError('')
      const localDraft = readDraft(workflowKey, initial)
      setDraft(localDraft)
      setSource('local')

      try {
        if (!window.api?.enterpriseOperations?.getRecords) return
        const records = await window.api.enterpriseOperations.getRecords(workflowKey)
        if (cancelled) return
        const setupRecord = Array.isArray(records)
          ? records.find((record) => record.record_key === 'setup-readiness')
          : null
        if (setupRecord?.payload) {
          setDraft({ ...initial, ...setupRecord.payload })
          setSource('server')
        }
      } catch (loadError) {
        if (!cancelled) setError(loadError?.message || 'Could not load saved Enterprise workflow records.')
      }
    }

    load()
    return () => {
      cancelled = true
    }
  }, [workflowKey, initial])

  if (!workflow) {
    return (
      <div className="bb-page">
        <div className="bb-card p-8">
          <h1 className="text-xl font-bold text-slate-900">Enterprise workspace not found</h1>
        </div>
      </div>
    )
  }

  const completed = new Set(draft.completed || [])
  const completion = workflow.defaultTasks.length
    ? Math.round((completed.size / workflow.defaultTasks.length) * 100)
    : 0
  const launchGates = Array.isArray(workflow.launchGates) ? workflow.launchGates : []
  const blockingGates = launchGates.filter((gate) => gate.status !== 'verified')
  const activationBlocked = blockingGates.length > 0

  const toggleTask = (task) => {
    setDraft((current) => {
      const next = new Set(current.completed || [])
      if (next.has(task)) next.delete(task)
      else next.add(task)
      return { ...current, completed: [...next] }
    })
  }

  const save = async () => {
    const next = { ...draft, updatedAt: new Date().toISOString() }
    setError('')
    writeDraft(workflow.key, next)

    try {
      if (window.api?.enterpriseOperations?.upsertRecord) {
        await window.api.enterpriseOperations.upsertRecord(workflow.key, {
          record_key: 'setup-readiness',
          status: completion >= 100 ? 'ready_for_activation' : 'in_progress',
          ...next
        })
        await window.api.enterpriseOperations.appendEvent(workflow.key, {
          event_type: 'setup_readiness_saved',
          completion,
          owner: next.owner,
          targetDate: next.targetDate
        })
        setSource('server')
      } else {
        setSource('local')
      }
      setDraft(next)
      setSaved(true)
      setTimeout(() => setSaved(false), 1800)
    } catch (saveError) {
      setSource('local')
      setDraft(next)
      setError(`${saveError?.message || 'Could not save to Enterprise operations.'} Local draft was kept.`)
    }
  }

  return (
    <div className="bb-page space-y-5">
      <div className="bb-page-header">
        <div>
          <p className="bb-section-kicker">ENTERPRISE WORKFLOW</p>
          <h1 className="bb-page-header-title">{workflow.title}</h1>
          <p className="bb-page-header-subtitle">{workflow.summary}</p>
        </div>
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-right">
          <p className="text-xs font-semibold uppercase text-emerald-700">Readiness</p>
          <p className="text-2xl font-bold text-emerald-900">{completion}%</p>
          {activationBlocked && <p className="mt-1 text-xs font-semibold text-amber-700">Launch blocked</p>}
        </div>
      </div>

      <section className="bb-card p-5">
        <div className="flex items-center gap-2">
          <ShieldCheck size={17} className="text-emerald-700" />
          <h2 className="text-sm font-bold text-slate-900">Controlled Activation</h2>
        </div>
        <p className="mt-2 text-sm leading-6 text-slate-600">
          This workspace prepares the workflow for sale and activation. It does not bypass entitlement checks, server-side financial authority, RLS, or Command Central approval.
        </p>
        <p className="mt-2 text-xs font-semibold uppercase text-slate-500">
          Save source: {source === 'server' ? 'Enterprise operations' : 'local draft'}
        </p>
        {error && <p className="mt-2 text-sm text-amber-700">{error}</p>}
      </section>

      {launchGates.length > 0 && (
        <section className="bb-card p-5">
          <div className="flex items-center gap-2">
            <AlertTriangle size={17} className="text-amber-600" />
            <h2 className="text-sm font-bold text-slate-900">Launch Gates</h2>
          </div>
          <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-2">
            {launchGates.map((gate) => (
              <div key={gate.key} className={`rounded-xl border p-4 ${gate.status === 'verified' ? 'border-emerald-200 bg-emerald-50' : 'border-amber-200 bg-amber-50'}`}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className={`text-sm font-bold ${gate.status === 'verified' ? 'text-emerald-900' : 'text-amber-900'}`}>{gate.label}</p>
                    <p className={`mt-1 text-xs leading-5 ${gate.status === 'verified' ? 'text-emerald-700' : 'text-amber-800'}`}>{gate.detail}</p>
                  </div>
                  <span className={`shrink-0 rounded-full px-2 py-1 text-[10px] font-bold uppercase ${gate.status === 'verified' ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}`}>
                    {gate.status.replaceAll('_', ' ')}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[1fr_360px]">
        <section className="bb-card p-5">
          <div className="flex items-center gap-2">
            <ClipboardList size={17} className="text-slate-600" />
            <h2 className="text-sm font-bold text-slate-900">Launch Tasks</h2>
          </div>
          <div className="mt-4 space-y-2">
            {workflow.defaultTasks.map((task) => (
              <label key={task} className="flex cursor-pointer items-start gap-3 rounded-xl border border-slate-200 p-3 hover:bg-slate-50">
                <input
                  type="checkbox"
                  checked={completed.has(task)}
                  onChange={() => toggleTask(task)}
                  className="mt-1"
                />
                <span className="text-sm text-slate-700">{task}</span>
              </label>
            ))}
          </div>
        </section>

        <aside className="space-y-5">
          <section className="bb-card p-5">
            <h2 className="text-sm font-bold text-slate-900">Setup Notes</h2>
            <div className="mt-3 space-y-3">
              <input
                className="input"
                value={draft.owner}
                onChange={(event) => setDraft((current) => ({ ...current, owner: event.target.value }))}
                placeholder="Owner / responsible person"
              />
              <input
                className="input"
                type="date"
                value={draft.targetDate}
                onChange={(event) => setDraft((current) => ({ ...current, targetDate: event.target.value }))}
              />
              <textarea
                className="input"
                rows={6}
                value={draft.notes}
                onChange={(event) => setDraft((current) => ({ ...current, notes: event.target.value }))}
                placeholder="Implementation notes, customer decisions, provider details, launch risks..."
              />
              <button type="button" onClick={save} className="btn-primary w-full justify-center">
                {saved ? <CheckCircle2 size={15} /> : <Save size={15} />}
                {saved ? 'Saved' : 'Save Workspace'}
              </button>
            </div>
          </section>

          <section className="bb-card p-5">
            <h2 className="text-sm font-bold text-slate-900">Scope</h2>
            <div className="mt-3 flex flex-wrap gap-2">
              {workflow.sections.map((section) => (
                <span key={section} className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-600">
                  {section}
                </span>
              ))}
            </div>
          </section>
        </aside>
      </div>
    </div>
  )
}
