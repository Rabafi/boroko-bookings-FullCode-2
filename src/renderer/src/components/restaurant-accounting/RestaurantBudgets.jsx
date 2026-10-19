import { useCallback, useEffect, useMemo, useState } from 'react'
import { CheckCircle2, Copy, RefreshCw, Save } from 'lucide-react'
import { useAccess } from '../../app-context'
import { canAccessCapability } from '../../../../shared/accessControl'
import { AccountingButton, AccountingExportButton, AccountingLoading, AccountingNotice, AccountingPage, AccountingPanel, EmptyState, accountingInvoke, inputClass, labelClass, money, runIdempotent, unwrap } from './RestaurantAccountingUi'
import { normalizeBudgetResponse } from './budgetResponse'

const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const emptyData = { matrix: [], templates: [], version_id: null, version_status: null, complete: false }

export default function RestaurantBudgets() {
  const access = useAccess()
  const canManage = canAccessCapability(access, 'accounting.manage')
  const [year, setYear] = useState(new Date().getFullYear())
  const [data, setData] = useState(emptyData)
  const [draft, setDraft] = useState({})
  const [template, setTemplate] = useState({ name: '', description: '', accountId: '', defaultAmount: '' })
  const [apply, setApply] = useState({ templateId: '', month: new Date().getMonth() + 1 })
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [budgetDataValid, setBudgetDataValid] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    setBudgetDataValid(false)
    try {
      const response = unwrap(await accountingInvoke('getBudgets', Number(year)))
      const normalized = normalizeBudgetResponse(response)
      setData(normalized.data)
      setBudgetDataValid(normalized.valid)
      setError(normalized.error)
      const nextDraft = {}
      normalized.data.matrix.forEach((row) => {
        for (let month = 1; month <= 12; month += 1) nextDraft[`${row.account_id}:${month}`] = String(row.months[month] ?? 0)
      })
      setDraft(nextDraft)
    } catch (loadError) {
      setData(emptyData)
      setDraft({})
      setError(loadError?.message || 'Budget data could not be loaded. Saving and approval are disabled.')
    } finally {
      setLoading(false)
    }
  }, [year])

  useEffect(() => { load() }, [load])

  const entries = useMemo(() => data.matrix.flatMap((row) => months.map((_, index) => ({
    account_id: row.account_id,
    month: index + 1,
    amount: Number(draft[`${row.account_id}:${index + 1}`] || 0)
  }))), [data.matrix, draft])

  const save = async () => {
    if (!budgetDataValid || !data.complete || year < 2000 || year > 2100) return
    setBusy('save')
    setError('')
    try {
      await runIdempotent(`budget-matrix:${year}`, (key) => accountingInvoke('saveBudgets', Number(year), entries, key))
      setNotice(`The complete ${year} budget matrix was saved atomically.`)
      await load()
    } catch (saveError) {
      setError(saveError.message)
    } finally {
      setBusy('')
    }
  }

  const approve = async () => {
    if (!budgetDataValid || !data.complete || !data.version_id) return
    setBusy('approve')
    setError('')
    try {
      await accountingInvoke('approveBudgetVersion', data.version_id)
      setNotice('The budget version was approved.')
      await load()
    } catch (approvalError) {
      setError(approvalError.message)
    } finally {
      setBusy('')
    }
  }

  const createTemplate = async (event) => {
    event.preventDefault()
    if (!budgetDataValid) return
    setBusy('template')
    setError('')
    try {
      await runIdempotent(`budget-template:${template.name}`, (operationKey) => accountingInvoke('createBudgetTemplate', {
        name: template.name,
        description: template.description,
        operationKey,
        lines: [{ account_id: template.accountId, default_amount: Number(template.defaultAmount) }]
      }))
      setTemplate({ name: '', description: '', accountId: '', defaultAmount: '' })
      setNotice('Budget template saved with lodge-validated account ownership.')
      await load()
    } catch (templateError) {
      setError(templateError.message)
    } finally {
      setBusy('')
    }
  }

  const applyTemplate = async (event) => {
    event.preventDefault()
    if (!budgetDataValid || year < 2000 || year > 2100) return
    setBusy('apply')
    setError('')
    try {
      await runIdempotent(`budget-template-apply:${apply.templateId}:${year}:${apply.month}`, (operationKey) => accountingInvoke('applyBudgetTemplate', {
        templateId: apply.templateId,
        year: Number(year),
        month: Number(apply.month),
        operationKey
      }))
      setNotice('Template applied atomically to the selected month.')
      await load()
    } catch (templateError) {
      setError(templateError.message)
    } finally {
      setBusy('')
    }
  }

  const yearValid = Number.isInteger(year) && year >= 2000 && year <= 2100

  return <AccountingPage
    title="Budgets"
    description="Maintain a complete monthly revenue and expense matrix. Every account is lodge-validated and each save is atomic and retry-safe."
    actions={<>
      <AccountingExportButton fileName={`budget-${year}`} exportOperation="exportBudgets" exportArgs={[Number(year)]} disabled={!budgetDataValid} onError={setError} />
      <input aria-label="Budget year" type="number" min="2000" max="2100" className={`${inputClass} w-28`} value={year} onChange={(event) => setYear(Number(event.target.value))} />
      <AccountingButton tone="secondary" onClick={load}><RefreshCw size={15} />Refresh</AccountingButton>
      {canManage && <AccountingButton disabled={!budgetDataValid || !data.complete || !yearValid} busy={busy === 'save'} onClick={save}><Save size={15} />Save matrix</AccountingButton>}
      {canManage && data.version_id && data.version_status === 'draft' && <AccountingButton disabled={!budgetDataValid || !data.complete} tone="amber" busy={busy === 'approve'} onClick={approve}><CheckCircle2 size={15} />Approve version</AccountingButton>}
    </>}
  >
    <AccountingNotice>Only active revenue and expense accounts accept new budgets. Deactivating an account never removes historical statement activity. Version: {data.version_id ? `${data.version_status || 'draft'} · ${data.version_id}` : 'legacy/unversioned'}</AccountingNotice>
    {error && <AccountingNotice type="error">{error}</AccountingNotice>}
    {notice && <AccountingNotice type="success">{notice}</AccountingNotice>}
    {loading ? <AccountingLoading /> : <div className="space-y-4">
      <AccountingPanel title={`${year} monthly matrix`}>
        {data.matrix.length === 0 ? <EmptyState title="No active revenue or expense accounts" description="Configure the Chart of Accounts first." /> : <div className="overflow-x-auto"><table className="min-w-[1300px] w-full text-xs"><thead><tr className="border-b text-left text-slate-500"><th className="sticky left-0 bg-white py-2">Account</th>{months.map((month) => <th key={month} className="text-right">{month}</th>)}<th className="text-right">Annual</th></tr></thead><tbody>{data.matrix.map((row) => {
          const total = months.reduce((sum, _, index) => sum + Number(draft[`${row.account_id}:${index + 1}`] || 0), 0)
          return <tr key={row.account_id} className="border-b border-slate-100"><td className="sticky left-0 bg-white py-2 pr-3"><b>{row.code}</b> — {row.name}</td>{months.map((_, index) => <td key={index} className="pl-2"><input disabled={!canManage || !budgetDataValid} aria-label={`${row.name} ${months[index]}`} type="number" min="0" step="0.01" className="w-20 rounded border border-slate-200 px-2 py-1 text-right disabled:bg-slate-50" value={draft[`${row.account_id}:${index + 1}`] ?? '0'} onChange={(event) => setDraft({ ...draft, [`${row.account_id}:${index + 1}`]: event.target.value })} /></td>)}<td className="text-right font-bold">{money(total)}</td></tr>
        })}</tbody></table></div>}
      </AccountingPanel>
      {canManage && <div className="grid gap-4 xl:grid-cols-2">
        <AccountingPanel title="Create reusable template" description="Start with one default account line; additional templates can be created for other lines.">
          <form className="space-y-3" onSubmit={createTemplate}>
            <label className={labelClass}>Template name<input required className={inputClass} value={template.name} onChange={(event) => setTemplate({ ...template, name: event.target.value })} /></label>
            <label className={labelClass}>Description<input className={inputClass} value={template.description} onChange={(event) => setTemplate({ ...template, description: event.target.value })} /></label>
            <label className={labelClass}>Account<select required className={inputClass} value={template.accountId} onChange={(event) => setTemplate({ ...template, accountId: event.target.value })}><option value="">Select</option>{data.matrix.map((account) => <option key={account.account_id} value={account.account_id}>{account.code} — {account.name}</option>)}</select></label>
            <label className={labelClass}>Monthly default<input required type="number" min="0" step="0.01" className={inputClass} value={template.defaultAmount} onChange={(event) => setTemplate({ ...template, defaultAmount: event.target.value })} /></label>
            <AccountingButton disabled={!budgetDataValid} busy={busy === 'template'} type="submit">Create template</AccountingButton>
          </form>
        </AccountingPanel>
        <AccountingPanel title="Apply template to one month">
          <form className="space-y-3" onSubmit={applyTemplate}>
            <label className={labelClass}>Template<select required className={inputClass} value={apply.templateId} onChange={(event) => setApply({ ...apply, templateId: event.target.value })}><option value="">Select</option>{data.templates.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
            <label className={labelClass}>Month<select className={inputClass} value={apply.month} onChange={(event) => setApply({ ...apply, month: Number(event.target.value) })}>{months.map((month, index) => <option key={month} value={index + 1}>{month}</option>)}</select></label>
            <AccountingButton disabled={!budgetDataValid || !yearValid} busy={busy === 'apply'} type="submit"><Copy size={15} />Apply atomically</AccountingButton>
          </form>
        </AccountingPanel>
      </div>}
    </div>}
  </AccountingPage>
}