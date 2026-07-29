import { useCallback, useEffect, useMemo, useState } from 'react'
import { Building2, CalendarDays, RefreshCw, TrendingUp } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { useFeatures } from '../contexts/FeaturesContext'
import { listCorporateAccountsPwa, listHotelRatePlans } from '../lib/api'
import { money, shortDate, titleCase } from '../lib/format'
import DataFreshness from '../components/DataFreshness'
import EmptyState from '../components/EmptyState'
import MobileBoundaryNotice from '../components/MobileBoundaryNotice'

function RatePlans({ plans, accounts }) {
  const accountNames = useMemo(() => new Map(accounts.map((account) => [account.id, account.company_name])), [accounts])
  if (plans.length === 0) return <EmptyState icon={TrendingUp} title="No rate plans" message="Active seasonal, corporate, and package rates will appear here." />
  return <div className="space-y-2">{plans.map((plan) => <div key={plan.id} className="rounded-2xl bg-gray-800 px-4 py-3"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="truncate text-sm font-semibold text-white">{plan.name}</p><p className="mt-1 text-xs text-gray-500">{plan.description || 'Hotel rate plan'} · {titleCase(plan.status || 'active')}</p></div><p className="shrink-0 text-sm font-bold text-amber-200">{money(plan.rate_amount, plan.currency || 'P')}</p></div><p className="mt-2 text-xs text-gray-400">{plan.valid_from ? shortDate(plan.valid_from) : 'Any date'} → {plan.valid_to ? shortDate(plan.valid_to) : 'Open ended'} · Min. {plan.min_stay || 1} night{Number(plan.min_stay || 1) === 1 ? '' : 's'}{plan.corporate_account_id ? ` · ${accountNames.get(plan.corporate_account_id) || 'Corporate rate'}` : ''}</p></div>)}</div>
}

function CorporateAccounts({ accounts }) {
  if (accounts.length === 0) return <EmptyState icon={Building2} title="No corporate accounts" message="Company accounts configured at Front Desk will appear here." />
  return <div className="space-y-2">{accounts.map((account) => <div key={account.id} className="rounded-2xl bg-gray-800 px-4 py-3"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="truncate text-sm font-semibold text-white">{account.company_name}</p><p className="mt-1 truncate text-xs text-gray-500">{account.contact_name || account.contact_email || account.contact_phone || 'No contact detail'}</p></div><p className="shrink-0 text-xs font-semibold text-gray-300">{titleCase(account.status || 'active')}</p></div><p className="mt-2 text-xs text-gray-400">Credit limit {money(account.credit_limit)} · {account.payment_terms_days || 30}-day terms</p></div>)}</div>
}

export default function HotelRevenue() {
  const { user } = useAuth()
  const { can } = useFeatures()
  const [tab, setTab] = useState(can('rate_plans.view') ? 'rates' : 'corporate')
  const [plans, setPlans] = useState([])
  const [accounts, setAccounts] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [updatedAt, setUpdatedAt] = useState(null)
  const showRates = can('rate_plans.view')
  const showCorporate = can('corporate_accounts.view')

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const [nextPlans, nextAccounts] = await Promise.all([showRates ? listHotelRatePlans(user.lodge_id) : Promise.resolve([]), showCorporate ? listCorporateAccountsPwa(user.lodge_id) : Promise.resolve([])])
      setPlans(nextPlans); setAccounts(nextAccounts); setUpdatedAt(new Date().toISOString())
    } catch (loadError) { setError(loadError?.message || 'Hotel revenue data could not load.') } finally { setLoading(false) }
  }, [showCorporate, showRates, user.lodge_id])

  useEffect(() => { load() }, [load])
  useEffect(() => { if (tab === 'rates' && !showRates) setTab('corporate'); if (tab === 'corporate' && !showCorporate) setTab('rates') }, [showCorporate, showRates, tab])

  return <div className="min-h-screen bg-gray-950 pb-24"><header className="bg-gray-900 px-4 pb-4 pt-12"><div className="flex items-start justify-between gap-3"><div><h1 className="text-lg font-bold text-white">Rates & Corporate</h1><p className="mt-1 text-xs text-gray-400">Live hotel pricing and company-account reference</p><DataFreshness updatedAt={updatedAt} loading={loading} error={error} className="mt-1" /></div><button type="button" onClick={load} className="rounded-full bg-white/5 p-2 text-gray-300" aria-label="Refresh hotel revenue"><RefreshCw size={18} className={loading ? 'animate-spin' : ''} /></button></div>{(showRates && showCorporate) ? <div className="mt-4 grid grid-cols-2 rounded-xl bg-gray-800 p-1"><button type="button" onClick={() => setTab('rates')} className={`flex items-center justify-center gap-1.5 rounded-lg px-2 py-2 text-xs font-semibold ${tab === 'rates' ? 'bg-gray-700 text-white' : 'text-gray-400'}`}><CalendarDays size={14} />Rate plans</button><button type="button" onClick={() => setTab('corporate')} className={`flex items-center justify-center gap-1.5 rounded-lg px-2 py-2 text-xs font-semibold ${tab === 'corporate' ? 'bg-gray-700 text-white' : 'text-gray-400'}`}><Building2 size={14} />Corporate</button></div> : null}</header><main className="space-y-3 px-4 py-4">{error ? <div className="rounded-2xl border border-red-900 bg-red-950/40 px-4 py-3 text-sm text-red-200">{error}</div> : null}{loading ? <p className="py-10 text-center text-sm text-gray-500">Loading hotel revenue data…</p> : tab === 'rates' ? <RatePlans plans={plans} accounts={accounts} /> : <CorporateAccounts accounts={accounts} />}<MobileBoundaryNotice compact>These are live, lodge-scoped reference records. Creating or changing rates, credit limits, corporate billing, and settlements remains in the controlled Front Desk workflow.</MobileBoundaryNotice></main></div>
}
