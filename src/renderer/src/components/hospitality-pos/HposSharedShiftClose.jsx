import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Banknote, CheckCircle2, Clock3, LogIn, LogOut, RefreshCw, ShieldCheck, Users, WalletCards } from 'lucide-react'
import { HposButton, HposNotice, HposPageHero, HposStatusBadge } from './HposUi'
import HposDrawerMovements from './HposDrawerMovements'
import { useAuth, useSettings } from '../../app-context'
import { isBarOnlyMode } from '../../../../shared/propertyTypes'
import { clearCashupSubmissionRound, getCashupSubmissionRound } from '../../utils/cashupSubmission'

// Combined shared-terminal screen: Clock in/out (HposAttendanceKiosk) +
// Staff cash-up (HposSharedCashup) in one place with one name + one PIN.
//
// Financial rules preserved:
// - Blind count: the operator never sees the expected drawer total or variance.
// - Same authoritative RPCs + same stable idempotency keys as the two
//   separate pages (no new business model, no new queue contract).
// - Clock-out with an open Till shift still requires a submitted/approved
//   cash-up; the server + offline domain enforce this. The UI only offers
//   "clock out without cash-up" when no open Till shift was found.
export default function HposSharedShiftClose() {
  const { user } = useAuth()
  const { settings } = useSettings()
  const barOnly = isBarOnlyMode(settings)
  const lodgeId = user?.lodge_id || ''
  const managerActorId = user?.id || ''

  const [staff, setStaff] = useState([])
  const [shifts, setShifts] = useState([])
  const [outlets, setOutlets] = useState([])
  const [drawerOutletPick, setDrawerOutletPick] = useState('')
  // Shift tab holds clock in/out + personal cash-up; Drawer tab holds the
  // shared drawer. Both share the person + PIN header above, so one PIN
  // proves everything on this screen and there is nothing to pick twice.
  const [activeTab, setActiveTab] = useState('shift')
  const [staffId, setStaffId] = useState('')
  const [pin, setPin] = useState('')
  const [role, setRole] = useState(barOnly ? 'bar' : 'waiter')
  const [hours, setHours] = useState('8')
  const [posShift, setPosShift] = useState(null)
  const [submission, setSubmission] = useState(null)
  const [cash, setCash] = useState('')
  const [resolvingShift, setResolvingShift] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  // Errors render above the card; the action buttons sit below it, so a new
  // error would otherwise stay hidden off-screen. Bring it to the user.
  const errorAnchorRef = useRef(null)
  useEffect(() => {
    if (!error || !errorAnchorRef.current) return
    try {
      errorAnchorRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' })
    } catch {
      /* scroll is best-effort; focus below still moves assistive tech */
    }
    try {
      errorAnchorRef.current.focus?.({ preventScroll: true })
    } catch {
      /* older shells ignore focus options */
    }
  }, [error])

  const refresh = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [staffRows, shiftRows, outletRows] = await Promise.all([
        window.api?.pos?.getStaff?.() || [],
        window.api?.pos?.getActiveShifts?.() || [],
        window.api?.outlets?.getAll?.().catch(() => []) || [],
      ])
      setStaff((Array.isArray(staffRows) ? staffRows : []).filter(
        (row) => !['suspended', 'inactive'].includes(String(row.status || 'active').toLowerCase()),
      ))
      setShifts(Array.isArray(shiftRows) ? shiftRows : [])
      setOutlets(Array.isArray(outletRows) ? outletRows : [])
    } catch (loadError) {
      setError(loadError?.message || 'Could not load the shared shift screen.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { refresh() }, [refresh])

  // Cash model of the operator's outlet. Shared drawers reconcile
  // collectively below; personal outlets keep the personal cash-up above.
  // Unknown models fail closed to the personal flow.
  const [outletCashModel, setOutletCashModel] = useState(null)
  useEffect(() => {
    let active = true
    if (!posShift?.outlet_id) { setOutletCashModel(null); return undefined }
    window.api?.outlets?.getAll?.().then((rows) => {
      if (!active) return
      const found = (Array.isArray(rows) ? rows : []).find((row) => String(row.id) === String(posShift.outlet_id))
      setOutletCashModel(found?.cash_model === 'shared_drawer' ? 'shared_drawer' : 'personal_bank')
    }).catch(() => { if (active) setOutletCashModel('personal_bank') })
    return () => { active = false }
  }, [posShift?.outlet_id])

  const member = useMemo(() => staff.find((row) => row.id === staffId) || null, [staff, staffId])
  const activeShift = useMemo(() => shifts.find((row) => row.staff_user_id === staffId) || null, [shifts, staffId])
  // Drawer outlet without a Till shift: the drawer is per-outlet, so the Till
  // shift was only ever outlet context. One outlet resolves itself; several
  // get a picker. Shared model only — personal outlets keep the no-till
  // clock-out path unchanged, and a failed outlet read hides the card.
  const drawerOutletId = (!posShift && outlets.length === 1 ? outlets[0]?.id || '' : (!posShift ? drawerOutletPick : '')) || ''
  const drawerOutlet = useMemo(() => outlets.find((row) => String(row?.id || '') === String(drawerOutletId || '')) || null, [outlets, drawerOutletId])
  const showDrawerWithoutTill = Boolean(activeShift && !resolvingShift && !posShift && drawerOutletId && drawerOutlet?.cash_model === 'shared_drawer')
  // The clock-in notice renders at the top while the drawer card sits below
  // the fold on small terminals: bring the card to the operator exactly once
  // when it appears, the same pattern as the error anchor above.
  const drawerAnchorRef = useRef(null)
  const drawerWasVisibleRef = useRef(false)
  const drawerPromptedRef = useRef(false)
  const drawerTabAvailable = Boolean(member && activeShift && !resolvingShift && ((posShift && outletCashModel === 'shared_drawer') || (!posShift && outlets.length > 0)))
  const drawerPanelVisible = Boolean(activeTab === 'drawer' && drawerTabAvailable && ((posShift && outletCashModel === 'shared_drawer') || showDrawerWithoutTill))
  useEffect(() => {
    // First person on shift lands on the drawer prompt without a second pick
    // or a tab hunt. Manual tab choices afterwards are never overridden.
    if (showDrawerWithoutTill && !drawerPromptedRef.current) {
      drawerPromptedRef.current = true
      setActiveTab('drawer')
    }
  }, [showDrawerWithoutTill])
  useEffect(() => {
    // Wait for the view to settle: shift resolution flickers the card
    // (mount, unmount, remount), and scrolling mid-flicker aborts
    // mid-animation, which reads as down-then-back-up. Scroll once, late.
    if (!drawerPanelVisible) {
      drawerWasVisibleRef.current = false
      return undefined
    }
    if (drawerWasVisibleRef.current) return undefined
    const timer = setTimeout(() => {
      drawerWasVisibleRef.current = true
      if (!drawerAnchorRef.current) return
      try {
        drawerAnchorRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' })
      } catch {
        /* scroll is best-effort; focus below still moves assistive tech */
      }
      try {
        drawerAnchorRef.current.focus?.({ preventScroll: true })
      } catch {
        /* older shells ignore focus options */
      }
    }, 500)
    return () => clearTimeout(timer)
  }, [drawerPanelVisible])

  // Resolve the open Till shift + existing cash-up whenever the person changes.
  useEffect(() => {
    let active = true
    setPosShift(null)
    setSubmission(null)
    setSubmitted(false)
    setCash('')
    setResolvingShift(Boolean(staffId && activeShift))
    if (!staffId || !activeShift) {
      setResolvingShift(false)
      return () => { active = false }
    }
    ;(async () => {
      try {
        const shift = await window.api?.pos?.getStaffOpenShift?.(staffId)
        if (!active) return
        setPosShift(shift || null)
        if (shift) {
          const existing = await window.api?.pos?.getStaffCashupSubmission?.(shift.id)
          if (!active) return
          const existingSubmission = existing?.submission || null
          setSubmission(existingSubmission)
          setSubmitted(['submitted', 'approved'].includes(existingSubmission?.status))
          if (['submitted', 'approved'].includes(existingSubmission?.status)) {
            clearCashupSubmissionRound({ lodgeId, shiftId: shift.id, actorId: managerActorId, submissionType: 'shared_terminal' })
          }
          setCash(String(existingSubmission?.counted_by_method?.cash ?? ''))
          if (existingSubmission?.status === 'rejected') {
            setNotice(`Cash-up returned for correction. Manager note: ${existingSubmission.review_notes || 'No note was recorded.'}`)
          }
        }
      } catch (shiftError) {
        if (active) setError(shiftError?.message || 'Could not load this Till shift.')
      } finally {
        if (active) setResolvingShift(false)
      }
    })()
    return () => { active = false }
  }, [staffId, activeShift, lodgeId, managerActorId])

  const pickStaff = (nextId) => {
    setStaffId(nextId)
    setPin('')
    setError('')
    setNotice('')
    setActiveTab('shift')
    drawerPromptedRef.current = false
  }

  const clockIn = async (event) => {
    event?.preventDefault?.()
    if (!member) { setError('Choose your name before continuing.'); return }
    if (!member.has_pin) { setError('This staff account needs a Staff PIN in Staff Management before it can use this screen.'); return }
    if (!pin.trim()) { setError('Enter your private Staff PIN.'); return }
    setSaving(true)
    setError('')
    setNotice('')
    try {
      const keyName = `hpos:pending-attendance:${member.id}:clock-in`
      const operationKey = localStorage.getItem(keyName) || crypto.randomUUID()
      localStorage.setItem(keyName, operationKey)
      const result = await window.api?.pos?.clockInStaffWithAttendancePin?.({
        staff_user_id: member.id,
        pin,
        role,
        expected_hours: Number(hours || 0) || null,
        idempotency_key: operationKey,
      })
      if (!result?.success) throw new Error(result?.error || 'Attendance could not be recorded.')
      localStorage.removeItem(keyName)
      setNotice(`${member.name || member.email || 'Staff member'} is clocked in.`)
      setPin('')
      // Keep the person selected: the first person on shift drops straight
      // into their closing view (and the drawer card) instead of picking
      // their name a second time. The PIN is still cleared — clock-out,
      // cash-up and movements all re-prove with it — so a selected-but-idle
      // terminal cannot move money or close anyone out.
      await refresh()
    } catch (clockInError) {
      setError(clockInError?.message || 'Attendance could not be recorded.')
    } finally {
      setSaving(false)
    }
  }

  const submitCashup = async () => {
    if (!posShift?.id || !pin || cash === '') return
    setSaving(true)
    setError('')
    try {
      const submissionPayload = {
        shift_id: posShift.id,
        counted_by_method: { cash: Number(cash) },
        actor_id: managerActorId || null,
        operator_id: staffId || null,
        submission_type: 'shared_terminal',
      }
      const round = getCashupSubmissionRound({
        lodgeId,
        shiftId: posShift.id,
        actorId: managerActorId,
        operatorId: staffId,
        submissionType: 'shared_terminal',
        payload: submissionPayload,
        serverStatus: submission?.status,
        serverIdempotencyKey: submission?.idempotency_key,
      })
      if (round.conflict || !round.durable || !round.round) {
        throw new Error(round.error || 'The cash-up round was not durably saved. The server call was not sent.')
      }
      const replayPayload = round.round.payload || submissionPayload
      const result = await window.api?.pos?.submitCashupWithAttendancePin?.({
        ...replayPayload,
        pin,
        idempotency_key: round.round.idempotencyKey,
      })
      if (!result?.success) throw new Error(result?.error || 'Could not submit cash-up.')
      clearCashupSubmissionRound({ lodgeId, shiftId: posShift.id, actorId: managerActorId, submissionType: 'shared_terminal' })
      setSubmitted(true)
      setNotice(result?.offline
        ? 'Cash-up is saved on this device and queued. Staff can clock out; manager review is provisional until sync.'
        : 'Cash-up submitted. The staff member can now clock out with the same PIN; manager review happens later.')
    } catch (submitError) {
      setError(submitError?.message || 'Could not submit cash-up.')
    } finally {
      setSaving(false)
    }
  }

  const clockOut = async () => {
    if (!activeShift?.id || !pin) return
    setSaving(true)
    setError('')
    try {
      const keyName = `hpos:pending-attendance:${staffId}:clock-out:${activeShift.id}`
      const operationKey = localStorage.getItem(keyName) || crypto.randomUUID()
      localStorage.setItem(keyName, operationKey)
      const result = await window.api?.pos?.clockOutStaffWithAttendancePin?.({
        shiftId: activeShift.id,
        pin,
        idempotency_key: operationKey,
      })
      if (!result?.success) throw new Error(result?.error || 'Could not clock out.')
      localStorage.removeItem(keyName)
      setNotice(`${member?.name || member?.email || 'Staff member'} is clocked out.${posShift ? ' Their cash-up awaits manager review.' : ''}`)
      setStaffId('')
      setPin('')
      setSubmitted(false)
      await refresh()
    } catch (clockOutError) {
      setError(clockOutError?.message || 'Could not clock out.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="hpos-attendance-kiosk hpos-shared-shift-close">
      <HposPageHero
        eyebrow="Shared terminal"
        title="Staff shift close"
        description="Clock in, count the drawer once, then clock out — one name, one PIN. People who did not touch the till can clock out without a cash-up."
        actions={<HposButton icon={RefreshCw} onClick={refresh} disabled={loading || saving}>Refresh</HposButton>}
      />
      {error && <div ref={errorAnchorRef} tabIndex={-1} data-testid="shared-shift-close-error-anchor"><HposNotice tone="error">{error}</HposNotice></div>}
      {notice && <HposNotice>{notice}</HposNotice>}
      <section className="hpos-attendance-card">
        <header>
          <span>{activeShift ? <WalletCards size={24} /> : <Users size={24} />}</span>
          <div>
            <p>Verified handover</p>
            <h2>{member ? (activeShift ? `Closing ${member.name || member.email}` : `Clocking in ${member.name || member.email}`) : 'Who is using this terminal?'}</h2>
          </div>
          {activeShift && <HposStatusBadge tone="success">Currently on shift</HposStatusBadge>}
        </header>
        <form onSubmit={activeShift ? (event) => event.preventDefault() : clockIn}>
          <label>
            <span>Staff member</span>
            <select value={staffId} onChange={(event) => pickStaff(event.target.value)} disabled={loading || saving}>
              <option value="">Choose staff member</option>
              {staff.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.name || row.email}{row.has_pin ? '' : ' · PIN setup required'}
                </option>
              ))}
            </select>
          </label>

          {member && (
            <label className="hpos-attendance-pin">
              <span><ShieldCheck size={17} /> {activeShift ? 'Staff PIN' : 'Private Staff PIN'}</span>
              <input
                type="password"
                inputMode="numeric"
                autoComplete="one-time-code"
                value={pin}
                onChange={(event) => setPin(event.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder={activeShift ? 'Operator enters PIN' : 'Enter your PIN'}
                disabled={!member || saving}
              />
              <small>The manager stays signed in. This one PIN proves clock-out and cash-up on this screen; drawer moves ask for the operator PIN on the drawer card itself.</small>
            </label>
          )}

          {member && !activeShift && (
            <div className="hpos-attendance-row">
              <label>
                <span>Service role</span>
                <select value={role} onChange={(event) => setRole(event.target.value)} disabled={saving}>
                  {!barOnly && <option value="waiter">Waiter</option>}
                  <option value="cashier">Cashier</option>
                  <option value="bar">Bartender</option>
                  {!barOnly && <option value="kitchen">Kitchen</option>}
                  <option value="manager">Manager</option>
                </select>
              </label>
              <label>
                <span>Expected hours</span>
                <input type="number" min="1" max="24" step="0.5" value={hours} onChange={(event) => setHours(event.target.value)} disabled={saving} />
              </label>
            </div>
          )}

          {activeShift && resolvingShift && <HposNotice>Loading this person’s Till shift…</HposNotice>}

          {member && activeShift && !resolvingShift && drawerTabAvailable && (
            <div className="hpos-attendance-row" role="tablist" aria-label="Shift close sections">
              <HposButton tone={activeTab === 'shift' ? 'primary' : 'secondary'} role="tab" aria-selected={activeTab === 'shift'} onClick={() => setActiveTab('shift')}>Shift & cash-up</HposButton>
              <HposButton tone={activeTab === 'drawer' ? 'primary' : 'secondary'} role="tab" aria-selected={activeTab === 'drawer'} onClick={() => setActiveTab('drawer')}>Shared drawer</HposButton>
            </div>
          )}

          {(!drawerTabAvailable || activeTab === 'shift') && (<>

          {activeShift && !resolvingShift && !posShift && (
            <HposNotice>
              No open Till sales found for {member?.name || member?.email || 'this person'} — they can clock out without a cash-up.
            </HposNotice>
          )}

          {activeShift && !resolvingShift && posShift && (outletCashModel === 'shared_drawer' ? (
            <HposNotice>
              Till sales go to one shared drawer. Record drops and handovers in the Drawer tab — no personal cash-up is needed here.
            </HposNotice>
          ) : (
            <>
              <div className="hpos-my-cashup-figures">
                <article><small>Cash to count</small><strong>Enter from the drawer</strong></article>
              </div>
              <label>
                <span><Banknote size={17} /> Physical cash counted</span>
                <input type="number" min="0" step="0.01" value={cash} onChange={(event) => setCash(event.target.value)} disabled={saving || submitted} />
                <small>Cash tips kept from all-cash sales remain excluded from the handover. Expected totals and variances are intentionally withheld from the operator.</small>
              </label>
              {!submitted && (
                <HposButton tone="primary" icon={CheckCircle2} onClick={submitCashup} disabled={!posShift || !pin || cash === '' || saving}>
                  {saving ? 'Submitting…' : 'Submit cash-up'}
                </HposButton>
              )}
              {submitted && (
                <HposNotice>Cash-up submitted. Clock out below with the same PIN; manager review happens later.</HposNotice>
              )}
              <p className="hpos-attendance-cashup-note">
                Till sales exist for this shift, so clock-out stays blocked until the cash-up is submitted.
              </p>
            </>
          ))}

          {!activeShift ? (
            <HposButton tone="primary" icon={LogIn} type="submit" disabled={!member || !pin || saving}>
              {saving ? 'Recording…' : 'Clock in'}
            </HposButton>
          ) : !resolvingShift && !posShift ? (
            <HposButton tone="primary" icon={LogOut} onClick={clockOut} disabled={!pin || saving}>
              {saving ? 'Clocking out…' : 'Clock out without cash-up'}
            </HposButton>
          ) : !resolvingShift && posShift ? (
            <HposButton tone="primary" icon={LogOut} onClick={clockOut} disabled={!pin || saving || (outletCashModel !== 'shared_drawer' && !submitted)}>
              {saving ? 'Clocking out…' : (submitted || outletCashModel === 'shared_drawer') ? 'Clock out staff' : 'Submit cash-up first'}
            </HposButton>
          ) : null}
          </>)}
        </form>
      </section>
      {activeTab === 'drawer' && drawerTabAvailable && (
        <>
          {!posShift && outlets.length > 1 && (
            <section className="hpos-attendance-card" aria-label="Shared drawer outlet">
              <div style={{ display: 'grid', gap: '12px', padding: '24px' }}>
                <label className="hpos-my-shift-outlet"><span>Shared drawer outlet</span><select value={drawerOutletPick} onChange={(event) => setDrawerOutletPick(event.target.value)} disabled={saving}><option value="">Choose outlet</option>{outlets.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label>
              </div>
            </section>
          )}
          {posShift && outletCashModel === 'shared_drawer' && (
            <HposDrawerMovements outletId={posShift.outlet_id} staffId={staffId} />
          )}
          {showDrawerWithoutTill && (
            <div ref={drawerAnchorRef} tabIndex={-1} data-testid="shared-shift-close-drawer-anchor">
              <HposDrawerMovements outletId={drawerOutletId} staffId={staffId} />
            </div>
          )}
          {!posShift && !showDrawerWithoutTill && drawerOutletId && (
            <HposNotice>This outlet counts separate pouches — the personal cash-up lives in the Shift tab.</HposNotice>
          )}
          {!posShift && !showDrawerWithoutTill && !drawerOutletId && (
            <HposNotice>Choose an outlet above to see its shared drawer.</HposNotice>
          )}
        </>
      )}
      <section className="hpos-attendance-active">
        <div><Clock3 size={18} /><strong>On shift now</strong><span>{shifts.length} active</span></div>
        {shifts.length
          ? <p>{shifts.map((shift) => shift.staff_name || 'Staff member').join(' · ')}</p>
          : <p>No staff are currently clocked in.</p>}
      </section>
    </div>
  )
}
