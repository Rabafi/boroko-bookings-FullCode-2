import { useCallback, useEffect, useRef, useState } from 'react'
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
  // Outlet setup (outlet + cash counting) now lives in Settings → Outlets.
  // This page links there; the server still enforces admin-only + zero open
  // activity for switches.

  const revealReviewActions = (event) => {
    const actionBar = event.currentTarget?.closest('article')?.querySelector('.hpos-cashup-review-actions')
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

  // Venue cash models drive which queues show: an all-drawer bar sees only
  // Drawer close, an all-pouches bar sees only personal reviews. A queue is
  // hidden only when no outlet uses its model AND nothing is still waiting in
  // it — an older cash-up from before a model switch always stays surfaced.
  const [allOutlets, setAllOutlets] = useState([])
  const [outletsLoaded, setOutletsLoaded] = useState(false)
  useEffect(() => {
    let active = true
    window.api?.outlets?.getAll?.().then((rows) => {
      if (!active) return
      const all = Array.isArray(rows) ? rows : []
      const shared = all.filter((row) => row?.cash_model === 'shared_drawer')
      setAllOutlets(all)
      setDrawerOutlets(shared)
      setDrawerOutletId((current) => current && shared.some((row) => row.id === current) ? current : shared[0]?.id || '')
      setOutletsLoaded(true)
    }).catch(() => { if (active) { setAllOutlets([]); setDrawerOutlets([]); setDrawerOutletId('') } })
    return () => { active = false }
  }, [])
  const hasPersonalOutlets = allOutlets.some((row) => row?.cash_model !== 'shared_drawer')
  const hasSharedOutlets = drawerOutlets.length > 0
  // Money-reviews summary: personal awaiting comes from the pending list;
  // drawer awaiting comes from one lightweight state read per shared outlet
  // (same getDrawerPeriodState contract the drawer card uses, offline-first).
  // Counts never merge money — they only tell the manager where to scroll.
  const [drawerReviewCounts, setDrawerReviewCounts] = useState({ awaiting: 0, open: 0, loaded: false })
  // Older drawer counts from before a model switch: a non-shared outlet can
  // still hold an open or submitted period, and hiding it would bury money.
  const [olderDrawers, setOlderDrawers] = useState([])
  useEffect(() => {
    let active = true
    if (!outletsLoaded) return () => { active = false }
    if (allOutlets.length === 0) {
      setDrawerReviewCounts({ awaiting: 0, open: 0, loaded: true })
      setOlderDrawers([])
      return () => { active = false }
    }
    setDrawerReviewCounts({ awaiting: 0, open: 0, loaded: false })
    setOlderDrawers([])
    Promise.all(allOutlets.map((outlet) =>
      window.api?.pos?.getDrawerPeriodState?.(outlet.id)?.then((result) => ({ outlet, period: result?.success ? result?.period || null : 'unknown' })).catch(() => ({ outlet, period: 'unknown' })),
    )).then((states) => {
      if (!active) return
      let awaiting = 0
      let open = 0
      const older = []
      for (const { outlet, period } of states) {
        if (period === 'unknown' || !period) continue
        const shared = outlet?.cash_model === 'shared_drawer'
        if (period.status === 'submitted') {
          if (shared) awaiting += 1
          else older.push({ outletId: outlet.id, outletName: outlet.name || 'Service outlet', status: period.status })
        } else if (period.status === 'open' || period.status === 'rejected') {
          if (shared) open += 1
          else older.push({ outletId: outlet.id, outletName: outlet.name || 'Service outlet', status: period.status })
        }
      }
      setDrawerReviewCounts({ awaiting, open, loaded: true })
      setOlderDrawers(older)
    })
    return () => { active = false }
  }, [allOutlets, outletsLoaded])
  // Visibility: a queue shows when its model is in use, or when older items
  // from before a switch still wait. Loading and unknown outlets fail open to
  // today's layout so nothing flickers away before the truth arrives.
  const showPersonal = loading || !outletsLoaded || hasPersonalOutlets || pendingCashups.length > 0
  const showDrawer = hasSharedOutlets || olderDrawers.length > 0
  const olderPersonal = outletsLoaded && !hasPersonalOutlets && pendingCashups.length > 0
  const allSharedVenue = outletsLoaded && allOutlets.length > 0 && !hasPersonalOutlets
  const allPersonalVenue = outletsLoaded && allOutlets.length > 0 && !hasSharedOutlets && olderDrawers.length === 0
  const personalSectionRef = useRef(null)
  const drawerSectionRef = useRef(null)
  const scrollToSection = (ref) => {
    try {
      ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    } catch {
      /* scroll is best-effort */
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
      description={allSharedVenue ? 'Review the shared drawer count against the server total.' : allPersonalVenue ? "Review each seller's cash-up against server-confirmed Till totals." : 'Review submitted physical cash counts against the server-confirmed Till totals. This page does not create a second drawer ledger.'}
      actions={<div className="hpos-service-hero-actions"><span className="hpos-report-group" aria-label="Daily report"><label>Report date<input type="date" value={summaryDate} onChange={(event) => setSummaryDate(event.target.value)} disabled={summaryBusy} /></label><HposButton icon={WalletCards} onClick={() => dailyCloseSummary(false)} disabled={summaryBusy}>{summaryBusy ? 'Building…' : 'Save report PDF'}</HposButton><HposButton icon={WalletCards} onClick={() => dailyCloseSummary(true)} disabled={summaryBusy}>Print report</HposButton></span><HposButton icon={RefreshCw} onClick={refresh} disabled={loading}>{loading ? 'Refreshing…' : 'Refresh'}</HposButton></div>}
    />
    {error && <HposNotice tone="error">{error}</HposNotice>}
    {notice && <HposNotice><CheckCircle2 size={17} />{notice}</HposNotice>}
    {openTabsCount != null && openTabsCount > 0 && (
      <HposNotice tone="warning">
        {openTabsCount} open tab{openTabsCount === 1 ? ' is' : 's are'} still unsettled. Settle or resume
        them before closing — unpaid tabs do not appear in cash-up totals.{' '}
        <HposButton onClick={() => { window.location.hash = '/hpos/checks' }}>Review open tabs</HposButton>
      </HposNotice>
    )}
    {!loading && !reviewUnavailable && (
      <section className="hpos-cashup-review" aria-label="Money reviews summary">
        <div><p className="hpos-eyebrow">Money reviews</p><h2>{(() => {
          const personal = showPersonal ? pendingCashups.length : 0
          const olderSubmitted = olderDrawers.filter((row) => row.status === 'submitted').length
          const drawers = (drawerReviewCounts.loaded ? drawerReviewCounts.awaiting : 0) + olderSubmitted
          if (!drawerReviewCounts.loaded) return 'Checking reviews…'
          if (!showPersonal && showDrawer) return drawers > 0 ? `Drawer: ${drawers} waiting` : 'All clear — nothing waiting'
          if (!showDrawer && showPersonal) return personal > 0 ? `Personal: ${personal} waiting` : 'All clear — nothing waiting'
          const total = personal + drawers
          if (total === 0) return 'All clear — nothing waiting'
          return `${total} waiting (${personal} personal · ${drawers} drawer)`
        })()}</h2><p>{allSharedVenue ? 'This venue counts one shared drawer — reviews live under Drawer close.' : 'Personal cash-ups and shared drawers stay separate below — counts never mix money, they only say where to look.'}</p></div>
        <div className="hpos-cashup-review-actions">
          {showPersonal && <HposButton onClick={() => scrollToSection(personalSectionRef)}>Go to personal</HposButton>}
          {showDrawer && <HposButton onClick={() => scrollToSection(drawerSectionRef)}>Go to drawer</HposButton>}
        </div>
      </section>
    )}
    {showPersonal && (<><div ref={personalSectionRef} id="money-reviews-personal" />
    {olderPersonal && !loading && !reviewUnavailable && <HposNotice>Older personal cash-ups from before this venue switched still need a decision below.</HposNotice>}
    {loading ? <div className="hpos-service-loading"><RefreshCw className="is-spinning" size={22} /><span>Loading submitted cash-ups…</span></div> : reviewUnavailable ? <section data-testid="cashup-review-unavailable" className="hpos-service-cash-open"><WalletCards size={28} /><p className="hpos-eyebrow">Review unavailable</p><h2>Cash-up review is not verified</h2><p>{reviewUnavailable} No empty-queue conclusion is being shown. Refresh after the server connection is restored.</p><HposButton icon={RefreshCw} onClick={refresh} disabled={loading}>Refresh review</HposButton></section> : pendingCashups.length === 0 ? <section className="hpos-service-cash-open"><WalletCards size={28} /><p className="hpos-eyebrow">No pending handovers</p><h2>Cash-up review is clear</h2><p>No operator cash-ups are waiting for a manager decision. Completed reviews remain in the authoritative audit history.</p>{drawerOutlets.length > 0 && <p className="hpos-cashup-review-note">Clock-outs without Till sales create no cash-up — nothing to review here. Shared drawer reviews live below in Drawer close.</p>}</section> : <section className="hpos-cashup-review"><div><p className="hpos-eyebrow">Supervisor review</p><h2>{olderPersonal ? `${pendingCashups.length} older personal cash-up${pendingCashups.length === 1 ? '' : 's'} still needs a decision` : `${pendingCashups.length} cash-up${pendingCashups.length === 1 ? '' : 's'} awaiting a decision`}</h2><p>Expected cash and variance are calculated by the server from posted tenders, returns and the configured tip policy.</p></div>{provisionalReview && <HposNotice tone="warning">You are offline. These are this device's submitted cash-ups only — the server may hold more. Reviews here are saved on this device and queued, and become final when sync confirms them.</HposNotice>}<div className="hpos-cashup-review-list">{pendingCashups.map((submission) => { const variance = submissionVariance(submission); const deciding = reviewDraft?.submission?.id === submission.id; return <article key={submission.id}><header><div><strong>{submission.cashier_name || 'Till operator'}</strong><span>{submission.outlet_name || 'Service outlet'} · {submission.submitted_at ? new Date(submission.submitted_at).toLocaleString('en-GB') : 'Submitted time unavailable'}</span></div><span className={variance !== null && Math.abs(variance) < 0.01 ? 'is-balanced' : 'is-variance'}>{variance === null ? 'Variance unavailable' : Math.abs(variance) < 0.01 ? 'Balanced' : `${variance > 0 ? 'Over' : 'Short'} ${amount(Math.abs(variance), currency)}`}</span></header>{submission.notes && <p className="hpos-cashup-review-note">Operator note: {submission.notes}</p>}<div className="hpos-cashup-review-values"><span>Expected cash<strong>{amount(submission.expected_cash_drawer, currency)}</strong></span><span>Counted cash<strong>{amount(submission.counted_by_method?.cash, currency)}</strong></span>{Number(submission.cash_tips_retained || 0) > 0 && <span>Cash tips retained<strong>{amount(submission.cash_tips_retained, currency)}</strong></span>}</div><HposCashupProofs submissionId={submission.id} canUpload={submission.status === 'submitted'} />{!deciding ? (<footer><HposButton icon={XCircle} onClick={() => beginReview(submission, 'reject')} disabled={busy}>Return for correction</HposButton><HposButton tone="primary" icon={CheckCircle2} onClick={() => beginReview(submission, 'approve')} disabled={busy || !cashupApprovalAllowed(submission)}>Approve & close shift</HposButton>{!busy && !cashupApprovalAllowed(submission) && <span className="hpos-cashup-review-note">Approval needs expected and counted cash — return for correction.</span>}</footer>) : (<><label className="hpos-my-cashup-notes"><span>{reviewDraft.decision === 'reject' ? 'Correction note (required)' : 'Approval note (optional)'}</span><textarea rows="3" value={reviewNotes} onChange={(event) => setReviewNotes(event.target.value)} disabled={busy} /></label><label className="hpos-cashup-review-pin"><span><ShieldCheck size={17} /> Manager PIN</span><input type="password" inputMode="numeric" value={managerPin} onFocus={revealReviewActions} onChange={(event) => setManagerPin(event.target.value.replace(/\D/g, '').slice(0, 6))} disabled={busy} /></label>{!reviewEvidence?.complete && !provisionalReview && <p className="hpos-cashup-review-note">Approval is blocked because expected and counted cash are unavailable. Return this cash-up for correction after the authoritative values are restored.</p>}{!reviewEvidence?.complete && provisionalReview && <p className="hpos-cashup-review-note">Server totals are unavailable offline. Approving accepts the counted cash of {amount(reviewDraft.submission.counted_by_method?.cash, currency)} without them — the decision is queued and becomes final at sync.</p>}<footer className="hpos-cashup-review-actions"><HposButton onClick={() => setReviewDraft(null)} disabled={busy}>Cancel</HposButton><HposButton tone="primary" icon={reviewDraft.decision === 'reject' ? XCircle : CheckCircle2} onClick={review} disabled={busy || (reviewDraft.decision === 'approve' && !reviewEvidence?.complete && !provisionalReview)}>{busy ? 'Saving…' : reviewDraft.decision === 'reject' ? 'Return for correction' : 'Approve & close shift'}</HposButton></footer></>)}</article> })}</div></section>}</>)}
    {showDrawer && (<><div ref={drawerSectionRef} id="money-reviews-drawer" />
    {drawerOutlets.length > 0 && (
      <section className="hpos-cashup-review" aria-label="Shared drawer close">
        <div><p className="hpos-eyebrow">Shared drawer</p><h2>Drawer close</h2><p>One blind count per shared drawer. This is separate from personal Till cash-ups.</p></div>
        {drawerOutlets.length === 1 ? (
          <p className="hpos-cashup-review-note">Shared outlet: {drawerOutlets[0]?.name || 'Service outlet'}</p>
        ) : (
          <label className="hpos-my-shift-outlet"><span>Shared outlet</span><select value={drawerOutletId} onChange={(event) => setDrawerOutletId(event.target.value)}>{drawerOutlets.map((outlet) => <option key={outlet.id} value={outlet.id}>{outlet.name}</option>)}</select></label>
        )}
        {drawerOutletId && <HposDrawerClose outletId={drawerOutletId} />}
      </section>
    )}
    {olderDrawers.map((row) => (
      <section key={row.outletId} className="hpos-cashup-review" aria-label="Older drawer review">
        <div><p className="hpos-eyebrow">Older drawer review</p><h2>{row.outletName}</h2><p>This outlet now counts separate pouches, but a drawer count from before the switch still needs a decision.</p></div>
        <HposDrawerClose outletId={row.outletId} />
      </section>
    ))}</>)}
    <section className="hpos-cashup-review" aria-label="Outlet setup moved">
      <div><p className="hpos-eyebrow">Outlet setup</p><h2>How this outlet counts cash</h2><p>Outlet setup now lives in Settings → Outlets. Switching still needs an admin and zero open Till shifts, drawer periods or reviews.</p></div>
      <HposButton onClick={() => { window.location.hash = '/settings?tab=outlets' }}>Open Outlet setup in Settings</HposButton>
    </section>
  </div>
}
