import { useCallback, useEffect, useState } from 'react'
import { RefreshCw, WalletCards } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { getCustomerCreditSummaryPwa } from '../lib/api'
import { money } from '../lib/format'
import EmptyState from '../components/EmptyState'
import MobileBoundaryNotice from '../components/MobileBoundaryNotice'

export default function Prepayments() {
  const { user } = useAuth(); const [rows, setRows] = useState([]); const [loading, setLoading] = useState(true); const [error, setError] = useState('')
  const load = useCallback(async () => { setLoading(true); setError(''); try { setRows(await getCustomerCreditSummaryPwa(user.lodge_id, '', 100, 0)) } catch (loadError) { setError(loadError?.message || 'Customer credit could not load.') } finally { setLoading(false) } }, [user.lodge_id])
  useEffect(() => { load() }, [load])
  const balanceLabel = (row) => { const value = row?.available_balance ?? row?.balance; const amount = value === null || value === undefined || value === '' ? null : Number(value); return Number.isFinite(amount) ? money(amount) : 'Unavailable' }
  return <div className="min-h-screen bg-gray-950 pb-24"><header className="bg-gray-900 px-4 pb-4 pt-12"><div className="flex items-start justify-between gap-3"><div><h1 className="text-lg font-bold text-white">Guest Deposits</h1><p className="mt-1 text-xs text-gray-400">Live, server-confirmed customer-credit balances</p></div><button onClick={load} className="rounded-full bg-white/5 p-2 text-gray-300"><RefreshCw size={18} className={loading ? 'animate-spin' : ''} /></button></div><div className="mt-4 rounded-2xl bg-amber-950/45 p-4"><p className="text-xs text-amber-200">Read-only mobile oversight</p><p className="mt-1 text-sm font-semibold text-white">Portfolio total is unavailable in this view; every balance below is returned by the server.</p></div></header><main className="space-y-2 px-4 py-4">{error ? <div className="rounded-2xl border border-red-900 bg-red-950/40 px-4 py-3 text-sm text-red-200">{error}</div> : null}{!loading && rows.length === 0 ? <EmptyState icon={WalletCards} title="No guest deposit balances" message="Guest deposit balances will appear here after they are received at Front Desk." /> : rows.map((row) => <div key={row.customer_id || row.id} className="flex items-center justify-between gap-3 rounded-2xl bg-gray-800 px-4 py-3"><div className="min-w-0"><p className="truncate text-sm font-semibold text-white">{row.customer_name || row.name || 'Customer'}</p><p className="mt-1 text-xs text-gray-500">{row.customer_phone || row.phone || 'Customer credit'}</p></div><p className="shrink-0 text-sm font-bold text-amber-200">{balanceLabel(row)}</p></div>)}<MobileBoundaryNotice compact>Balances are live and authoritative. Receiving, allocating, refunding, reversing, reconciling, exporting, matching, and configuring Guest Deposits remain in the controlled desktop workflow.</MobileBoundaryNotice></main></div>
}
