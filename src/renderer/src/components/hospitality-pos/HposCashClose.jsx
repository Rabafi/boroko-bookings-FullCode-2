import { useCallback, useEffect, useState } from 'react'
import { CheckCircle2, RefreshCw, ShieldCheck, WalletCards, XCircle } from 'lucide-react'
import { useAccess, useSettings } from '../../app-context'
import { canAccessCapability } from '../../../../shared/accessControl'
import { HposButton, HposNotice, HposPageHero } from './HposUi'

const amount = (value, currency) => `${currency} ${Number(value || 0).toLocaleString('en-BW', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

function submissionVariance(submission) {
  const counted = Number(submission?.counted_by_method?.cash || 0)
  const expected = Number(submission?.expected_cash_drawer)
  return Number.isFinite(expected) ? counted - expected : null
}

export default function HposCashClose() {
  const { settings } = useSettings()
  const access = useAccess()
  const canCloseCashup = canAccessCapability(access, 'pos.cashup')
  const currency = settings?.currency || 'P'
  const [pendingCashups, setPendingCashups] = useState([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [reviewDraft, setReviewDraft] = useState(null)
  const [reviewNotes, setReviewNotes] = useState('')
  const [managerPin, setManagerPin] = useState('')

  const refresh = useCallback(async () => {
    if (!canCloseCashup) {
      setLoading(false)
      return
    }
    setLoading(true)
    setError('')
    try {
      const result = await window.api?.pos?.getPendingCashupSubmissions?.()
      if (result?.success === false) throw new Error(result.error || 'Cash-up review could not be loaded.')
      setPendingCashups(Array.isArray(result?.submissions) ? result.submissions : [])
    } catch (loadError) {
      setError(loadError?.message || 'Cash-up review could not be loaded.')
      setPendingCashups([])
    } finally {
      setLoading(false)
    }
  }, [canCloseCashup])

  useEffect(() => { refresh() }, [refresh])

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
      setNotice(decision === 'approve' ? 'Cash-up approved and the Till shift is closed.' : 'Cash-up returned to the operator for correction.')
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
      actions={<HposButton icon={RefreshCw} onClick={refresh} disabled={loading}>{loading ? 'Refreshing…' : 'Refresh'}</HposButton>}
    />
    {error && <HposNotice tone="error">{error}</HposNotice>}
    {notice && <HposNotice><CheckCircle2 size={17} />{notice}</HposNotice>}
    {reviewDraft && <section className="hpos-cashup-review">
      <div><p className="hpos-eyebrow">Manager decision</p><h2>{reviewDraft.decision === 'reject' ? 'Return cash-up for correction' : 'Approve and close shift'}</h2><p>{reviewDraft.submission.cashier_name || 'Till operator'} · {reviewDraft.submission.outlet_name || 'Service outlet'}</p></div>
      <div className="hpos-cashup-review-list"><article>
        <div className="hpos-cashup-review-values"><span>Expected cash<strong>{amount(reviewDraft.submission.expected_cash_drawer, currency)}</strong></span><span>Counted cash<strong>{amount(reviewDraft.submission.counted_by_method?.cash, currency)}</strong></span><span>Variance<strong>{submissionVariance(reviewDraft.submission) === null ? 'Unavailable' : amount(submissionVariance(reviewDraft.submission), currency)}</strong></span></div>
        <label className="hpos-my-cashup-notes"><span>{reviewDraft.decision === 'reject' ? 'Correction note (required)' : 'Approval note (optional)'}</span><textarea rows="3" value={reviewNotes} onChange={(event) => setReviewNotes(event.target.value)} disabled={busy} /></label>
        <label className="hpos-cashup-review-pin"><span><ShieldCheck size={17} /> Manager PIN</span><input type="password" inputMode="numeric" value={managerPin} onChange={(event) => setManagerPin(event.target.value.replace(/\D/g, '').slice(0, 6))} disabled={busy} /></label>
        <footer><HposButton onClick={() => setReviewDraft(null)} disabled={busy}>Cancel</HposButton><HposButton tone="primary" icon={reviewDraft.decision === 'reject' ? XCircle : CheckCircle2} onClick={review} disabled={busy}>{busy ? 'Saving…' : reviewDraft.decision === 'reject' ? 'Return for correction' : 'Approve & close shift'}</HposButton></footer>
      </article></div>
    </section>}
    {loading ? <div className="hpos-service-loading"><RefreshCw className="is-spinning" size={22} /><span>Loading submitted cash-ups…</span></div> : pendingCashups.length === 0 ? <section className="hpos-service-cash-open"><WalletCards size={28} /><p className="hpos-eyebrow">No pending handovers</p><h2>Cash-up review is clear</h2><p>No operator cash-ups are waiting for a manager decision. Completed reviews remain in the authoritative audit history.</p></section> : <section className="hpos-cashup-review"><div><p className="hpos-eyebrow">Supervisor review</p><h2>{pendingCashups.length} cash-up{pendingCashups.length === 1 ? '' : 's'} awaiting a decision</h2><p>Expected cash and variance are calculated by the server from posted tenders, returns and the configured tip policy.</p></div><div className="hpos-cashup-review-list">{pendingCashups.map((submission) => { const variance = submissionVariance(submission); return <article key={submission.id}><header><div><strong>{submission.cashier_name || 'Till operator'}</strong><span>{submission.outlet_name || 'Service outlet'} · {submission.submitted_at ? new Date(submission.submitted_at).toLocaleString('en-GB') : 'Submitted time unavailable'}</span></div><span className={variance !== null && Math.abs(variance) < 0.01 ? 'is-balanced' : 'is-variance'}>{variance === null ? 'Variance unavailable' : Math.abs(variance) < 0.01 ? 'Balanced' : `${variance > 0 ? 'Over' : 'Short'} ${amount(Math.abs(variance), currency)}`}</span></header><div className="hpos-cashup-review-values"><span>Expected cash<strong>{amount(submission.expected_cash_drawer, currency)}</strong></span><span>Counted cash<strong>{amount(submission.counted_by_method?.cash, currency)}</strong></span>{Number(submission.cash_tips_retained || 0) > 0 && <span>Cash tips retained<strong>{amount(submission.cash_tips_retained, currency)}</strong></span>}</div>{submission.notes && <p className="hpos-cashup-review-note">Operator note: {submission.notes}</p>}<footer><HposButton icon={XCircle} onClick={() => beginReview(submission, 'reject')} disabled={busy}>Return for correction</HposButton><HposButton tone="primary" icon={CheckCircle2} onClick={() => beginReview(submission, 'approve')} disabled={busy}>Approve & close shift</HposButton></footer></article> })}</div></section>}
  </div>
}
