import { createElement, useCallback, useEffect, useMemo, useState } from 'react'
import { Activity, AlertTriangle, ArrowDownRight, ArrowUpRight, BarChart3, Check, ChevronDown, Clock3, Copy, Link2, LogOut, RefreshCw, ShoppingBag, TrendingUp } from 'lucide-react'
import {
  approveBarOwnerLink,
  clearBarOwnerSession,
  createBarOwnerEnrollment,
  getBarOwnerBars,
  getBarOwnerOperations,
  getBarOwnerSales,
  getBarOwnerSession,
  loginBarOwner,
  registerBarOwner,
  revokeBarOwnerLink
} from '../lib/barOwner'

function businessDate(offset = 0) {
  const date = new Date()
  date.setDate(date.getDate() + offset)
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Gaborone', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date)
}

/** @param {string|null|undefined} value */
function formatMoney(value) {
  if (typeof value !== 'string' || !/^-?\d+(?:\.\d{1,2})?$/.test(value)) return 'Unavailable'
  const negative = value.startsWith('-')
  const [whole = '0', decimals = ''] = value.replace(/^-/, '').split('.')
  const cents = decimals.padEnd(2, '0')
  const grouped = new Intl.NumberFormat('en-BW', { maximumFractionDigits: 0 }).format(BigInt(whole))
  return `BWP ${negative ? '-' : ''}${grouped}.${cents}`
}

function eventLabel(type) {
  return ({
    'sale.committed': 'Sale committed',
    'sale.returned': 'Return',
    'sale.voided': 'Void',
    'sale.corrected_after_close': 'Post-close correction'
  })[type] || 'Bar update'
}

/** @param {{label: string, value: string, detail: string, tone: string, icon: import('lucide-react').LucideIcon}} props */
function Metric({ label, value, detail, tone, icon: Icon }) {
  return (
    <div className={`rounded-2xl border ${tone} p-4 shadow-sm`}>
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-semibold uppercase tracking-wide opacity-80">{label}</p>
        {createElement(Icon, { size: 18, 'aria-hidden': true })}
      </div>
      <p className="mt-3 break-words text-xl font-bold tabular-nums sm:text-2xl">{value}</p>
      <p className="mt-1 text-xs opacity-75">{detail}</p>
    </div>
  )
}

/** @param {{days: import('../lib/barOwner').BarOwnerDay[]}} props */
function SalesChart({ days }) {
  const points = useMemo(() => days.map((day) => ({
    date: day.business_date,
    gross: Number(day.gross_sales),
    net: Number(day.net_sales)
  })), [days])
  const max = Math.max(1, ...points.flatMap((point) => [point.gross, point.net]))
  const width = Math.max(360, points.length * 30)
  const height = 188
  const pad = { top: 14, right: 12, bottom: 28, left: 12 }
  const plotWidth = width - pad.left - pad.right
  const plotHeight = height - pad.top - pad.bottom
  const x = (index) => pad.left + (points.length <= 1 ? plotWidth / 2 : index * plotWidth / (points.length - 1))
  const y = (value) => pad.top + plotHeight - Math.max(0, value / max) * plotHeight
  const netPath = points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${x(index)} ${y(point.net)}`).join(' ')
  const grossPath = points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${x(index)} ${y(point.gross)}`).join(' ')
  const labelIndexes = points.length <= 7 ? points.map((_, index) => index) : [0, Math.round((points.length - 1) / 2), points.length - 1]

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm" aria-labelledby="bar-sales-chart-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="bar-sales-chart-title" className="font-bold text-slate-900">Sales and adjustments</h2>
          <p className="mt-1 text-xs text-slate-500">Gross receipts and net receipts by local business date</p>
        </div>
        <div className="flex gap-4 text-xs font-medium text-slate-600" aria-label="Chart legend">
          <span className="flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-full bg-emerald-500" />Gross receipts</span>
          <span className="flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-full bg-blue-600" />Net receipts</span>
        </div>
      </div>
      {points.length === 0 ? (
        <div className="mt-4 rounded-xl bg-slate-50 p-6 text-center text-sm text-slate-500">No received sale or correction events in this date range.</div>
      ) : (
        <>
          <div className="mt-4 overflow-x-auto" role="img" aria-label={`Daily gross and net receipts across ${points.length} business dates. The exact values are available in the table below.`}>
            <svg viewBox={`0 0 ${width} ${height}`} className="bar-projection-chart min-w-full" style={{ minWidth: `${Math.min(width, 900)}px` }} aria-hidden="true" focusable="false">
              {[0.25, 0.5, 0.75, 1].map((ratio) => <line key={ratio} x1={pad.left} x2={width - pad.right} y1={y(max * ratio)} y2={y(max * ratio)} stroke="#e2e8f0" strokeDasharray="3 5" />)}
              <path d={grossPath} fill="none" stroke="#10b981" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="bar-projection-chart-gross" />
              <path d={netPath} fill="none" stroke="#2563eb" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="bar-projection-chart-net" />
              {labelIndexes.map((index) => <text key={points[index].date} x={x(index)} y={height - 7} textAnchor={index === 0 ? 'start' : index === points.length - 1 ? 'end' : 'middle'} fill="#64748b" fontSize="10">{points[index].date.slice(5)}</text>)}
            </svg>
          </div>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[460px] border-collapse text-left text-xs">
              <caption className="sr-only">Exact daily Bar receipts, returns and other signed adjustments</caption>
              <thead><tr className="border-b border-slate-200 text-slate-500"><th className="py-2 pr-3 font-semibold">Business date</th><th className="px-3 py-2 text-right font-semibold">Gross receipts</th><th className="px-3 py-2 text-right font-semibold">Signed adjustments</th><th className="py-2 pl-3 text-right font-semibold">Net receipts</th></tr></thead>
              <tbody>{days.map((day) => <tr key={day.business_date} className="border-b border-slate-100 last:border-0"><th scope="row" className="py-2 pr-3 font-medium text-slate-700">{day.business_date}</th><td className="px-3 py-2 text-right tabular-nums text-slate-700">{formatMoney(day.gross_sales)}</td><td className="px-3 py-2 text-right tabular-nums text-slate-700">{formatMoney(day.signed_adjustments)}</td><td className="py-2 pl-3 text-right font-semibold tabular-nums text-slate-900">{formatMoney(day.net_sales)}</td></tr>)}</tbody>
            </table>
          </div>
        </>
      )}
    </section>
  )
}

export default function BarOwnerProjection() {
  const [session, setSession] = useState(() => getBarOwnerSession())
  const [bars, setBars] = useState(/** @type {import('../lib/barOwner').BarOwnerLink[]} */ ([]))
  const [selectedKey, setSelectedKey] = useState('')
  const [sales, setSales] = useState(/** @type {import('../lib/barOwner').BarOwnerSales|null} */ (null))
  const [operations, setOperations] = useState(/** @type {import('../lib/barOwner').BarOwnerOperations|null} */ (null))
  const [operationsError, setOperationsError] = useState('')
  const [from, setFrom] = useState(() => businessDate(-29))
  const [to, setTo] = useState(() => businessDate())
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [registerMode, setRegisterMode] = useState(false)
  const [enrollment, setEnrollment] = useState(/** @type {{code: string, expiresIn: number}|null} */ (null))
  const [copied, setCopied] = useState(false)
  const [loading, setLoading] = useState(false)
  const [busyLink, setBusyLink] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const refreshBars = useCallback(async (token) => {
    const next = await getBarOwnerBars(token)
    setBars(next)
    setSelectedKey((current) => next.some((bar) => bar.key_id === current && bar.active && !bar.revoked)
      ? current
      : next.find((bar) => bar.active && !bar.revoked)?.key_id || '')
  }, [])

  useEffect(() => {
    if (!session?.token) return
    let cancelled = false
    setLoading(true)
    getBarOwnerBars(session.token).then((next) => {
      if (cancelled) return
      setBars(next)
      setSelectedKey(next.find((bar) => bar.active && !bar.revoked)?.key_id || '')
      setError('')
    }).catch((reason) => {
      if (!cancelled) {
        setError(reason.message || 'Could not load Bar owner data.')
        if (!getBarOwnerSession()) setSession(null)
      }
    }).finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [session?.token])

  const selectedBar = bars.find((bar) => bar.key_id === selectedKey && bar.active && !bar.revoked) || null

  const loadSales = useCallback(async () => {
    if (!session?.token || !selectedBar) return
    setLoading(true)
    setError('')
    try {
      const [salesResult, operationsResult] = await Promise.allSettled([
        getBarOwnerSales(session.token, selectedBar.key_id, from, to),
        getBarOwnerOperations(session.token, selectedBar.key_id, from, to)
      ])
      if (salesResult.status === 'fulfilled') setSales(salesResult.value)
      else { setSales(null); setError(salesResult.reason.message || 'Bar sales could not be loaded.') }
      if (operationsResult.status === 'fulfilled') { setOperations(operationsResult.value); setOperationsError('') }
      else { setOperations(null); setOperationsError(operationsResult.reason.message || 'Bar stock and cash-up records could not be loaded.') }
    } catch (reason) {
      setSales(null)
      setOperations(null)
      setError(reason.message || 'Bar sales could not be loaded.')
    } finally { setLoading(false) }
  }, [from, selectedBar, session?.token, to])

  useEffect(() => { setSales(null); setOperations(null); if (selectedBar) void loadSales() }, [loadSales, selectedBar])

  const submitOwnerAccess = async (event) => {
    event.preventDefault()
    setError(''); setNotice(''); setLoading(true)
    try {
      if (registerMode) {
        const result = await registerBarOwner(email.trim(), password)
        setNotice(result.message || 'Check your email to verify this owner account, then sign in here.')
        setRegisterMode(false)
      } else {
        const next = await loginBarOwner(email.trim(), password)
        setSession(next)
        setPassword('')
      }
    } catch (reason) { setError(reason.message || 'Owner sign-in could not be completed.') }
    finally { setLoading(false) }
  }

  const createCode = async () => {
    if (!session?.token) return
    setError(''); setNotice(''); setLoading(true)
    try {
      setEnrollment(await createBarOwnerEnrollment(session.token))
      await refreshBars(session.token)
      setNotice('Enter this one-time code in the local Bar Administration screen. The computer will ask you to approve the connection here before it sends data.')
    } catch (reason) { setError(reason.message || 'A connection code could not be created.') }
    finally { setLoading(false) }
  }

  const approve = async (keyId) => {
    if (!session?.token) return
    setBusyLink(keyId); setError('')
    try { await approveBarOwnerLink(session.token, keyId); await refreshBars(session.token); setNotice('The Bar connection is approved. Only committed local data can now upload.') }
    catch (reason) { setError(reason.message || 'The Bar connection could not be approved.') }
    finally { setBusyLink('') }
  }

  const revoke = async (keyId) => {
    if (!session?.token || !window.confirm('Stop future uploads from this Bar and hide its remote data in this owner view? Local Bar trading will continue.')) return
    setBusyLink(keyId); setError('')
    try { await revokeBarOwnerLink(session.token, keyId); await refreshBars(session.token); setSales(null); setOperations(null); setNotice('The link is revoked. New uploads are refused; the local Bar is unchanged.') }
    catch (reason) { setError(reason.message || 'The Bar link could not be revoked.') }
    finally { setBusyLink('') }
  }

  const copyCode = async () => {
    if (!enrollment) return
    try { await navigator.clipboard.writeText(enrollment.code); setCopied(true); window.setTimeout(() => setCopied(false), 1500) }
    catch { setError('Copy is unavailable in this browser. Select and copy the code manually.') }
  }

  const lastReceived = sales?.last_ingested_at || selectedBar?.last_ingested_at || null
  const isStale = !lastReceived || sales?.stale === true || (!sales && selectedBar?.stale === true)
  const chartTotals = sales?.totals

  if (!session) {
    return (
      <div className="mx-auto max-w-xl space-y-4 p-4 sm:p-6">
        <header className="rounded-3xl bg-gradient-to-br from-emerald-700 via-teal-700 to-blue-800 p-6 text-white shadow-lg">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-100">Tsa Bonno Manager · Bar</p>
          <h1 className="mt-2 text-2xl font-bold">Bar Owner View</h1>
          <p className="mt-2 text-sm leading-6 text-white/80">Sign in to your verified online owner-view account to see committed sales received from your local Bar computer.</p>
        </header>
        <div className="rounded-2xl border border-blue-200 bg-blue-50 p-4 text-sm leading-6 text-blue-950">This online view account is separate from the Bar's local owner/staff sign-in. It will not replace or reset the password or PIN used on the Bar computer.</div>
        <form onSubmit={submitOwnerAccess} className="space-y-3 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="font-bold text-slate-900">{registerMode ? 'Create online owner-view account' : 'Owner sign-in'}</h2>
          <label className="block text-xs font-semibold text-slate-600">Email<input className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-3 text-sm" type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} /></label>
          <label className="block text-xs font-semibold text-slate-600">Password<input className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-3 text-sm" type="password" autoComplete={registerMode ? 'new-password' : 'current-password'} minLength={12} maxLength={128} required value={password} onChange={(event) => setPassword(event.target.value)} /></label>
          {error && <p role="alert" className="rounded-xl bg-rose-50 p-3 text-sm text-rose-800">{error}</p>}
          {notice && <p role="status" className="rounded-xl bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</p>}
          <button disabled={loading} className="w-full rounded-xl bg-emerald-700 px-4 py-3 text-sm font-bold text-white disabled:opacity-60">{loading ? 'Please wait…' : registerMode ? 'Create account and send verification email' : 'Sign in'}</button>
          <button type="button" className="w-full py-2 text-sm font-semibold text-blue-700" onClick={() => { setRegisterMode(!registerMode); setError(''); setNotice('') }}>{registerMode ? 'I already have an owner-view account' : 'Create an owner-view account'}</button>
        </form>
      </div>
    )
  }

  return (
    <main className="mx-auto max-w-7xl space-y-4 p-3 pb-8 sm:p-5 lg:p-7">
      <header className="overflow-hidden rounded-3xl bg-gradient-to-br from-emerald-700 via-teal-700 to-blue-800 p-5 text-white shadow-lg sm:p-7">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div><p className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-100">Tsa Bonno Manager · Bar</p><h1 className="mt-2 text-2xl font-bold sm:text-3xl">Bar Owner View</h1><p className="mt-2 max-w-2xl text-sm leading-6 text-white/80">Read-only view of locally committed Bar records that the approved connection has received.</p></div>
          <div className="flex items-center gap-2 rounded-xl border border-white/20 bg-white/10 px-3 py-2 text-xs"><span className="h-2 w-2 rounded-full bg-emerald-300" /><span>{session.email}</span><button type="button" className="ml-1 rounded-lg p-1.5 hover:bg-white/15" title="Sign out of owner view" aria-label="Sign out of owner view" onClick={() => { clearBarOwnerSession(); setSession(null); setBars([]); setSales(null) }}><LogOut size={15} /></button></div>
        </div>
      </header>

      {error && <div role="alert" className="flex gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800"><AlertTriangle className="mt-0.5 shrink-0" size={16} /><p>{error}</p></div>}
      {notice && <div role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">{notice}</div>}

      <section className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(280px,0.65fr)]">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-bold text-slate-900">Your Bar connections</h2><p className="mt-1 text-xs text-slate-500">Each connection requires local setup and your approval here.</p></div><button type="button" disabled={loading} onClick={createCode} className="inline-flex items-center gap-2 rounded-xl bg-blue-700 px-3 py-2.5 text-xs font-bold text-white disabled:opacity-60"><Link2 size={15} />Create connection code</button></div>
          {enrollment && <div className="mt-4 rounded-xl border border-blue-200 bg-blue-50 p-3"><p className="text-xs font-semibold text-blue-900">One-time code · expires in {Math.ceil(enrollment.expiresIn / 60)} min</p><div className="mt-2 flex flex-wrap items-center gap-2"><code className="min-w-0 flex-1 break-all rounded-lg bg-white px-3 py-2 font-mono text-sm text-blue-950">{enrollment.code}</code><button type="button" onClick={copyCode} className="inline-flex items-center gap-1.5 rounded-lg bg-blue-700 px-3 py-2 text-xs font-bold text-white">{copied ? <Check size={14} /> : <Copy size={14} />}{copied ? 'Copied' : 'Copy'}</button></div><p className="mt-2 text-xs leading-5 text-blue-900">Enter this code on the local Bar computer. The code only starts a request; no data uploads until you approve the connection below.</p></div>}
          <div className="mt-4 space-y-2">
            {bars.length === 0 ? <p className="rounded-xl bg-slate-50 p-4 text-sm text-slate-500">No Bar computers are linked yet. Create a code, then enter it in the local Bar Administration screen.</p> : bars.map((bar) => <div key={bar.key_id} className="rounded-xl border border-slate-200 p-3"><div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><p className="truncate font-semibold text-slate-900">{bar.business_name}</p><p className="mt-1 text-xs text-slate-500">{bar.revoked ? 'Revoked' : bar.active ? 'Approved' : 'Waiting for owner approval'} · last accepted batch {bar.last_ingested_at ? new Date(bar.last_ingested_at).toLocaleString() : 'none yet'}</p></div><div className="flex gap-2">{!bar.active && !bar.revoked && <button type="button" disabled={busyLink === bar.key_id} onClick={() => approve(bar.key_id)} className="rounded-lg bg-emerald-700 px-3 py-2 text-xs font-bold text-white disabled:opacity-60">Approve</button>}{bar.active && !bar.revoked && <button type="button" disabled={busyLink === bar.key_id} onClick={() => revoke(bar.key_id)} className="rounded-lg border border-rose-200 px-3 py-2 text-xs font-semibold text-rose-700 disabled:opacity-60">Revoke</button>}</div></div></div>)}
          </div>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5"><label className="block text-xs font-semibold text-slate-600">Selected Bar<select className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-3 text-sm text-slate-900" value={selectedKey} onChange={(event) => setSelectedKey(event.target.value)}><option value="">Choose an approved Bar</option>{bars.filter((bar) => bar.active && !bar.revoked).map((bar) => <option key={bar.key_id} value={bar.key_id}>{bar.business_name}</option>)}</select></label><div className={`mt-4 rounded-xl p-3 text-xs leading-5 ${isStale ? 'bg-amber-50 text-amber-950' : 'bg-emerald-50 text-emerald-950'}`}><p className="flex items-center gap-2 font-bold"><Clock3 size={15} />Last accepted batch</p><p className="mt-1">{lastReceived ? new Date(lastReceived).toLocaleString() : 'No committed batch has been received yet.'}</p>{isStale && <p className="mt-1">No newer committed update has arrived in over 20 minutes. The Bar may be quiet or disconnected; this timestamp cannot tell which.</p>}</div></div>
      </section>

      {selectedBar ? <>
        <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
          <div className="flex flex-wrap items-end justify-between gap-3"><div><h2 className="font-bold text-slate-900">Sales dashboard</h2><p className="mt-1 text-xs text-slate-500">Values are from batches acknowledged as ingested by the receiver.</p></div><form className="flex flex-wrap items-end gap-2" onSubmit={(event) => { event.preventDefault(); void loadSales() }}><label className="text-[11px] font-semibold text-slate-500">From<input type="date" className="mt-1 block rounded-lg border border-slate-300 px-2 py-2 text-xs text-slate-900" value={from} onChange={(event) => setFrom(event.target.value)} /></label><label className="text-[11px] font-semibold text-slate-500">To<input type="date" className="mt-1 block rounded-lg border border-slate-300 px-2 py-2 text-xs text-slate-900" value={to} onChange={(event) => setTo(event.target.value)} /></label><button disabled={loading} className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-3 py-2.5 text-xs font-bold text-white disabled:opacity-60"><RefreshCw size={14} className={loading ? 'animate-spin' : ''} />Refresh</button></form></div>
        </section>
        {sales && chartTotals && <>
          <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Metric label="Gross receipts" value={formatMoney(chartTotals.gross_sales)} detail="Committed sale receipts before signed adjustments" tone="border-emerald-200 bg-gradient-to-br from-emerald-50 to-teal-50 text-emerald-950" icon={ArrowUpRight} />
            <Metric label="Returns" value={formatMoney(chartTotals.returns)} detail="Returned receipt value, shown as a positive amount" tone="border-amber-200 bg-gradient-to-br from-amber-50 to-orange-50 text-amber-950" icon={ArrowDownRight} />
            <Metric label="Voids" value={formatMoney(chartTotals.voids)} detail="Voided receipt value, shown as a positive amount" tone="border-rose-200 bg-gradient-to-br from-rose-50 to-pink-50 text-rose-950" icon={AlertTriangle} />
            <Metric label="Net receipts" value={formatMoney(chartTotals.net_sales)} detail="Gross receipts plus signed returns, voids and post-close corrections" tone="border-blue-200 bg-gradient-to-br from-blue-50 to-indigo-50 text-blue-950" icon={TrendingUp} />
          </section>
          <div className="grid gap-3 sm:grid-cols-3"><Metric label="Sale commits" value={String(chartTotals.committed_sales)} detail="Original committed sale events; voids are shown separately" tone="border-violet-200 bg-violet-50 text-violet-950" icon={ShoppingBag} /><Metric label="Tax recorded" value={formatMoney(chartTotals.tax)} detail="Tax recorded on original committed receipts" tone="border-cyan-200 bg-cyan-50 text-cyan-950" icon={Activity} /><Metric label="Tips recorded" value={formatMoney(chartTotals.tips)} detail="Tips recorded on original committed receipts" tone="border-fuchsia-200 bg-fuchsia-50 text-fuchsia-950" icon={BarChart3} /></div>
          {Number(chartTotals.other_corrections_signed) !== 0 && <div className="rounded-xl border border-violet-200 bg-violet-50 p-3 text-sm text-violet-950">Post-close corrections (signed): <strong>{formatMoney(chartTotals.other_corrections_signed)}</strong>. These events are included in net receipts and listed in transaction history.</div>}
          <SalesChart days={sales.by_day} />
          <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5" aria-labelledby="bar-transaction-history-title"><div className="flex items-center justify-between gap-2"><div><h2 id="bar-transaction-history-title" className="font-bold text-slate-900">Recent transaction history</h2><p className="mt-1 text-xs text-slate-500">Up to 50 received sale and correction events in the selected period</p></div><ChevronDown size={17} className="text-slate-400" /></div>{sales.transactions.length === 0 ? <p className="mt-4 rounded-xl bg-slate-50 p-4 text-sm text-slate-500">No received transactions in this period.</p> : <div className="mt-3 overflow-x-auto"><table className="w-full min-w-[700px] border-collapse text-left text-xs"><caption className="sr-only">Recent committed Bar sales and their return, void or correction events</caption><thead><tr className="border-b border-slate-200 text-slate-500"><th className="py-2 pr-3 font-semibold">Business date</th><th className="px-3 py-2 font-semibold">Event</th><th className="px-3 py-2 font-semibold">Receipt</th><th className="px-3 py-2 text-right font-semibold">Items</th><th className="py-2 pl-3 text-right font-semibold">Signed total</th></tr></thead><tbody>{sales.transactions.map((row) => <tr key={`${row.operation_id}:${row.event_type}`} className="border-b border-slate-100 last:border-0"><td className="py-2 pr-3 text-slate-600">{row.business_date}</td><td className="px-3 py-2 font-semibold text-slate-800">{eventLabel(row.event_type)}</td><td className="px-3 py-2 text-slate-600">{row.receipt_series && row.receipt_number ? `${row.receipt_series}-${row.receipt_number}` : row.sale_id?.slice(0, 8) || '—'}</td><td className="px-3 py-2 text-right tabular-nums text-slate-600">{row.items_count}</td><td className="py-2 pl-3 text-right font-semibold tabular-nums text-slate-900">{formatMoney(row.total)}</td></tr>)}</tbody></table></div>}</section>
          <p className="text-[11px] leading-5 text-slate-500">Receipt totals include tax and tips as recorded by the local Bar service. Net receipts equal the sum of received signed sale and adjustment receipts for this business-date range. No profit, cash balance, stock, or unsynced local estimate is included.</p>
        </>}
        {operationsError && <p role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">Stock and cash-up report unavailable: {operationsError}</p>}
        {operations && <section className="space-y-3" aria-labelledby="bar-operations-report-title">
          <div><h2 id="bar-operations-report-title" className="text-lg font-bold text-slate-900">Stock and cash-up reports</h2><p className="mt-1 text-xs text-slate-500">Committed records received for {from} to {to}.</p></div>
          <div className="grid gap-3 sm:grid-cols-3">
            <Metric label="Stock movements" value={String(operations.summary.stock_movement_count)} detail="Received committed movement events" tone="border-teal-200 bg-teal-50 text-teal-950" icon={Activity} />
            <Metric label="Cash-ups submitted" value={String(operations.summary.cashup_count)} detail="Submitted closeout records in this period" tone="border-indigo-200 bg-indigo-50 text-indigo-950" icon={Check} />
            <Metric label="Cash-up variance" value={formatMoney(operations.summary.submitted_variance_total)} detail="Sum of submitted counted-cash minus expected-cash variance" tone="border-amber-200 bg-amber-50 text-amber-950" icon={Clock3} />
          </div>
          <div className="grid gap-3 xl:grid-cols-2">
            <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm" aria-labelledby="bar-stock-movement-title"><h3 id="bar-stock-movement-title" className="font-bold text-slate-900">Stock movement history</h3><p className="mt-1 text-xs text-slate-500">Movement records only; this is not a current stock-on-hand balance.</p>{operations.stock_movements.length === 0 ? <p className="mt-3 rounded-xl bg-slate-50 p-3 text-sm text-slate-500">No stock movements were received in this period.</p> : <div className="mt-3 max-h-96 overflow-auto"><table className="w-full min-w-[500px] border-collapse text-left text-xs"><thead><tr className="border-b border-slate-200 text-slate-500"><th className="py-2 pr-2">Date</th><th className="px-2 py-2">Movement</th><th className="px-2 py-2">SKU / product</th><th className="px-2 py-2 text-right">Change</th><th className="py-2 pl-2 text-right">Recorded quantity</th></tr></thead><tbody>{operations.stock_movements.map((row) => <tr key={`${row.operation_id}:${row.event_type}`} className="border-b border-slate-100"><td className="py-2 pr-2 text-slate-600">{row.business_date}</td><td className="px-2 py-2 text-slate-700">{row.event_type.replace('stock.', '').replaceAll('.', ' ')}</td><td className="px-2 py-2 font-mono text-slate-600">{row.sku || row.product_id.slice(0, 8)}</td><td className="px-2 py-2 text-right tabular-nums">{row.delta}</td><td className="py-2 pl-2 text-right tabular-nums">{row.quantity}</td></tr>)}</tbody></table></div>}</section>
            <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm" aria-labelledby="bar-cashup-history-title"><h3 id="bar-cashup-history-title" className="font-bold text-slate-900">Cash-up history</h3><p className="mt-1 text-xs text-slate-500">Local cash counts and expected cash; external card settlement is not included.</p>{operations.cashups.length === 0 ? <p className="mt-3 rounded-xl bg-slate-50 p-3 text-sm text-slate-500">No cash-up events were received in this period.</p> : <div className="mt-3 max-h-96 overflow-auto"><table className="w-full min-w-[500px] border-collapse text-left text-xs"><thead><tr className="border-b border-slate-200 text-slate-500"><th className="py-2 pr-2">Date</th><th className="px-2 py-2">Event</th><th className="px-2 py-2 text-right">Counted cash</th><th className="px-2 py-2 text-right">Expected cash</th><th className="py-2 pl-2 text-right">Variance</th></tr></thead><tbody>{operations.cashups.map((row) => <tr key={`${row.operation_id}:${row.event_type}`} className="border-b border-slate-100"><td className="py-2 pr-2 text-slate-600">{row.business_date}</td><td className="px-2 py-2 text-slate-700">{row.event_type.replace('cashup.', '')}</td><td className="px-2 py-2 text-right tabular-nums">{formatMoney(row.counted_cash)}</td><td className="px-2 py-2 text-right tabular-nums">{formatMoney(row.expected_cash)}</td><td className="py-2 pl-2 text-right font-semibold tabular-nums">{formatMoney(row.variance)}</td></tr>)}</tbody></table></div>}</section>
          </div>
          <p className="text-[11px] leading-5 text-slate-500">Only committed events received by the owner receiver are shown. The stock table is an event history, not live inventory; the report does not infer profit or external card settlement.</p>
        </section>}
      </> : <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center"><Link2 className="mx-auto text-slate-400" /><h2 className="mt-3 font-bold text-slate-800">No approved Bar is selected</h2><p className="mt-1 text-sm text-slate-500">Create a connection code or approve a pending local Bar request above.</p></div>}
      {loading && <p className="sr-only" role="status">Loading verified Bar projection</p>}
    </main>
  )
}
