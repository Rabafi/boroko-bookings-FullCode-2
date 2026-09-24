import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowRight, CircleDollarSign, ClipboardList, Clock3, KeyRound, LogIn, LogOut, MessageSquareHeart, RefreshCw, ShieldCheck, Store, WalletCards, ShieldAlert } from 'lucide-react'
import { useAccess, useAuth, useSettings } from '../../app-context'
import { canAccessCapability } from '../../../../shared/accessControl'
import { isBarOnlyMode } from '../../../../shared/propertyTypes'
import { classifyPosTransaction } from '../../../../shared/posFinancialTruth'
import { summarizeWasteMovements } from '../../../../shared/wasteSummary'
import { unpackTransport } from '../../transportUnpack'
import { HposButton, HposNotice, HposPageHero, HposStatusBadge } from './HposUi'

function formatTime(value) {
  if (!value) return '—'
  return new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function MyStaffPinCard() {
  const { user } = useAuth()
  const [hasPin, setHasPin] = useState(null)
  const [currentPin, setCurrentPin] = useState('')
  const [newPin, setNewPin] = useState('')
  const [confirmPin, setConfirmPin] = useState('')
  const [savingPin, setSavingPin] = useState(false)
  const [pinError, setPinError] = useState('')
  const [pinNotice, setPinNotice] = useState('')

  useEffect(() => {
    let active = true
    window.api?.pos?.getStaff?.().then((rows) => {
      if (!active) return
      const list = Array.isArray(rows) ? rows : []
      const self = list.find((row) => row?.id === user?.id) || null
      setHasPin(self ? self.has_pin !== false : null)
    }).catch(() => { if (active) setHasPin(null) })
    return () => { active = false }
  }, [user?.id])

  useEffect(() => {
    if (String(window.location.hash || '').includes('my-staff-pin')) {
      const timer = window.setTimeout(() => {
        document.getElementById('my-staff-pin')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      }, 150)
      return () => window.clearTimeout(timer)
    }
    return undefined
  }, [])

  const submitPin = async (event) => {
    event.preventDefault()
    if (savingPin) return
    setPinError('')
    setPinNotice('')
    const next = String(newPin || '').trim()
    const confirm = String(confirmPin || '').trim()
    const current = String(currentPin || '').trim()
    if (!/^[0-9]{4,6}$/.test(next)) { setPinError('Staff PIN must be 4–6 digits.'); return }
    if (next !== confirm) { setPinError('The new PIN entries do not match.'); return }
    if (hasPin !== false && !current) { setPinError('Enter your current Staff PIN to set a new one. If you forgot it, ask an admin to reset it in Staff Management.'); return }
    if (hasPin !== false && current === next) { setPinError('The new PIN must be different from the current PIN.'); return }
    if (typeof window.api?.users?.changeOwnPin !== 'function') {
      setPinError('This app build cannot change your PIN yet. Close and reopen the app fully (not just refresh), then try again.');
      return
    }
    setSavingPin(true)
    try {
      const result = await window.api.users.changeOwnPin({ current_pin: current || null, new_pin: next })
      if (!result?.success) throw new Error(result?.error || 'Could not change your Staff PIN.')
      setCurrentPin(''); setNewPin(''); setConfirmPin('')
      setHasPin(true)
      setPinNotice('Your Staff PIN was updated. Use the new PIN at the Till from now on.')
    } catch (pinSaveError) {
      setPinError(pinSaveError?.message || 'Could not change your Staff PIN.')
    } finally {
      setSavingPin(false)
    }
  }

  return <section className="hpos-my-shift-card" aria-label="My Staff PIN" id="my-staff-pin">
    <div className="hpos-my-shift-status">
      <span><KeyRound size={24} /></span>
      <div><p>Personal account</p><h2>My Staff PIN</h2></div>
      <HposStatusBadge tone={hasPin === false ? 'warning' : 'neutral'}>{hasPin === false ? 'No PIN yet' : 'Private to you'}</HposStatusBadge>
    </div>
    <form onSubmit={submitPin} style={{ display: 'grid', gap: '12px', padding: '8px 24px 26px' }}>
      <p style={{ margin: 0, color: '#7f6e76', fontSize: '12px', lineHeight: 1.55 }}>
        {user?.name ? `${user.name}, set` : 'Set'} your own Till PIN here while signed in. Admins keep the right to reset it in Staff Management.
        If you forgot your current PIN, ask an admin to reset it — never share PINs.
      </p>
      {pinError && <HposNotice tone="error">{pinError}</HposNotice>}
      {pinNotice && <HposNotice>{pinNotice}</HposNotice>}
      {hasPin !== false && <label style={{ display: 'grid', gap: '7px', color: '#613e36', fontSize: '13px', fontWeight: 800 }}><span style={{ display: 'inline-flex', alignItems: 'center', gap: '7px' }}><ShieldCheck size={15} /> Current PIN</span><input type="password" inputMode="numeric" autoComplete="off" value={currentPin} onChange={(event) => setCurrentPin(event.target.value.replace(/\D/g, '').slice(0, 6))} disabled={savingPin} placeholder="Enter current PIN" style={{ minHeight: '48px', border: '1px solid rgba(104,66,74,.2)', borderRadius: '11px', background: '#fff', padding: '0 12px', fontSize: '18px', letterSpacing: '.14em', textAlign: 'center' }} /></label>}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
        <label style={{ display: 'grid', gap: '7px', color: '#613e36', fontSize: '13px', fontWeight: 800 }}><span>New PIN (4–6 digits)</span><input type="password" inputMode="numeric" autoComplete="new-password" value={newPin} onChange={(event) => setNewPin(event.target.value.replace(/\D/g, '').slice(0, 6))} disabled={savingPin} placeholder="New PIN" style={{ minHeight: '48px', border: '1px solid rgba(104,66,74,.2)', borderRadius: '11px', background: '#fff', padding: '0 12px', fontSize: '18px', letterSpacing: '.14em', textAlign: 'center' }} /></label>
        <label style={{ display: 'grid', gap: '7px', color: '#613e36', fontSize: '13px', fontWeight: 800 }}><span>Confirm new PIN</span><input type="password" inputMode="numeric" autoComplete="new-password" value={confirmPin} onChange={(event) => setConfirmPin(event.target.value.replace(/\D/g, '').slice(0, 6))} disabled={savingPin} placeholder="Repeat new PIN" style={{ minHeight: '48px', border: '1px solid rgba(104,66,74,.2)', borderRadius: '11px', background: '#fff', padding: '0 12px', fontSize: '18px', letterSpacing: '.14em', textAlign: 'center' }} /></label>
      </div>
      <HposButton tone="primary" type="submit" icon={KeyRound} disabled={savingPin || !newPin || !confirmPin || (hasPin !== false && !currentPin)}>{savingPin ? 'Saving…' : hasPin === false ? 'Set my PIN' : 'Change my PIN'}</HposButton>
      <small style={{ color: '#7f6e76', fontSize: '11px', lineHeight: 1.5 }}>Your PIN is checked by the server and never stored on this screen. Changing it here does not change anyone else’s PIN.</small>
    </form>
  </section>
}

export default function HposMyShift() {
  const { user } = useAuth()
  const { settings } = useSettings()
  const barOnly = isBarOnlyMode(settings)
  const access = useAccess()
  const canManagePos = canAccessCapability(access, 'pos.manage')
  const [outlets, setOutlets] = useState([])
  const [outletId, setOutletId] = useState('')
  const [shift, setShift] = useState(null)
  const [cashupSubmission, setCashupSubmission] = useState(null)
  const [attendance, setAttendance] = useState(null)
  const [openingFloat, setOpeningFloat] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  // Errors render above the cards while the action buttons sit below them:
  // bring a new error into view and focus so it is never missed off-screen.
  const errorAnchorRef = useRef(null)
  useEffect(() => {
    if (!error || !errorAnchorRef.current) return
    try { errorAnchorRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' }) } catch { /* best-effort */ }
    try { errorAnchorRef.current.focus?.({ preventScroll: true }) } catch { /* best-effort */ }
  }, [error])
  const [dailyOpening, setDailyOpening] = useState(null)
  const [feedback, setFeedback] = useState({ rating: '5', channel: 'in_store', message: '' })
  const [feedbackSaving, setFeedbackSaving] = useState(false)
  // Handover at a glance for the open shift. Counts and names only: blind
  // cash-up hides expected takings from the operator, so money never
  // appears here. Every figure fails soft to Unavailable, never estimates.
  const [handover, setHandover] = useState(null)
  const canHandoverWaste = canAccessCapability(access, 'inventory.view')

  const refresh = useCallback(async (preferredOutletId = outletId) => {
    setLoading(true)
    setError('')
    try {
      const rows = await window.api?.outlets?.getAll?.() || []
      const nextOutlets = Array.isArray(rows) ? rows : []
      const nextOutletId = preferredOutletId && nextOutlets.some((outlet) => outlet.id === preferredOutletId)
        ? preferredOutletId
        : nextOutlets[0]?.id || ''
      setOutlets(nextOutlets)
      setOutletId(nextOutletId)
      const nextShift = nextOutletId ? await window.api?.pos?.getCurrentShift?.(nextOutletId, user?.id || null) : null
      setShift(nextShift)
      setCashupSubmission(nextShift ? (await window.api?.pos?.getMyCashupSubmission?.(nextShift.id))?.submission || null : null)
      const active = await window.api?.pos?.getActiveShifts?.() || []
      const activeAttendance = (Array.isArray(active) ? active : []).find((row) => row.staff_user_id === user?.id) || null
      setAttendance(activeAttendance)
      if (canManagePos && !barOnly) {
        const checklists = await window.api?.pos?.getChecklists?.() || []
        const today = new Date().toLocaleDateString('en-CA')
        setDailyOpening((Array.isArray(checklists) ? checklists : []).find((row) => String(row.checklist_type || row.type || '') === 'daily_opening' && new Date(row.checklist_date || row.created_at || 0).toLocaleDateString('en-CA') === today) || null)
      }
    } catch (loadError) {
      setError(loadError?.message || 'Could not load your shift. Refresh and try again.')
    } finally {
      setLoading(false)
    }
  }, [barOnly, canManagePos, outletId, user?.id])

  useEffect(() => { refresh() }, [refresh])

  useEffect(() => {
    if (!shift?.id) { setHandover(null); return }
    let active = true
    setHandover(null)
    const openedAt = shift.opened_at || null
    const openDate = String(openedAt || '').slice(0, 10) || new Date().toLocaleDateString('en-CA')
    const today = new Date().toLocaleDateString('en-CA')
    Promise.all([
      window.api?.pos?.getCertifiedReportHistory?.(openDate, today).catch(() => null),
      window.api?.pos?.getTabs?.({ status: 'active' }).catch(() => null),
      canHandoverWaste
        ? window.api?.inventory?.getMovementsWithReadStatus?.({ start_date: openDate, end_date: today, limit: 500 }).catch(() => null)
        : Promise.resolve(null),
    ]).then(([history, tabRows, movements]) => {
      if (!active) return
      const allOrders = unpackTransport(history?.orders) || []
      const shiftOrders = allOrders.filter((order) => order?.shift_id
        ? String(order.shift_id) === String(shift.id)
        : openedAt && String(order?.created_at || '') >= String(openedAt))
      const tabs = (Array.isArray(tabRows) ? tabRows : [])
        .filter((row) => !['closed', 'paid', 'cancelled', 'voided'].includes(String(row.status || '').toLowerCase()))
        .filter((row) => !row.outlet_id || !shift.outlet_id || String(row.outlet_id) === String(shift.outlet_id))
        .map((row) => ({
          name: String(row.tab_name || row.table_name || 'Tab'),
          waiter: String(row.waiter_name || row.cashier_name || ''),
        }))
      let wasteText = 'None recorded'
      let wasteReady = false
      if (canHandoverWaste && movements?.complete === true && movements?.source === 'server') {
        const rows = (movements.rows || []).filter((row) => !openedAt || String(row?.created_at || '') >= String(openedAt))
        const summary = summarizeWasteMovements(rows)
        wasteReady = true
        wasteText = summary.totalEntries
          ? summary.items.slice(0, 3).map((item) => `${item.quantity} ${item.unit} ${item.label}`).join(' · ') +
            (summary.items.length > 3 ? ` +${summary.items.length - 3} more` : '')
          : 'None recorded'
      }
      setHandover({
        salesCount: shiftOrders.filter((order) => classifyPosTransaction(order) === 'sale').length,
        salesReady: history?.complete === true && history?.source === 'server',
        tabs,
        tabsReady: Array.isArray(tabRows),
        wasteText,
        wasteReady,
      })
    }).catch(() => {
      if (active) setHandover({ salesCount: 0, salesReady: false, tabs: null, tabsReady: false, wasteText: '', wasteReady: false })
    })
    return () => { active = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shift])

  const changeOutlet = async (nextOutletId) => {
    setOutletId(nextOutletId)
    setLoading(true)
    setError('')
    try { const nextShift = await window.api?.pos?.getCurrentShift?.(nextOutletId, user?.id || null) || null; setShift(nextShift); setCashupSubmission(nextShift ? (await window.api?.pos?.getMyCashupSubmission?.(nextShift.id))?.submission || null : null); const active = await window.api?.pos?.getActiveShifts?.() || []; setAttendance((Array.isArray(active) ? active : []).find((row) => row.staff_user_id === user?.id) || null) }
    catch (loadError) { setError(loadError?.message || 'Could not load that outlet shift.') }
    finally { setLoading(false) }
  }

  const startShift = async () => {
    if (!outletId || saving) return
    // The float is explicit every shift: an empty value never defaults.
    if (String(openingFloat ?? '').trim() === '') { setError('Enter the opening cash float to start the shift (0.00 when you have no cash float).'); return }
    setSaving(true)
    setError('')
    setNotice('')
    try {
      const attemptStorageKey = `hpos:pending-shift:${user?.id || 'current'}:${outletId}`
      const attemptKey = localStorage.getItem(attemptStorageKey) || crypto.randomUUID()
      localStorage.setItem(attemptStorageKey, attemptKey)
      const attendanceResult = await window.api?.pos?.clockInSelfForPos?.({ role: user?.role || (barOnly ? 'bar' : 'waiter'), idempotency_key: `${attemptKey}:attendance` })
      if (attendanceResult?.success === false) throw new Error(attendanceResult.error || 'Could not start attendance.')
      const active = await window.api?.pos?.getActiveShifts?.() || []
      const activeAttendance = (Array.isArray(active) ? active : []).find((row) => row.staff_user_id === user?.id) || null
      setAttendance(activeAttendance)
      const result = await window.api?.pos?.openShift?.({
        outlet_id: outletId,
        cashier_id: user?.id || null,
        cashier_name: user?.name || user?.email || null,
        opening_float: Number(openingFloat || 0),
        idempotency_key: `${attemptKey}:pos-shift`,
      })
      if (result?.success === false) throw new Error(result.error || 'Could not start your shift.')
      const linked = await window.api?.pos?.linkMyShiftAttendance?.({ pos_shift_id: result?.shift?.id, attendance_shift_id: activeAttendance?.id })
      if (linked?.success === false) throw new Error(linked.error || 'Could not link your Till shift to attendance.')
      setShift(result?.shift || await window.api?.pos?.getCurrentShift?.(outletId, user?.id || null) || null)
      localStorage.removeItem(attemptStorageKey)
      setOpeningFloat('')
      setNotice(result?.already_open ? 'Your shift was already open.' : result?.offline ? 'Attendance and Till shift are saved on this device. You can take payments offline; they remain provisional until sync.' : 'Attendance and Till shift started. You can now take payments in Till.')
    } catch (saveError) {
      setError(saveError?.message || 'Could not start your shift.')
    } finally {
      setSaving(false)
    }
  }

  const clockOut = async () => {
    if (!attendance?.id || saving) return
    // Shared drawers reconcile collectively at period close: the server lets
    // attendance close while the drawer stays open. Personal outlets keep the
    // handover-first rule (unknown models fail closed to it).
    if (shift && activeOutlet?.cash_model !== 'shared_drawer' && !['submitted', 'approved'].includes(cashupSubmission?.status)) { setError('Submit My Cash-up before clocking out. A manager can review it after your attendance is closed.'); return }
    setSaving(true); setError(''); setNotice('')
    try {
      const result = await window.api?.pos?.clockOutStaff?.({ shiftId: attendance.id })
      if (result?.success === false) throw new Error(result.error || 'Could not clock out.')
      setAttendance(null)
      setNotice('You are clocked out of attendance. Cash-up remains a separate Till reconciliation step.')
    } catch (clockOutError) { setError(clockOutError?.message || 'Could not clock out. Refresh and try again.') } finally { setSaving(false) }
  }

  const submitFeedback = async (event) => {
    event.preventDefault()
    if (feedbackSaving || !feedback.message.trim()) return
    setFeedbackSaving(true); setError(''); setNotice('')
    try {
      const result = await window.api?.pos?.submitStaffFeedback?.({ ...feedback, rating: Number(feedback.rating), message: feedback.message.trim() })
      if (!result?.success) throw new Error(result?.error || 'Could not submit guest feedback.')
      setFeedback({ rating: '5', channel: 'in_store', message: '' })
      setNotice('Guest feedback has been sent to management for follow-up.')
    } catch (submitError) { setError(submitError?.message || 'Could not submit guest feedback.') }
    finally { setFeedbackSaving(false) }
  }

  const activeOutlet = outlets.find((outlet) => outlet.id === outletId)

  return <div className="hpos-my-shift">
    <HposPageHero
      eyebrow="My service shift"
      title={shift || attendance ? 'You are on shift' : 'Start your shift'}
      description={shift ? 'Your Till payments are being attributed to this open shift.' : attendance ? 'Your attendance is still active. Clock out here when your work is finished.' : 'Record your opening float before taking payments so cash-up stays accurate.'}
      actions={<HposButton icon={RefreshCw} onClick={() => refresh(outletId)} disabled={loading || saving}>Refresh</HposButton>}
    />
    {error && <div ref={errorAnchorRef} tabIndex={-1} data-testid="my-shift-error-anchor"><HposNotice tone="error">{error}</HposNotice></div>}
    {notice && <HposNotice>{notice}</HposNotice>}
    {!barOnly && canManagePos && !loading && dailyOpening?.status !== 'completed' && <section className="hpos-shift-readiness-reminder"><ClipboardList size={20}/><div><strong>{dailyOpening ? 'Opening checklist still has work to complete' : 'Opening checklist has not been started today'}</strong><p>Check service readiness before the shift begins. This reminder does not block an urgent operational start.</p></div><HposButton onClick={() => { window.location.hash = '/hpos/control' }}>Open checks</HposButton></section>}
    <section className="hpos-my-shift-card">
      <div className="hpos-my-shift-status">
        <span className={shift || attendance ? 'is-open' : ''}><Clock3 size={24} /></span>
        <div><p>{shift ? 'Till shift open' : attendance ? 'Attendance active' : 'Not clocked in'}</p><h2>{user?.name || user?.email || 'Service team member'}</h2></div>
        <HposStatusBadge tone={shift || attendance ? 'success' : 'neutral'}>{shift ? 'Ready for service' : attendance ? 'Clock out when finished' : 'Start before payments'}</HposStatusBadge>
      </div>
      <label className="hpos-my-shift-outlet"><Store size={17}/><span>Service outlet</span><select value={outletId} onChange={(event) => changeOutlet(event.target.value)} disabled={loading || saving || Boolean(shift)}>{outlets.map((outlet) => <option key={outlet.id} value={outlet.id}>{outlet.name}</option>)}</select></label>
      {!outlets.length && !loading && <div className="hpos-my-shift-warning">No service outlet is assigned to this account. Ask an administrator to assign one in Staff Management.</div>}
      {shift || attendance ? <div className="hpos-my-shift-open-details"><div><small>Started</small><strong>{formatTime(shift?.opened_at || attendance?.clock_in)}</strong></div><div><small>Opening float</small><strong>{shift ? Number(shift.opening_float || 0).toFixed(2) : '—'}</strong></div><div><small>Outlet</small><strong>{activeOutlet?.name || shift?.outlet_name || 'Assigned outlet'}</strong></div><div className="hpos-my-shift-manager-note">{shift ? cashupSubmission?.status === 'submitted' ? 'Cash-up submitted. You can clock out attendance while a manager reviews the handover.' : activeOutlet?.cash_model === 'shared_drawer' ? 'This outlet counts one shared drawer — no personal cash-up is needed. Record handovers in Staff shift close.' : 'Submit My Cash-up before clocking out. A supervisor or manager reviews it later.' : 'Your Till shift is closed. You can now clock out of attendance.'}</div>{shift && <><HposButton tone="primary" icon={ArrowRight} onClick={() => { window.location.hash = '/hpos/pos' }}>Go to Till</HposButton><HposButton icon={ShieldAlert} onClick={() => { window.location.hash = '/hpos/sale-correction' }}>Request sale correction</HposButton>{activeOutlet?.cash_model === 'shared_drawer' ? <HposButton icon={WalletCards} onClick={() => { window.location.hash = '/hpos/shift-close' }}>Go to Staff shift close</HposButton> : <HposButton icon={WalletCards} onClick={() => { window.location.hash = '/hpos/my-cashup' }}>Go to My Cash-up</HposButton>}</>}{attendance && <HposButton icon={LogOut} onClick={clockOut} disabled={saving}>{saving ? 'Clocking out…' : 'Clock out attendance'}</HposButton>}</div> : <div className="hpos-my-shift-start"><label><CircleDollarSign size={18}/><span>Opening cash float</span><input type="number" min="0" step="0.01" inputMode="decimal" value={openingFloat} onChange={(event) => setOpeningFloat(event.target.value)} placeholder="0.00" disabled={loading || saving || !outletId}/></label><p>Enter the float explicitly each shift — type 0.00 when you have no cash float. You cannot take payment until this shift is open.</p><HposButton tone="primary" icon={LogIn} onClick={startShift} disabled={loading || saving || !outletId || String(openingFloat ?? '').trim() === ''}>{saving ? 'Starting shift…' : 'Start my shift'}</HposButton></div>}
    </section>
    {shift && <section className="hpos-my-shift-card" aria-label="Shift handover">
      <div className="hpos-my-shift-open-details">
        <div><small>Sales completed</small><strong>{handover ? (handover.salesReady ? handover.salesCount : 'Unavailable') : '…'}</strong></div>
        <div><small>Open tabs</small><strong>{handover ? (handover.tabsReady ? handover.tabs.length : 'Unavailable') : '…'}</strong></div>
        <div><small>Waste this shift</small><strong>{!canHandoverWaste ? 'Needs stock permission' : handover ? (handover.wasteReady ? handover.wasteText : 'Unavailable') : '…'}</strong></div>
        <div><small>Cash-up</small><strong>{!cashupSubmission ? 'Not submitted' : cashupSubmission.status === 'approved' ? 'Approved' : cashupSubmission.status === 'submitted' ? 'Submitted' : String(cashupSubmission.status || 'In progress')}</strong></div>
        {handover && handover.tabsReady && handover.tabs.length > 0 && <div className="hpos-my-shift-manager-note">Open now: {handover.tabs.map((tab) => tab.waiter ? `${tab.name} (${tab.waiter})` : tab.name).join(' · ')}</div>}
      </div>
    </section>}
    {!barOnly && <section className="hpos-staff-feedback-card">
      <div><span><MessageSquareHeart size={20}/></span><div><p>Guest voice</p><h2>Log guest feedback</h2><small>Send a compliment, concern or request to the manager follow-up queue.</small></div></div>
      <form onSubmit={submitFeedback}><label>Rating<select value={feedback.rating} onChange={(event) => setFeedback({ ...feedback, rating: event.target.value })}>{[5, 4, 3, 2, 1].map((rating) => <option key={rating} value={rating}>{rating} / 5</option>)}</select></label><label>Channel<select value={feedback.channel} onChange={(event) => setFeedback({ ...feedback, channel: event.target.value })}>{['in_store', 'phone', 'online', 'delivery_platform'].map((channel) => <option key={channel} value={channel}>{channel.replaceAll('_', ' ')}</option>)}</select></label><label className="is-wide">What did the guest say?<textarea required rows="3" value={feedback.message} onChange={(event) => setFeedback({ ...feedback, message: event.target.value })} placeholder="Keep it factual so the manager can follow up." /></label><HposButton tone="primary" type="submit" disabled={feedbackSaving || !feedback.message.trim()}>{feedbackSaving ? 'Sending…' : 'Send to manager'}</HposButton></form>
    </section>}
    <MyStaffPinCard />
  </div>
}
