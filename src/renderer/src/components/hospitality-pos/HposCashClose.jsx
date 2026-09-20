import { useCallback, useEffect, useState } from 'react'
import { CheckCircle2, RefreshCw, ShieldCheck, WalletCards, XCircle } from 'lucide-react'
import { useAccess, useSettings } from '../../app-context'
import { canAccessCapability } from '../../../../shared/accessControl'
import { HposButton, HposNotice, HposPageHero } from './HposUi'
import HposCashupProofs from './HposCashupProofs'
import HposDrawerClose from './HposDrawerClose'
import { cashupApprovalAllowed, formatRecordedMoney, getCashupEvidence } from './hposCashupState'

const amount = (value, currency) => formatRecordedMoney(value, currency)

const submissionVariance = (submission) => getCashupEvidence(submission).variance

export default function HposCashClose() {
  const { settings } = useSettings()
  const access = useAccess()
  const canCloseCashup = canAccessCapability(access, 'pos.cashup')
  const currency = settings?.currency || 'P'
  const [pendingCashups, setPendingCashups] = useState([])
  const [openTabsCount, setOpenTabsCount] = useState(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [reviewUnavailable, setReviewUnavailable] = useState('')
  const [notice, setNotice] = useState('')
  // Offline reads still list this device's submitted cash-ups for provisional
  // review (queued, final at sync). Only an empty offline list stays
  // unavailable — an empty device proves nothing about the server queue.
  const [provisionalReview, setProvisionalReview] = useState(false)
  const [reviewDraft, setReviewDraft] = useState(null)
  const [reviewNotes, setReviewNotes] = useState('')
  const [managerPin, setManagerPin] = useState('')
  const [summaryDate, setSummaryDate] = useState(() => new Date().toLocaleDateString('en-CA'))
  const [summaryBusy, setSummaryBusy] = useState(false)
  // Shared drawers close once per outlet; personal Till submissions above are
  // a separate flow and stay untouched.
  const [drawerOutlets, setDrawerOutlets] = useState([])
  const [drawerOutletId, setDrawerOutletId] = useState('')
  // Cash counting switch. The outlet editor answers the same question, but it
  // sits behind the multi-outlet add-on and hides single outlets entirely —
  // unreachable for exactly the single-outlet base bars that need it most.
  // This section asks it here instead: base feature, manager-gated page. The
  // server still enforces admin-only + zero open activity; this surface only
  // asks the question and reports the authoritative answer.
  const [cashModelOutlets, setCashModelOutlets] = useState([])
  const [cashModelOutletId, setCashModelOutletId] = useState('')
  const [cashModelChoice, setCashModelChoice] = useState('shared_drawer')
  const [cashModelBusy, setCashModelBusy] = useState(false)
  const cashModelRole = String(access?.role || '').toLowerCase()
  const canSwitchCashModel = ['admin', 'super_admin'].includes(cashModelRole)

  const revealReviewActions = (event) => {
    const actionBar = event.currentTarget?.closest('.hpos-cashup-review-card--decision')?.querySelector('.hpos-cashup-review-actions')
    if (!actionBar) return
    window.requestAnimationFrame(() => actionBar.scrollIntoView({ block: 'end', behavior: 'smooth' }))
  }

  const refresh = useCallback(async () => {
    if (!canCloseCashup) {
      setLoading(false)
      return
    }
    setLoading(true)
    setError('')
    setReviewUnavailable('')
    try {
      const result = await window.api?.pos?.getPendingCashupSubmissions?.()
      if (result?.success === false) throw new Error(result.error || 'Cash-up review could not be loaded.')
      if (!result || !Array.isArray(result.submissions)) throw new Error('Cash-up review returned an incomplete server response.')
      if (result.offline === true || result.complete === false) {
        if (result.submissions.length === 0) throw new Error('Cash-up review is unavailable until the server confirms the current submissions. Reconnect and refresh before relying on an empty queue.')
        setProvisionalReview(true)
      } else {
        setProvisionalReview(false)
      }
      setPendingCashups(result.submissions)
      // Unresolved-item link: open tabs must be settled before close.
      // Best-effort and never fatal to the cash-up review itself.
      try {
        const tabRows = (await window.api?.pos?.getTabs?.({ status: 'active' })) || []
        const open = (Array.isArray(tabRows) ? tabRows : []).filter(
          (row) => !['closed', 'paid', 'cancelled', 'voided'].includes(String(row.status || '').toLowerCase()),
        )
        setOpenTabsCount(open.length)
      } catch {
        setOpenTabsCount(null)
      }
    } catch (loadError) {
      const message = loadError?.message || 'Cash-up review could not be loaded.'
      setError(message)
      setReviewUnavailable(message)
      setProvisionalReview(false)
      setPendingCashups([])
    } finally {
      setLoading(false)
    }
  }, [canCloseCashup])

  useEffect(() => { refresh() }, [refresh])

  useEffect(() => {
    let active = true
    window.api?.outlets?.getAll?.().then((rows) => {
      if (!active) return
      const shared = (Array.isArray(rows) ? rows : []).filter((row) => row?.cash_model === 'shared_drawer')
      setDrawerOutlets(shared)
      setDrawerOutletId((current) => current && shared.some((row) => row.id === current) ? current : shared[0]?.id || '')
    }).catch(() => { if (active) { setDrawerOutlets([]); setDrawerOutletId('') } })
    return () => { active = false }
  }, [])

  const loadOutletCashModels = useCallback(async () => {
    try {
      const rows = await window.api?.outlets?.getAll?.()
      const all = Array.isArray(rows) ? rows : []
      setCashModelOutlets(all)
      setCashModelOutletId((current) => (current && all.some((row) => row.id === current) ? current : all[0]?.id || ''))
    } catch {
      setCashModelOutlets([])
    }
  }, [])

  useEffect(() => { loadOutletCashModels() }, [loadOutletCashModels])

  useEffect(() => {
    const found = cashModelOutlets.find((row) => row.id === cashModelOutletId)
    setCashModelChoice(found?.cash_model === 'shared_drawer' ? 'shared_drawer' : 'personal_bank')
  }, [cashModelOutlets, cashModelOutletId])

  const switchCashModel = async () => {
    const outlet = cashModelOutlets.find((row) => row.id === cashModelOutletId)
    if (!outlet || cashModelBusy) return
    const current = outlet.cash_model === 'shared_drawer' ? 'shared_drawer' : 'personal_bank'
    const wanted = cashModelChoice === 'shared_drawer' ? 'one shared drawer' : 'separate pouches'
    if (current === cashModelChoice) {
      setNotice(`${outlet.name || 'This outlet'} already counts ${wanted}.`)
      return
    }
    if (!window.confirm(`Switch ${outlet.name || 'this outlet'} to ${wanted}? Switching needs zero open Till shifts, drawer periods and reviews in the outlet — close or review them first.`)) return
    setCashModelBusy(true)
    setError('')
    setNotice('')
    try {
      const result = await window.api?.pos?.setOutletCashModel?.(outlet.id, cashModelChoice)
      if (!result?.success) throw new Error(result?.error || 'The cash counting model could not be changed.')
      setNotice(`${outlet.name || 'Outlet'} now counts ${wanted}. Open the drawer in Staff shift close before trading.`)
      await loadOutletCashModels()
    } catch (switchError) {
      setError(switchError?.message || 'The cash counting model could not be changed.')
      // Resync the dropdown to the authoritative model: a refused switch must
      // never leave the control displaying the unapplied choice as truth.
      await loadOutletCashModels()
    } finally {
      setCashModelBusy(false)
    }
  }

  const beginReview = (submission, decision) => {
    setError('')
    setNotice('')
    setReviewNotes('')
    setManagerPin('')
    setReviewDraft({ submission, decision })
  }

  const review = async () => {
    const submission = reviewDraft?.submission
    const decision = reviewDraft?.decision
    if (!submission || !decision || busy) return
    if (!managerPin.trim()) {
      setError('Enter the reviewing manager PIN.')
      return
    }
    if (decision === 'reject' && !reviewNotes.trim()) {
      setError('Enter a correction note before returning this cash-up.')
      return
    }
    // Server totals are unavailable offline, so a provisional approval accepts
    // the counted cash sight-unseen against them. The queue replays the same
    // authoritative review at sync, where the numbers reconcile — the banner
    // above says exactly this, so the approval is never mistaken for final.
    if (decision === 'approve' && !cashupApprovalAllowed(submission) && !provisionalReview) {
      setError('Approval blocked: expected and counted cash must both be recorded before this cash-up can be approved. Return it for correction.')
      return
    }
    setBusy(true)
    setError('')
    try {
      const result = await window.api?.pos?.reviewCashupSubmission?.({
        submission_id: submission.id,
        decision,
        notes: reviewNotes.trim() || null,
        manager_pin: managerPin.trim(),
      })
      if (!result?.success) throw new Error(result?.error || 'Cash-up review could not be saved.')
      if (result?.offline) {
        setNotice(decision === 'approve'
          ? 'Approval saved on this device and queued. The Till shift closure becomes final when sync confirms it against server totals.'
          : 'Return saved on this device and queued. It becomes final when sync confirms it.')
      } else {
        setNotice(decision === 'approve' ? 'Cash-up approved and the Till shift is closed.' : 'Cash-up returned to the operator for correction.')
      }
      setReviewDraft(null)
      setReviewNotes('')
      setManagerPin('')
      await refresh()
    } catch (reviewError) {
      setError(reviewError?.message || 'Cash-up review could not be saved.')
    } finally {
      setBusy(false)
    }
  }

  const dailyCloseSummary = async (print = false) => {
    if (summaryBusy) return
    setSummaryBusy(true); setError(''); setNotice('')
    try {
      const result = await window.api?.pos?.exportDailyCloseSummaryPdf?.({ date: summaryDate, print })
      if (!result?.success) throw new Error(result?.error || 'The certified daily-close summary could not be created.')
      setNotice(print ? 'Certified daily-close summary sent to the printer.' : `Certified daily-close summary saved${result.filePath ? `: ${result.filePath}` : '.'}`)
    } catch (summaryError) { setError(summaryError?.message || 'The certified daily-close summary could not be created.') }
    finally { setSummaryBusy(false) }
  }

  const reviewEvidence = reviewDraft ? getCashupEvidence(reviewDraft.submission) : null

  if (!canCloseCashup) {
    return <div className="hpos-page-frame hpos-service-cash">
      <HposPageHero eyebrow="Money control" title="Cash & close" description="Operators submit a physical cash count in My Cash-up. A supervisor or manager reviews the server-calculated result." />
      <HposNotice tone="warning">You can submit your own cash-up, but you do not have permission to review or close another operator’s Till shift.</HposNotice>
    </div>
  }

  return <div className="hpos-page-frame hpos-service-cash">
    <HposPageHero
      eyebrow="Money control"
      title="Cash & close"
      description="Review submitted physical cash counts against the server-confirmed Till totals. This page does not create a second drawer ledger."
      actions={<div className="hpos-service-hero-actions"><label>Business date<input type="date" value={summaryDate} onChange={(event) => setSummaryDate(event.target.value)} disabled={summaryBusy} /></label><HposButton icon={WalletCards} onClick={() => dailyCloseSummary(false)} disabled={summaryBusy}>{summaryBusy ? 'Building…' : 'Certified PDF'}</HposButton><HposButton icon={WalletCards} onClick={() => dailyCloseSummary(true)} disabled={summaryBusy}>Print summary</HposButton><HposButton icon={RefreshCw} onClick={refresh} disabled={loading}>{loading ? 'Refreshing…' : 'Refresh'}</HposButton></div>}
    />
    <HposNotice tone="warning">
      Private proof storage uses the same session-bound client as cash-up review. If the deployed Storage policy is unavailable, upload and read actions fail closed without storing a local file or changing the cash-up.
    </HposNotice>
    {error && <HposNotice tone="error">{error}</HposNotice>}
    {notice && <HposNotice><CheckCircle2 size={17} />{notice}</HposNotice>}
    {openTabsCount != null && openTabsCount > 0 && (
      <HposNotice tone="warning">
        {openTabsCount} open tab{openTabsCount === 1 ? ' is' : 's are'} still unsettled. Settle or resume
        them before closing — unpaid tabs do not appear in cash-up totals.{' '}
        <HposButton onClick={() => { window.location.hash = '/hpos/checks' }}>Review open tabs</HposButton>
      </HposNotice>
    )}
    {reviewDraft && <section className="hpos-cashup-review">
      <div><p className="hpos-eyebrow">Manager decision</p><h2>{reviewDraft.decision === 'reject' ? 'Return cash-up for correction' : 'Approve and close shift'}</h2><p>{reviewDraft.submission.cashier_name || 'Till operator'} · {reviewDraft.submission.outlet_name || 'Service outlet'}</p></div>
      <div className="hpos-cashup-review-list"><article className="hpos-cashup-review-card--decision">
        <div className="hpos-cashup-review-values"><span>Expected cash<strong>{amount(reviewDraft.submission.expected_cash_drawer, currency)}</strong></span><span>Counted cash<strong>{amount(reviewDraft.submission.counted_by_method?.cash, currency)}</strong></span><span>Variance<strong>{submissionVariance(reviewDraft.submission) === null ? 'Unavailable' : amount(submissionVariance(reviewDraft.submission), currency)}</strong></span></div>
        <HposCashupProofs submissionId={reviewDraft.submission.id} canUpload={reviewDraft.submission.status === 'submitted'} />
        <label className="hpos-my-cashup-notes"><span>{reviewDraft.decision === 'reject' ? 'Correction note (required)' : 'Approval note (optional)'}</span><textarea rows="3" value={reviewNotes} onChange={(event) => setReviewNotes(event.target.value)} disabled={busy} /></label>
        <label className="hpos-cashup-review-pin"><span><ShieldCheck size={17} /> Manager PIN</span><input type="password" inputMode="numeric" value={managerPin} onFocus={revealReviewActions} onChange={(event) => setManagerPin(event.target.value.replace(/\D/g, '').slice(0, 6))} disabled={busy} /></label>
        {!reviewEvidence?.complete && !provisionalReview && <p className="hpos-cashup-review-note">Approval is blocked because expected and counted cash are unavailable. Return this cash-up for correction after the authoritative values are restored.</p>}
        {!reviewEvidence?.complete && provisionalReview && <p className="hpos-cashup-review-note">Server totals are unavailable offline. Approving accepts the counted cash of {amount(reviewDraft.submission.counted_by_method?.cash, currency)} without them — the decision is queued and becomes final at sync.</p>}
        <footer className="hpos-cashup-review-actions"><HposButton onClick={() => setReviewDraft(null)} disabled={busy}>Cancel</HposButton><HposButton tone="primary" icon={reviewDraft.decision === 'reject' ? XCircle : CheckCircle2} onClick={review} disabled={busy || (reviewDraft.decision === 'approve' && !reviewEvidence?.complete && !provisionalReview)}>{busy ? 'Saving…' : reviewDraft.decision === 'reject' ? 'Return for correction' : 'Approve & close shift'}</HposButton></footer>
      </article></div>
    </section>}
    {loading ? <div className="hpos-service-loading"><RefreshCw className="is-spinning" size={22} /><span>Loading submitted cash-ups…</span></div> : reviewUnavailable ? <section data-testid="cashup-review-unavailable" className="hpos-service-cash-open"><WalletCards size={28} /><p className="hpos-eyebrow">Review unavailable</p><h2>Cash-up review is not verified</h2><p>{reviewUnavailable} No empty-queue conclusion is being shown. Refresh after the server connection is restored.</p><HposButton icon={RefreshCw} onClick={refresh} disabled={loading}>Refresh review</HposButton></section> : pendingCashups.length === 0 ? <section className="hpos-service-cash-open"><WalletCards size={28} /><p className="hpos-eyebrow">No pending handovers</p><h2>Cash-up review is clear</h2><p>No operator cash-ups are waiting for a manager decision. Completed reviews remain in the authoritative audit history.</p></section> : <section className="hpos-cashup-review"><div><p className="hpos-eyebrow">Supervisor review</p><h2>{pendingCashups.length} cash-up{pendingCashups.length === 1 ? '' : 's'} awaiting a decision</h2><p>Expected cash and variance are calculated by the server from posted tenders, returns and the configured tip policy.</p></div>{provisionalReview && <HposNotice tone="warning">You are offline. These are this device's submitted cash-ups only — the server may hold more. Reviews here are saved on this device and queued, and become final when sync confirms them.</HposNotice>}<div className="hpos-cashup-review-list">{pendingCashups.map((submission) => { const variance = submissionVariance(submission); return <article key={submission.id}><header><div><strong>{submission.cashier_name || 'Till operator'}</strong><span>{submission.outlet_name || 'Service outlet'} · {submission.submitted_at ? new Date(submission.submitted_at).toLocaleString('en-GB') : 'Submitted time unavailable'}</span></div><span className={variance !== null && Math.abs(variance) < 0.01 ? 'is-balanced' : 'is-variance'}>{variance === null ? 'Variance unavailable' : Math.abs(variance) < 0.01 ? 'Balanced' : `${variance > 0 ? 'Over' : 'Short'} ${amount(Math.abs(variance), currency)}`}</span></header><div className="hpos-cashup-review-values"><span>Expected cash<strong>{amount(submission.expected_cash_drawer, currency)}</strong></span><span>Counted cash<strong>{amount(submission.counted_by_method?.cash, currency)}</strong></span>{Number(submission.cash_tips_retained || 0) > 0 && <span>Cash tips retained<strong>{amount(submission.cash_tips_retained, currency)}</strong></span>}</div><HposCashupProofs submissionId={submission.id} canUpload={submission.status === 'submitted'} />{submission.notes && <p className="hpos-cashup-review-note">Operator note: {submission.notes}</p>}<footer><HposButton icon={XCircle} onClick={() => beginReview(submission, 'reject')} disabled={busy}>Return for correction</HposButton><HposButton tone="primary" icon={CheckCircle2} onClick={() => beginReview(submission, 'approve')} disabled={busy || !cashupApprovalAllowed(submission)}>Approve & close shift</HposButton></footer></article> })}</div></section>}
    {cashModelOutlets.length > 0 && (
      <section className="hpos-cashup-review" aria-label="Outlet cash counting">
        <div><p className="hpos-eyebrow">Outlet setup</p><h2>How this outlet counts cash</h2><p>One shared drawer counts once per period; separate pouches keep a personal cash-up per seller. Switching needs an admin and zero open Till shifts, drawer periods or reviews.</p></div>
        <label className="hpos-my-shift-outlet"><span>Outlet</span><select value={cashModelOutletId} onChange={(event) => setCashModelOutletId(event.target.value)} disabled={cashModelBusy}>{cashModelOutlets.map((outlet) => <option key={outlet.id} value={outlet.id}>{outlet.name}</option>)}</select></label>
        {canSwitchCashModel ? (
          <>
            <label className="hpos-my-shift-outlet"><span>Cash counting</span><select value={cashModelChoice} onChange={(event) => setCashModelChoice(event.target.value)} disabled={cashModelBusy}><option value="shared_drawer">One shared drawer</option><option value="personal_bank">Separate pouches</option></select></label>
            <HposButton tone="primary" onClick={switchCashModel} disabled={cashModelBusy}>{cashModelBusy ? 'Switching…' : 'Switch cash counting'}</HposButton>
          </>
        ) : (
          <HposNotice>Currently counting {(() => { const found = cashModelOutlets.find((row) => row.id === cashModelOutletId); return found?.cash_model === 'shared_drawer' ? 'one shared drawer' : 'separate pouches'; })()}. Only an admin can switch it — ask an admin to open this page.</HposNotice>
        )}
      </section>
    )}
    {drawerOutlets.length > 0 && (
      <section className="hpos-cashup-review" aria-label="Shared drawer close">
        <div><p className="hpos-eyebrow">Shared drawer</p><h2>Drawer close</h2><p>One blind count per shared drawer. This is separate from personal Till cash-ups.</p></div>
        <label className="hpos-my-shift-outlet"><span>Shared outlet</span><select value={drawerOutletId} onChange={(event) => setDrawerOutletId(event.target.value)}>{drawerOutlets.map((outlet) => <option key={outlet.id} value={outlet.id}>{outlet.name}</option>)}</select></label>
        {drawerOutletId && <HposDrawerClose outletId={drawerOutletId} />}
      </section>
    )}
  </div>
}
