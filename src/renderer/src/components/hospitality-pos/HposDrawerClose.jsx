import { useCallback, useEffect, useState } from 'react'
import { CheckCircle2, RefreshCw, ShieldCheck, WalletCards, XCircle } from 'lucide-react'
import { useAuth, useSettings } from '../../app-context'
import { HposButton, HposNotice } from './HposUi'
import { ErrorNotice } from '../shared/ErrorNotice'
import { clearDrawerSubmissionRound, getDrawerSubmissionRound } from '../../utils/drawerPeriodSubmission'

const money = (value, currency) => `${currency} ${Number(value || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

const MOVEMENT_LABELS = {
  drop_to_safe: 'Drop to safe',
  paid_out: 'Paid out',
  float_topup: 'Float top-up',
  pouch_to_drawer: 'Pouch banked in',
  drawer_to_pouch: 'Drawer paid to pouch',
}

// Manager surface for one shared drawer: blind closing count, then review
// against the server-derived expectation. The count screen never shows
// expected cash — not even to managers. Who counted and who approved are
// recorded separately, including honest self-review.
export default function HposDrawerClose({ outletId }) {
  const { user } = useAuth()
  const { settings } = useSettings()
  const currency = settings?.currency || 'P'
  const lodgeId = settings?.lodge_id || user?.lodge_id || ''
  const [state, setState] = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [counted, setCounted] = useState('')
  const [notes, setNotes] = useState('')
  const [pin, setPin] = useState('')
  const [reviewNotes, setReviewNotes] = useState('')
  const [managerPin, setManagerPin] = useState('')
  const [reviewDecision, setReviewDecision] = useState(null)

  const refresh = useCallback(async () => {
    if (!outletId) { setState(null); setLoading(false); return }
    setLoading(true)
    setError('')
    try {
      const result = await window.api?.pos?.getDrawerPeriodState?.(outletId)
      if (!result?.success) throw new Error(result?.error || 'Could not load the drawer period.')
      setState(result)
      const period = result?.period || null
      if (period && ['approved'].includes(period.status)) {
        clearDrawerSubmissionRound({ lodgeId, periodId: period.id })
      }
      if (!period || period.status === 'rejected') {
        const rejected = period?.status === 'rejected'
        setCounted('')
        setNotes(rejected ? '' : notes)
        if (rejected) setNotice(`Cash-up returned for correction.${period.review_notes ? ` Manager note: ${period.review_notes}` : ''} Count again and resubmit.`)
      }
    } catch (loadError) {
      setError(loadError?.message || 'Could not load the drawer period. Refresh and try again.')
    } finally {
      setLoading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [outletId, lodgeId])

  useEffect(() => { refresh() }, [refresh])

  const period = state?.period || null
  const expected = state?.expected || null
  const movements = Array.isArray(state?.movements) ? state.movements : []
  const counts = Array.isArray(state?.counts) ? state.counts : []

  const submit = async () => {
    if (!period || saving) return
    const count = Number(counted)
    if (counted === '' || !Number.isFinite(count) || count < 0) { setError('Count the drawer and enter what is in it.'); return }
    setSaving(true)
    setError('')
    setNotice('')
    try {
      const submissionPayload = { period_id: period.id, counted_cash: count, notes: notes.trim() || null, actor_id: user?.id || null }
      const round = getDrawerSubmissionRound({
        lodgeId, periodId: period.id, actorId: user?.id,
        payload: submissionPayload, serverStatus: period.status,
      })
      if (round.conflict || !round.durable || !round.round) throw new Error(round.error || 'The count was not durably saved. The server call was not sent.')
      const result = await window.api?.pos?.submitDrawerPeriodCashup?.({
        ...(round.round.payload || submissionPayload),
        pin: pin.trim() || null,
        idempotency_key: round.round.idempotencyKey,
      })
      if (!result?.success) throw new Error(result?.error || 'Could not submit the drawer cash-up.')
      clearDrawerSubmissionRound({ lodgeId, periodId: period.id })
      setCounted('')
      setNotes('')
      setPin('')
      setNotice(result?.offline
        ? 'Count saved on this device and queued. Review stays provisional until sync.'
        : 'Count submitted. Review it below against the server total.')
      await refresh()
    } catch (submitError) {
      setError(submitError?.message || 'Could not submit the drawer cash-up.')
    } finally {
      setSaving(false)
    }
  }

  const review = async () => {
    if (!period || !reviewDecision || saving) return
    if (!managerPin.trim()) { setError('Enter the reviewing manager PIN.'); return }
    if (reviewDecision === 'reject' && !reviewNotes.trim()) { setError('Enter a correction note before returning this cash-up.'); return }
    setSaving(true)
    setError('')
    try {
      const result = await window.api?.pos?.reviewDrawerPeriodCashup?.({
        period_id: period.id,
        decision: reviewDecision,
        notes: reviewNotes.trim() || null,
        manager_pin: managerPin.trim(),
      })
      if (!result?.success) throw new Error(result?.error || 'Cash-up review could not be saved.')
      setNotice(reviewDecision === 'approve' ? 'Drawer period approved and closed.' : 'Cash-up returned for a fresh count.')
      setReviewDecision(null)
      setReviewNotes('')
      setManagerPin('')
      await refresh()
    } catch (reviewError) {
      setError(reviewError?.message || 'Cash-up review could not be saved.')
    } finally {
      setSaving(false)
    }
  }

  if (!outletId) return null
  const variance = expected && expected.success !== false && period?.counted_cash != null
    ? Number(period.counted_cash) - Number(expected.expected_cash_drawer || 0)
    : null

  return (
    <section className="hpos-cashup-review" aria-label="Shared drawer close">
      <div>
        <p className="hpos-eyebrow">Shared drawer</p>
        <h2>{period ? `Drawer · ${period.business_date || 'today'}` : 'Drawer not opened'}</h2>
        <p>One blind count for the whole drawer. Expected cash is derived by the server and appears only at review.</p>
      </div>
      {error && <ErrorNotice>{error}</ErrorNotice>}
      {notice && <HposNotice>{notice}</HposNotice>}
      {loading ? (
        <div className="hpos-service-loading"><RefreshCw className="is-spinning" size={22} /><span>Loading the drawer…</span></div>
      ) : !period ? (
        <p style={{ color: '#7f6e76', fontSize: '13px' }}>Open the drawer period from the shared terminal first — count the starting change once.</p>
      ) : (
        <div className="hpos-cashup-review-list">
          <article>
            <header>
              <div><strong>Period status</strong><span>{period.status === 'approved' ? 'Closed' : period.status === 'submitted' ? 'Awaiting review' : period.status === 'rejected' ? 'Returned for correction' : 'Open'}</span></div>
              <span className={variance !== null && Math.abs(variance) < 0.01 ? 'is-balanced' : 'is-variance'}>
                {period.status === 'approved' && variance !== null
                  ? (Math.abs(variance) < 0.01 ? 'Balanced' : `${variance > 0 ? 'Over' : 'Short'} ${money(Math.abs(variance), currency)}`)
                  : money(period.opening_float, currency)}
              </span>
            </header>
            <div className="hpos-cashup-review-values">
              <span>Opening float<strong>{money(period.opening_float, currency)}</strong></span>
              <span>Movements<strong>{movements.length}</strong></span>
              <span>Counts<strong>{counts.length}</strong></span>
            </div>
            {(period.status === 'open' || period.status === 'rejected') && (
              <>
                <label className="hpos-my-cashup-count"><span>Physical cash counted (blind — expected stays hidden)</span><input type="number" min="0" step="0.01" value={counted} onChange={(event) => setCounted(event.target.value)} disabled={saving} placeholder="0.00" /><small>Type the counted cash here — the note box below adds words only and never counts.</small></label>
                <label className="hpos-my-cashup-notes"><span>Count note (optional)</span><textarea rows="2" value={notes} onChange={(event) => setNotes(event.target.value)} disabled={saving} /></label>
                <label className="hpos-cashup-review-pin"><span><ShieldCheck size={17} /> Staff PIN (when counting for an operator)</span><input type="password" inputMode="numeric" value={pin} onChange={(event) => setPin(event.target.value.replace(/\D/g, '').slice(0, 6))} disabled={saving} placeholder="Optional" /></label>
                <footer className="hpos-cashup-review-actions"><HposButton icon={RefreshCw} onClick={refresh} disabled={loading || saving}>Refresh</HposButton><HposButton tone="primary" icon={CheckCircle2} onClick={submit} disabled={saving}>{saving ? 'Submitting…' : 'Submit count for review'}</HposButton></footer>
              </>
            )}
            {period.status === 'submitted' && (
              <>
                <div className="hpos-cashup-review-values">
                  <span>Expected cash<strong>{expected && expected.success !== false ? money(expected.expected_cash_drawer, currency) : 'Unavailable'}</strong></span>
                  <span>Counted cash<strong>{period.counted_cash != null ? money(period.counted_cash, currency) : 'Unavailable'}</strong></span>
                  <span>Variance<strong>{variance === null ? 'Unavailable' : money(variance, currency)}</strong></span>
                </div>
                {movements.length > 0 && (
                  <div style={{ display: 'grid', gap: '6px', fontSize: '13px', color: '#613e36' }}>
                    {movements.map((row) => (
                      <p key={row.id} style={{ margin: 0, display: 'flex', justifyContent: 'space-between', gap: '8px' }}>
                        <span>{MOVEMENT_LABELS[row.movement_type] || row.movement_type}{row.notes ? ` · ${row.notes}` : ''}</span>
                        <strong>{money(row.amount, currency)}</strong>
                      </p>
                    ))}
                  </div>
                )}
                {!reviewDecision ? (
                  <footer className="hpos-cashup-review-actions">
                    <HposButton icon={XCircle} onClick={() => { setReviewDecision('reject'); setError(''); }} disabled={saving}>Return for correction</HposButton>
                    <HposButton tone="primary" icon={CheckCircle2} onClick={() => { setReviewDecision('approve'); setError('') }} disabled={saving || !expected || expected.success === false}>Approve & close</HposButton>
                  </footer>
                ) : (
                  <>
                    <label className="hpos-my-cashup-notes"><span>{reviewDecision === 'reject' ? 'Correction note (required)' : 'Approval note (optional)'}</span><textarea rows="3" value={reviewNotes} onChange={(event) => setReviewNotes(event.target.value)} disabled={saving} /></label>
                    <label className="hpos-cashup-review-pin"><span><ShieldCheck size={17} /> Manager PIN</span><input type="password" inputMode="numeric" value={managerPin} onChange={(event) => setManagerPin(event.target.value.replace(/\D/g, '').slice(0, 6))} disabled={saving} /></label>
                    <footer className="hpos-cashup-review-actions"><HposButton onClick={() => setReviewDecision(null)} disabled={saving}>Cancel</HposButton><HposButton tone="primary" icon={reviewDecision === 'reject' ? XCircle : CheckCircle2} onClick={review} disabled={saving}>{saving ? 'Saving…' : reviewDecision === 'reject' ? 'Return for correction' : 'Approve & close'}</HposButton></footer>
                  </>
                )}
              </>
            )}
            {period.status === 'approved' && (
              <p style={{ color: '#7f6e76', fontSize: '13px' }}>
                Closed{period.reviewed_at ? ` ${new Date(period.reviewed_at).toLocaleString('en-GB')}` : ''}.
                Counted {period.counted_cash != null ? money(period.counted_cash, currency) : '—'} against expected {expected && expected.success !== false ? money(expected.expected_cash_drawer, currency) : 'unavailable'}.
              </p>
            )}
          </article>
        </div>
      )}
    </section>
  )
}
