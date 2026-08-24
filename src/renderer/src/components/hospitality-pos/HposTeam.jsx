import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { Clock3, History, LogIn, LogOut, MessageSquareText, Users } from 'lucide-react';
import { useAccess, useSettings } from '../../app-context';
import { canAccessCapability } from '../../../../shared/accessControl';
import { isBarOnlyMode } from '../../../../shared/propertyTypes';
import {
  HposButton,
  HposEmptyState,
  HposNotice,
  HposPageHero,
  HposStatusBadge,
} from './HposUi';

const startedAt = (shift) => shift.clock_in || shift.clock_in_at || shift.started_at;

function elapsedLabel(shift) {
  const start = new Date(startedAt(shift) || 0).getTime();
  if (!Number.isFinite(start) || start <= 0) return 'Time unavailable';
  const minutes = Math.max(0, Math.floor((Date.now() - start) / 60000));
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

export default function HposTeam() {
  const navigate = useNavigate();
  const access = useAccess();
  const { settings } = useSettings();
  const barOnly = isBarOnlyMode(settings);
  const canManage = canAccessCapability(access, 'pos.manage');
  const [shifts, setShifts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [clockInName, setClockInName] = useState('');
  const [staff, setStaff] = useState([]);
  const [clockInStaffId, setClockInStaffId] = useState('');
  const [attendancePin, setAttendancePin] = useState('');
  const [clockOutTarget, setClockOutTarget] = useState(null);
  const [clockOutPin, setClockOutPin] = useState('');
  const [clockInRole, setClockInRole] = useState('cashier');
  const [expectedHours, setExpectedHours] = useState('8');
  const [actionError, setActionError] = useState('');
  const [notice, setNotice] = useState('');
  const [roleFilter, setRoleFilter] = useState('all');
  const [handoverTarget, setHandoverTarget] = useState(null);
  const [handoverNote, setHandoverNote] = useState('');
  const [handoverOperationId, setHandoverOperationId] = useState('');

  const refreshShifts = useCallback(async () => {
    const [data, staffRows] = await Promise.all([window.api?.pos?.getBarActiveShifts?.() ?? window.api?.pos?.getActiveShifts?.() ?? [], window.api?.pos?.getStaff?.() ?? []]);
    setShifts(Array.isArray(data) ? data : []);
    setStaff(Array.isArray(staffRows) ? staffRows.filter((row) => row.status !== 'suspended' && row.status !== 'inactive') : []);
  }, []);

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
      const [data, staffRows] = await Promise.all([window.api?.pos?.getBarActiveShifts?.() ?? window.api?.pos?.getActiveShifts?.() ?? [], window.api?.pos?.getStaff?.() ?? []]);
        if (active) { setShifts(Array.isArray(data) ? data : []); setStaff(Array.isArray(staffRows) ? staffRows.filter((row) => row.status !== 'suspended' && row.status !== 'inactive') : []) }
      } catch (error) {
        if (active) setActionError(error?.message || 'Active shifts could not be loaded.');
      } finally {
        if (active) setLoading(false);
      }
    };
    load();
    return () => {
      active = false;
    };
  }, []);

  const roleCounts = useMemo(
    () =>
      shifts.reduce((counts, shift) => {
        const role = String(shift.role || 'staff').toLowerCase();
        counts[role] = (counts[role] || 0) + 1;
        return counts;
      }, {}),
    [shifts],
  );
  const visibleShifts = useMemo(() => roleFilter === 'all'
    ? shifts
    : shifts.filter((shift) => String(shift.role || 'staff').toLowerCase() === roleFilter), [roleFilter, shifts]);
  const roleOptions = useMemo(() => [...new Set(shifts.map((shift) => String(shift.role || 'staff').toLowerCase()))].sort(), [shifts]);

  const saveHandoverNote = async (event) => {
    event.preventDefault();
    const shift = handoverTarget;
    const note = handoverNote.trim();
    if (!shift?.id || !note || !handoverOperationId || saving) return;
    setSaving(true); setActionError(''); setNotice('');
    try {
      const result = await window.api?.pos?.saveShiftHandoverNote?.({
        shift_id: shift.id,
        note,
        operation_id: handoverOperationId,
      });
      if (!result?.success) throw new Error(result?.error || 'The handover note could not be saved.');
      setNotice('Handover note saved to the shared shift record.');
      setHandoverTarget(null); setHandoverNote(''); setHandoverOperationId('');
      await refreshShifts();
    } catch (error) {
      setActionError(error?.message || 'The handover note could not be saved.');
    } finally { setSaving(false); }
  };

  const clockIn = async (event) => {
    event.preventDefault();
    if (!clockInStaffId) {
      setActionError('Choose the staff member who is clocking in.');
      return;
    }
    if (!attendancePin.trim()) {
      setActionError('The staff member must enter their private attendance PIN.');
      return;
    }
    setSaving(true);
    setActionError('');
    setNotice('');
    try {
      const selected = staff.find((row) => row.id === clockInStaffId);
      const result = await window.api?.pos?.clockInStaffWithAttendancePin?.({
        staff_user_id: clockInStaffId,
        pin: attendancePin,
        role: clockInRole,
        expected_hours: Number(expectedHours || 0) || null,
        idempotency_key: crypto.randomUUID(),
      });
      if (result?.success === false) throw new Error(result.error || 'Clock-in failed.');
      setNotice(`${selected?.name || 'Staff member'} is now on shift.`);
      setClockInName(''); setClockInStaffId(''); setAttendancePin('');
      await refreshShifts();
    } catch (error) {
      setActionError(error?.message || 'Could not clock in this staff member.');
    } finally {
      setSaving(false);
    }
  };

  const requestClockOut = (shift) => {
    setActionError('');
    setNotice('');
    setClockOutPin('');
    setClockOutTarget({ shift, idempotencyKey: crypto.randomUUID() });
  };

  const clockOut = async (event) => {
    event.preventDefault();
    const shift = clockOutTarget?.shift;
    if (!shift?.id) return;
    if (!clockOutPin.trim()) {
      setActionError('The staff member must enter their private attendance PIN to clock out.');
      return;
    }
    setSaving(true);
    setActionError('');
    setNotice('');
    try {
      const result = await window.api?.pos?.clockOutStaffWithAttendancePin?.({
        shiftId: shift.id,
        pin: clockOutPin,
        idempotency_key: clockOutTarget.idempotencyKey,
      });
      if (result?.success === false) throw new Error(result.error || 'Clock-out failed.');
      setNotice(`${shift.staff_name || shift.name || 'Staff member'} clocked out.`);
      setClockOutTarget(null);
      setClockOutPin('');
      await refreshShifts();
    } catch (error) {
      setActionError(error?.message || 'Could not clock out this staff member.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="hpos-page-frame hpos-team-page">
      <HposPageHero
        eyebrow="Live service team"
        title={barOnly ? 'Bar shift board' : 'Restaurant shift board'}
        description="See who is accountable on this service, then hand longer-term scheduling and performance work to the manager workspace."
        actions={
          !barOnly && canManage ? (
            <HposButton icon={History} onClick={() => navigate('/restaurant/team-workspace')}>
              Team planning
            </HposButton>
          ) : null
        }
      />

      {actionError && <HposNotice tone="error">{actionError}</HposNotice>}
      {notice && <HposNotice>{notice}</HposNotice>}

      <section className="hpos-team-summary" aria-label="Active shift summary">
        <article>
          <span className="hpos-team-summary-icon"><Users size={20} /></span>
          <div><small>On shift now</small><strong>{loading ? '—' : shifts.length}</strong></div>
        </article>
        <article>
          <span className="hpos-team-summary-icon"><Clock3 size={20} /></span>
          <div><small>Coverage</small><strong>{Object.keys(roleCounts).length || 0} roles</strong></div>
        </article>
        <div className="hpos-team-role-chips">
          {Object.entries(roleCounts).map(([role, count]) => (
            <HposStatusBadge key={role}>{count} {role.replaceAll('_', ' ')}</HposStatusBadge>
          ))}
          {!loading && shifts.length === 0 && <span>No active coverage recorded</span>}
        </div>
      </section>

      <div className="hpos-team-tools" aria-label="Team filters">
        <label>Role filter<select value={roleFilter} onChange={(event) => setRoleFilter(event.target.value)}><option value="all">All roles</option>{roleOptions.map((role) => <option key={role} value={role}>{role.replaceAll('_', ' ')}</option>)}</select></label>
        <span>{visibleShifts.length} of {shifts.length} active shifts shown</span>
      </div>

      <div className="hpos-team-layout">
        {canManage && (
          <form className="hpos-team-clockin" onSubmit={clockIn}>
            <div className="hpos-section-heading">
              <span><LogIn size={18} /></span>
              <div><h2>Start a shift</h2><p>Record who is taking responsibility for service.</p></div>
            </div>
            <label>
              Staff member
              <select value={clockInStaffId} onChange={(event) => setClockInStaffId(event.target.value)}>
                <option value="">Choose a team member</option>
                {staff.map((member) => <option key={member.id} value={member.id}>{member.name || member.email}</option>)}
              </select>
            </label>
            <div className="hpos-form-pair">
              <label>
                Service role
                <select value={clockInRole} onChange={(event) => setClockInRole(event.target.value)}>
                  {!barOnly && <option value="waiter">Waiter</option>}
                  <option value="cashier">Cashier</option>
                  <option value="bar">Bartender</option>
                  {!barOnly && <option value="kitchen">Chef</option>}
                  <option value="manager">Manager</option>
                </select>
              </label>
              <label>
                Expected hours
                <input
                  type="number"
                  min="1"
                  max="24"
                  step="0.5"
                  value={expectedHours}
                  onChange={(event) => setExpectedHours(event.target.value)}
                />
              </label>
            </div>
            <label>
              Staff attendance PIN
              <input type="password" inputMode="numeric" autoComplete="one-time-code" value={attendancePin} onChange={(event) => setAttendancePin(event.target.value)} placeholder="Entered by staff member" />
              <small className="hpos-form-help">The manager operates this board; the worker enters their own PIN. The PIN is not displayed or stored here.</small>
            </label>
            <HposButton type="submit" tone="primary" icon={LogIn} disabled={saving}>
              {saving ? 'Saving…' : 'Clock in'}
            </HposButton>
          </form>
        )}

        <section className={canManage ? 'hpos-team-roster' : 'hpos-team-roster is-wide'}>
          <div className="hpos-section-heading">
            <span><Users size={18} /></span>
            <div><h2>On-shift team</h2><p>{shifts.length} people currently accountable.</p></div>
          </div>
          {loading ? (
            <div className="hpos-list-loading">Loading active shifts…</div>
          ) : shifts.length === 0 ? (
            <HposEmptyState
              icon={Users}
              title="No active shifts"
              description={canManage ? 'Use the shift form to clock in the first service team member.' : 'A manager can open the next shift.'}
            />
          ) : (
            <div className="hpos-shift-list">
              {visibleShifts.map((shift) => (
                <article key={shift.id} className="hpos-shift-row">
                  <span className="hpos-shift-avatar">
                    {(shift.staff_name || shift.name || 'S').charAt(0).toUpperCase()}
                  </span>
                  <div className="hpos-shift-person">
                    <strong>{shift.staff_name || shift.name || 'Staff member'}</strong>
                    <span>{String(shift.role || 'Staff').replaceAll('_', ' ')}</span>
                  </div>
                  <div className="hpos-shift-time">
                    <strong>{elapsedLabel(shift)}</strong>
                    <span>{startedAt(shift) ? new Date(startedAt(shift)).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : 'Start unavailable'}</span>
                  </div>
                  <div className="hpos-shift-handover">
                    {Array.isArray(shift.handover_notes) && shift.handover_notes.length > 0 && <small title={shift.handover_notes[0].note}>Note: {shift.handover_notes[0].note}</small>}
                    {canManage && <button type="button" className="hpos-secondary-action" disabled={saving} onClick={() => { setHandoverTarget(shift); setHandoverNote(''); setHandoverOperationId(crypto.randomUUID()); setActionError(''); }}><MessageSquareText size={15} /> Add handover</button>}
                  </div>
                  {canManage && (
                    <button type="button" className="hpos-danger-action" disabled={saving} onClick={() => requestClockOut(shift)}>
                      <LogOut size={15} /> Clock out
                    </button>
                  )}
                </article>
              ))}
            </div>
          )}
        </section>
      </div>

      {clockOutTarget && (
        <div className="hpos-modal-backdrop" role="presentation">
          <form className="hpos-expense-form" onSubmit={clockOut} role="dialog" aria-modal="true" aria-labelledby="clock-out-title">
            <div className="hpos-section-heading">
              <span><LogOut size={18} /></span>
              <div><h2 id="clock-out-title">Protect clock-out</h2><p>{clockOutTarget.shift.staff_name || clockOutTarget.shift.name || 'Staff member'} must enter their private attendance PIN.</p></div>
            </div>
            {actionError && <HposNotice tone="error">{actionError}</HposNotice>}
            <label>
              Private attendance PIN
              <input type="password" inputMode="numeric" autoComplete="one-time-code" autoFocus value={clockOutPin} onChange={(event) => setClockOutPin(event.target.value)} placeholder="Entered by staff member" />
              <small className="hpos-form-help">The PIN is verified by the server and is not stored in this form.</small>
            </label>
            <div className="hpos-device-actions">
              <HposButton type="button" onClick={() => { setClockOutTarget(null); setClockOutPin(''); }}>Cancel</HposButton>
              <HposButton type="submit" tone="primary" icon={LogOut} disabled={saving}>{saving ? 'Verifying…' : 'Verify & clock out'}</HposButton>
            </div>
          </form>
        </div>
      )}
      {handoverTarget && <div className="hpos-modal-backdrop" role="presentation"><form className="hpos-expense-form" onSubmit={saveHandoverNote} role="dialog" aria-modal="true" aria-labelledby="handover-note-title"><div className="hpos-section-heading"><span><MessageSquareText size={18} /></span><div><h2 id="handover-note-title">Shift handover note</h2><p>{handoverTarget.staff_name || 'Staff member'} · shared with the authorised service team</p></div></div><label>What should the next operator know?<textarea rows="5" maxLength="1000" required value={handoverNote} onChange={(event) => setHandoverNote(event.target.value)} placeholder="Keep it factual: open guest request, stock watch-out or service follow-up." disabled={saving} /><small className="hpos-form-help">Saved to the server shift record. Do not include PINs or sensitive guest payment details.</small></label><div className="hpos-device-actions"><HposButton type="button" onClick={() => { setHandoverTarget(null); setHandoverNote(''); setHandoverOperationId(''); }} disabled={saving}>Cancel</HposButton><HposButton type="submit" tone="primary" icon={MessageSquareText} disabled={saving || !handoverNote.trim() || !handoverOperationId}>{saving ? 'Saving…' : 'Save note'}</HposButton></div></form></div>}
    </div>
  );
}
