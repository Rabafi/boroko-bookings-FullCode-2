import { useCallback, useEffect, useState } from 'react'
import { ArrowDownToLine, Banknote, CheckCircle2, HandCoins, RefreshCw, ShieldCheck, WalletCards } from 'lucide-react'
import { useAuth, useSettings } from '../../app-context'
import { HposButton, HposNotice, HposStatusBadge } from './HposUi'
import { ErrorNotice } from '../shared/ErrorNotice'
import { clearDrawerAttemptKey, drawerAttemptFingerprint, getDrawerAttemptKey } from '../../utils/drawerPeriodSubmission'

const money = (value, currency) => `${currency} ${Number(value || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

const MOVEMENT_LABELS = {
  drop_to_safe: 'Drop to safe',
  paid_out: 'Paid out',
  float_topup: 'Float top-up',
  pouch_to_drawer: 'Pouch banked in',
  drawer_to_pouch: 'Drawer paid to pouch',
}

const MOVEMENT_SIGN = {
  drop_to_safe: '−',
  paid_out: '−',
  float_topup: '+',
  pouch_to_drawer: '+',
  drawer_to_pouch: '−',
}

// Stable retry keys per drawer attempt: an identical retry after an ambiguous
// timeout reuses the same idempotency key (the server replays instead of
// recording the money twice); a changed intent rotates to a fresh key; a
// recorded movement clears its scope so the next one starts clean.
function resolveDrawerAttemptKey(scope, keyPrefix, intent) {
  const attempt = getDrawerAttemptKey({ scope, keyPrefix, fingerprint: drawerAttemptFingerprint(intent) })
  if (attempt.error || !attempt.durable || !attempt.key) {
    throw new Error(attempt.error || 'The retry key could not be durably saved. The server call was not sent.')
  }
  return attempt.key
}

// Operator-level drawer panel for shared-drawer outlets: record drops,
// paid-outs and float top-ups, attest handover counts, and see today's
// drawer activity. Money moves only through movements; counts are
// observations. The operator proves each move with their own Staff PIN
// entered right here — no PIN lives anywhere else on this card.
export default function HposDrawerMovements({ outletId, staffId }) {
  const { user } = useAuth()
  const { settings } = useSettings()
  const currency = settings?.currency || 'P'
  const lodgeId = settings?.lodge_id || user?.lodge_id || ''
  const managerActorId = user?.id || ''
  const [state, setState] = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [movementType, setMovementType] = useState('drop_to_safe')
  const [amount, setAmount] = useState('')
  const [reason, setReason] = useState('')
  const [handoverCount, setHandoverCount] = useState('')
  const [handoverNote, setHandoverNote] = useState('')
  // Per-action operator PIN, entered on this card for each move. Checked by
  // the server online and against the trusted device cache offline, so drops
  // keep working with no connection.
  const [operatorPin, setOperatorPin] = useState('')

  const refresh = useCallback(async () => {
    if (!outletId) { setState(null); setLoading(false); return }
    setLoading(true)
    setError('')
    try {
      const result = await window.api?.pos?.getDrawerPeriodState?.(outletId)
      if (!result?.success) throw new Error(result?.error || 'Could not load the drawer period.')
      setState(result)
      if (result?.period && ['submitted', 'approved'].includes(result.period.status)) {
        setNotice(result.period.status === 'approved'
          ? 'This drawer period is closed.'
          : 'The closing count is submitted. A manager reviews it in Cash & close.')
      } else {
        setNotice('')
      }
    } catch (loadError) {
      setError(loadError?.message || 'Could not load the drawer period. Refresh and try again.')
    } finally {
      setLoading(false)
    }
  }, [outletId])

  useEffect(() => { refresh() }, [refresh])

  const requirePin = () => {
    if (!operatorPin) { setError('Enter the operator Staff PIN here — it proves this handover.'); return false }
    return true
  }

  const submitMovement = async () => {
    if (saving) return
    if (!state?.period) { setError('The drawer is still loading. Wait a moment and try again.'); return }
    if (amount === '' || !Number.isFinite(Number(amount)) || Number(amount) <= 0) { setError('Enter the amount of cash moved.'); return }
    if (movementType === 'paid_out' && !reason.trim()) { setError('Say what the paid-out cash was for.'); return }
    if (!requirePin()) return
    setSaving(true)
    setError('')
    setNotice('')
    try {
      const movementScope = `cash-movement:${state.period.id}`
      const movementKey = resolveDrawerAttemptKey(movementScope, 'pos-cash-movement', {
        lodge_id: lodgeId, outlet_id: outletId, period_id: state.period.id,
        movement_type: movementType, amount: Number(amount),
        operator_id: staffId || null, notes: reason.trim() || null,
      })
      const result = await window.api?.pos?.recordCashMovement?.({
        outlet_id: outletId,
        movement_type: movementType,
        amount: Number(amount),
        operator_id: staffId || null,
        notes: reason.trim() || null,
        pin: operatorPin,
        idempotency_key: movementKey,
      })
      if (!result?.success) throw new Error(result?.error || 'Could not record the cash movement.')
      clearDrawerAttemptKey({ scope: movementScope })
      setAmount('')
      setReason('')
      setNotice(result?.offline
        ? 'Movement saved on this device and queued. It counts at sync.'
        : `${MOVEMENT_LABELS[movementType] || 'Movement'} recorded.`)
      await refresh()
    } catch (saveError) {
      setError(saveError?.message || 'Could not record the cash movement.')
    } finally {
      setSaving(false)
    }
  }

  const submitHandover = async () => {
    if (saving) return
    if (!state?.period) { setError('The drawer is still loading. Wait a moment and try again.'); return }
    if (handoverCount === '' || !Number.isFinite(Number(handoverCount)) || Number(handoverCount) < 0) { setError('Count the drawer and enter what is in it.'); return }
    if (!requirePin()) return
    setSaving(true)
    setError('')
    setNotice('')
    try {
      const handoverScope = `cash-count:${state.period.id}`
      const handoverKey = resolveDrawerAttemptKey(handoverScope, 'pos-cash-count', {
        lodge_id: lodgeId, period_id: state.period.id, count_type: 'handover',
        counted_cash: Number(handoverCount),
        operator_id: staffId || null, notes: handoverNote.trim() || null,
      })
      const result = await window.api?.pos?.recordCashCount?.({
        period_id: state.period.id,
        count_type: 'handover',
        counted_cash: Number(handoverCount),
        operator_id: staffId || null,
        notes: handoverNote.trim() || null,
        pin: operatorPin,
        idempotency_key: handoverKey,
      })
      if (!result?.success) throw new Error(result?.error || 'Could not record the handover count.')
      clearDrawerAttemptKey({ scope: handoverScope })
      setHandoverCount('')
      setHandoverNote('')
      setNotice(result?.offline
        ? 'Handover saved on this device and queued.'
        : 'Handover recorded. This count changes no balances — it narrows any later variance to a time window.')
      await refresh()
    } catch (saveError) {
      setError(saveError?.message || 'Could not record the handover count.')
    } finally {
      setSaving(false)
    }
  }

  const openPeriod = async () => {
    if (saving) return
    if (handoverCount === '' || !Number.isFinite(Number(handoverCount)) || Number(handoverCount) < 0) { setError('Count the starting change and enter it before opening the drawer (0.00 starts empty).'); return }
    setSaving(true)
    setError('')
    setNotice('')
    try {
      const openScope = `drawer-open:${outletId}`
      const openKey = resolveDrawerAttemptKey(openScope, 'pos-drawer-open', {
        lodge_id: lodgeId, outlet_id: outletId,
        opening_float: Number(handoverCount), notes: handoverNote.trim() || null,
      })
      const result = await window.api?.pos?.openDrawerPeriod?.({
        outlet_id: outletId,
        opening_float: Number(handoverCount),
        notes: handoverNote.trim() || null,
        idempotency_key: openKey,
      })
      if (!result?.success) throw new Error(result?.error || 'Could not open the drawer period.')
      clearDrawerAttemptKey({ scope: openScope })
      setHandoverCount('')
      setHandoverNote('')
      setNotice(result?.offline
        ? 'Drawer period saved on this device and queued.'
        : 'Drawer period opened. Record drops, paid-outs and handovers here through the day.')
      await refresh()
    } catch (saveError) {
      setError(saveError?.message || 'Could not open the drawer period.')
    } finally {
      setSaving(false)
    }
  }

  if (!outletId) return null
  const period = state?.period || null
  const movements = Array.isArray(state?.movements) ? state.movements : []

  return (
    <section className="hpos-attendance-card" aria-label="Shared drawer">
      <header>
        <span><WalletCards size={24} /></span>
        <div>
          <p>Shared drawer</p>
          <h2>{period ? `Drawer · ${period.business_date || 'today'}` : 'Drawer not opened'}</h2>
        </div>
        {period && <HposStatusBadge tone={period.status === 'approved' ? 'success' : period.status === 'submitted' ? 'warning' : period.status === 'rejected' ? 'error' : 'neutral'}>{period.status === 'approved' ? 'Closed' : period.status === 'submitted' ? 'Awaiting review' : period.status === 'rejected' ? 'Returned' : 'Open'}</HposStatusBadge>}
      </header>
      <div style={{ display: 'grid', gap: '16px', padding: '24px' }}>
        {error && <ErrorNotice>{error}</ErrorNotice>}
        {notice && <HposNotice>{notice}</HposNotice>}
        {loading ? (
          <div className="hpos-service-loading"><RefreshCw className="is-spinning" size={22} /><span>Loading the drawer…</span></div>
        ) : !period ? (
          <>
            <p style={{ margin: 0, color: '#7f6e76', fontSize: '13px', lineHeight: 1.55 }}>
              No counting period is open for this outlet. Count the starting change once — for example P300 — and open the drawer for the day.
            </p>
            <label><span>Starting change counted</span><input type="number" min="0" step="0.01" value={handoverCount} onChange={(event) => setHandoverCount(event.target.value)} disabled={saving} placeholder="0.00" /></label>
            <label><span>Note (optional)</span><input value={handoverNote} onChange={(event) => setHandoverNote(event.target.value)} disabled={saving} placeholder="Float counted by…" /></label>
            <HposButton tone="primary" icon={CheckCircle2} onClick={openPeriod} disabled={saving || loading}>{saving ? 'Opening…' : 'Open drawer'}</HposButton>
          </>
        ) : (
          <>
            <div className="hpos-my-cashup-figures">
              <article><small>Opening float</small><strong>{money(period.opening_float, currency)}</strong></article>
              <article><small>Movements today</small><strong>{movements.length}</strong></article>
            </div>
            {movements.length > 0 && (
              <div style={{ display: 'grid', gap: '8px' }}>
                {movements.slice(0, 8).map((row) => (
                  <p key={row.id || `${row.created_at}-${row.amount}`} style={{ margin: 0, display: 'flex', justifyContent: 'space-between', gap: '8px', fontSize: '13px', color: '#613e36' }}>
                    <span>{MOVEMENT_LABELS[row.movement_type] || row.movement_type}{row.notes ? ` · ${row.notes}` : ''}</span>
                    <strong>{MOVEMENT_SIGN[row.movement_type] || ''}{money(row.amount, currency)}</strong>
                  </p>
                ))}
              </div>
            )}
            {period.status === 'open' && (
              <>
                <label><span>Record money moved</span>
                  <select value={movementType} onChange={(event) => setMovementType(event.target.value)} disabled={saving}>
                    <option value="drop_to_safe">Move cash to safe</option>
                    <option value="paid_out">Pay an expense from drawer</option>
                    <option value="float_topup">Add change to drawer</option>
                  </select>
                </label>
                <div className="hpos-attendance-row">
                  <label><span><Banknote size={17} /> Amount</span><input type="number" min="0" step="0.01" value={amount} onChange={(event) => setAmount(event.target.value)} disabled={saving} placeholder="0.00" /></label>
                  <label><span>Why {movementType === 'paid_out' ? '(required)' : '(optional)'}</span><input value={reason} onChange={(event) => setReason(event.target.value)} disabled={saving} placeholder="Ice, airtime…" /></label>
                </div>
                <label><span><ShieldCheck size={17} /> Operator Staff PIN</span><input type="password" inputMode="numeric" autoComplete="one-time-code" value={operatorPin} onChange={(event) => setOperatorPin(event.target.value.replace(/\D/g, '').slice(0, 6))} disabled={saving} placeholder="Proves this handover" /><small>Checked here for each move — online by the server, offline against this device.</small></label>
                <HposButton tone="primary" icon={ArrowDownToLine} onClick={submitMovement} disabled={saving || loading}>{saving ? 'Recording…' : 'Record movement'}</HposButton>
                <label><span><HandCoins size={17} /> Handover count (changes nothing)</span><input type="number" min="0" step="0.01" value={handoverCount} onChange={(event) => setHandoverCount(event.target.value)} disabled={saving} placeholder="Counted drawer" /></label>
                <label><span>Handover note (optional)</span><input value={handoverNote} onChange={(event) => setHandoverNote(event.target.value)} disabled={saving} placeholder="Handing to…" /></label>
                <HposButton icon={CheckCircle2} onClick={submitHandover} disabled={saving || loading}>{saving ? 'Recording…' : 'Record handover'}</HposButton>
                <HposButton icon={RefreshCw} onClick={refresh} disabled={loading || saving}>Refresh drawer</HposButton>
              </>
            )}
          </>
        )}
      </div>
    </section>
  )
}
