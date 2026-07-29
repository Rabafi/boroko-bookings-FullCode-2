import { useCallback, useEffect, useMemo, useState } from 'react'
import { Plus, RefreshCw, Scale, Sparkles } from 'lucide-react'
import { useAccess } from '../../app-context'
import { canAccessCapability } from '../../../../shared/accessControl'
import { AccountingButton, AccountingError, AccountingLoading, AccountingNotice, AccountingPage, AccountingPanel, EmptyState, accountingInvoke, inputClass, labelClass, money, runIdempotent, today, unwrap } from './RestaurantAccountingUi'

const blankAccount = { code: '', name: '', accountType: 'asset', parentId: '', description: '' }
const blankOpening = { accountId: '', equityAccountId: '', entryDate: today(), amount: '' }

export default function RestaurantChartOfAccounts() {
  const access = useAccess()
  const canManage = canAccessCapability(access, 'accounting.manage')
  const [accounts, setAccounts] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState('')
  const [account, setAccount] = useState(blankAccount)
  const [opening, setOpening] = useState(blankOpening)

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try { setAccounts(unwrap(await accountingInvoke('getAccounts'), [])) }
    catch (e) { setError(e.message) }
    finally { setLoading(false) }
  }, [])
  useEffect(() => { load() }, [load])

  const grouped = useMemo(() => ['asset','liability','equity','revenue','expense'].map(type => [type, accounts.filter(a => a.account_type === type)]), [accounts])
  const activeEquity = accounts.filter(a => a.account_type === 'equity' && a.is_active)

  const create = async (event) => {
    event.preventDefault(); setBusy('create'); setError(''); setNotice('')
    try {
      await accountingInvoke('createAccount', { ...account, parentId: account.parentId || null })
      setAccount(blankAccount); setNotice('Account created. No balance was invented; opening value must be posted as a dated journal below.'); await load()
    } catch (e) { setError(e.message) } finally { setBusy('') }
  }
  const postOpening = async (event) => {
    event.preventDefault(); setBusy('opening'); setError(''); setNotice('')
    try {
      await runIdempotent(`opening:${opening.accountId}:${opening.entryDate}`, operationKey => accountingInvoke('postOpeningBalance', { ...opening, amount: Number(opening.amount), operationKey }))
      setOpening(blankOpening); setNotice('Opening balance posted as a balanced, immutable journal.'); await load()
    } catch (e) { setError(e.message) } finally { setBusy('') }
  }
  const seed = async () => {
    setBusy('seed'); setError(''); setNotice('')
    try { await accountingInvoke('seedAccounts'); setNotice('Default accounts are available. Existing codes were not duplicated.'); await load() }
    catch (e) { setError(e.message) } finally { setBusy('') }
  }
  const classify = async (item, classification) => {
    setBusy(item.id); setError('')
    try { await accountingInvoke('setCashFlow', item.id, classification); setNotice('Cash-flow classification saved.'); await load() } catch (e) { setError(e.message) } finally { setBusy('') }
  }

  const deactivate = async (item) => {
    if (!window.confirm(`Deactivate ${item.code} — ${item.name}? Historical journal activity remains intact.`)) return
    setBusy(item.id); setError('')
    try { await accountingInvoke('deleteAccount', item.id); await load() } catch (e) { setError(e.message) } finally { setBusy('') }
  }

  return <AccountingPage title="Chart of accounts" description="Create the business-scoped account structure used by every accounting workflow. Posted history remains immutable when an account is deactivated." actions={<AccountingButton tone="secondary" onClick={load}><RefreshCw size={15}/>Refresh</AccountingButton>}>
    <AccountingNotice>Balances shown here are ledger-derived. Opening balances require an account, an equity offset, a date, and a retry-safe journal posting.</AccountingNotice>
    {error && <AccountingNotice type="error">{error}</AccountingNotice>}{notice && <AccountingNotice type="success">{notice}</AccountingNotice>}
    {loading ? <AccountingLoading/> : <>
      <div className="grid gap-4 xl:grid-cols-[1.6fr_1fr]">
        <AccountingPanel title="Accounts" actions={canManage && <AccountingButton tone="secondary" busy={busy==='seed'} onClick={seed}><Sparkles size={15}/>Seed defaults</AccountingButton>}>
          {accounts.length === 0 ? <EmptyState title="No accounts configured" description="Seed the standard chart or create the first account."/> :
            <div className="space-y-5">{grouped.map(([type, rows]) => rows.length > 0 && <div key={type}><h3 className="mb-2 text-xs font-black uppercase tracking-wider text-slate-500">{type}</h3><div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="border-b text-left text-xs text-slate-500"><th className="py-2">Code</th><th>Name</th><th className="text-right">Balance</th><th>Status</th><th/></tr></thead><tbody>{rows.map(row => <tr key={row.id} className="border-b border-slate-100"><td className="py-2 font-mono font-bold">{row.code}</td><td>{row.name}</td><td className="text-right font-semibold">{money(row.balance)}</td><td>{row.is_active ? 'Active' : 'Inactive'}</td><td className="text-right">{canManage && row.is_active && <div className="flex justify-end gap-2"><select aria-label={`Cash-flow classification for ${row.name}`} className="rounded border border-slate-200 px-2 py-1 text-xs" value={row.cash_flow_classification||''} onChange={e=>classify(row,e.target.value)}><option value="">Cash-flow class</option>{row.account_type==='asset'&&<option value="cash">cash</option>}<option value="operating">operating</option><option value="investing">investing</option><option value="financing">financing</option></select><button className="text-xs font-bold text-rose-700" disabled={busy===row.id} onClick={()=>deactivate(row)}>Deactivate</button></div>}</td></tr>)}</tbody></table></div></div>)}</div>}
        </AccountingPanel>
        <div className="space-y-4">
          <AccountingPanel title="Create account" description="Account codes are unique within this company.">
            {!canManage ? <AccountingNotice type="warning">You have read-only Accounting access.</AccountingNotice> : <form className="space-y-3" onSubmit={create}>
              <label className={labelClass}>Code<input required className={inputClass} value={account.code} onChange={e=>setAccount({...account,code:e.target.value})}/></label>
              <label className={labelClass}>Name<input required className={inputClass} value={account.name} onChange={e=>setAccount({...account,name:e.target.value})}/></label>
              <label className={labelClass}>Type<select className={inputClass} value={account.accountType} onChange={e=>setAccount({...account,accountType:e.target.value})}>{['asset','liability','equity','revenue','expense'].map(x=><option key={x}>{x}</option>)}</select></label>
              <label className={labelClass}>Parent (optional)<select className={inputClass} value={account.parentId} onChange={e=>setAccount({...account,parentId:e.target.value})}><option value="">None</option>{accounts.filter(a=>a.is_active).map(a=><option key={a.id} value={a.id}>{a.code} — {a.name}</option>)}</select></label>
              <label className={labelClass}>Description<textarea className={inputClass} value={account.description} onChange={e=>setAccount({...account,description:e.target.value})}/></label>
              <AccountingButton busy={busy==='create'}><Plus size={15}/>Create account</AccountingButton>
            </form>}
          </AccountingPanel>
          <AccountingPanel title="Post opening balance" description="Creates a dated double-entry journal against equity.">
            {!canManage ? <AccountingNotice type="warning">Manage permission is required.</AccountingNotice> : <form className="space-y-3" onSubmit={postOpening}>
              <label className={labelClass}>Account<select required className={inputClass} value={opening.accountId} onChange={e=>setOpening({...opening,accountId:e.target.value})}><option value="">Select</option>{accounts.filter(a=>a.is_active).map(a=><option key={a.id} value={a.id}>{a.code} — {a.name}</option>)}</select></label>
              <label className={labelClass}>Equity offset<select required className={inputClass} value={opening.equityAccountId} onChange={e=>setOpening({...opening,equityAccountId:e.target.value})}><option value="">Select</option>{activeEquity.map(a=><option key={a.id} value={a.id}>{a.code} — {a.name}</option>)}</select></label>
              <label className={labelClass}>Entry date<input required type="date" className={inputClass} value={opening.entryDate} onChange={e=>setOpening({...opening,entryDate:e.target.value})}/></label>
              <label className={labelClass}>Amount<input required type="number" step="0.01" min="0.01" className={inputClass} value={opening.amount} onChange={e=>setOpening({...opening,amount:e.target.value})}/></label>
              <AccountingButton busy={busy==='opening'}><Scale size={15}/>Post balanced opening</AccountingButton>
            </form>}
          </AccountingPanel>
        </div>
      </div>
    </>}
  </AccountingPage>
}

