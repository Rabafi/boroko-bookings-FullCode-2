import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Clock3, History, LogIn, LogOut, Users } from 'lucide-react';
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
  const [clockInRole, setClockInRole] = useState('cashier');
  const [expectedHours, setExpectedHours] = useState('8');
  const [actionError, setActionError] = useState('');
  const [notice, setNotice] = useState('');

  const refreshShifts = useCallback(async () => {
    const [data, staffRows] = await Promise.all([window.api?.pos?.getActiveShifts?.() ?? [], window.api?.pos?.getStaff?.() ?? []]);
    setShifts(Array.isArray(data) ? data : []);
    setStaff(Array.isArray(staffRows) ? staffRows.filter((row) => row.status !== 'suspended' && row.status !== 'inactive') : []);
  }, []);

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const [data, staffRows] = await Promise.all([window.api?.pos?.getActiveShifts?.() ?? [], window.api?.pos?.getStaff?.() ?? []]);
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

  const clockOut = async (shift) => {
    setSaving(true);
    setActionError('');
    setNotice('');
    try {
      const result = await window.api?.pos?.clockOutStaff?.({ shiftId: shift.id });
      if (result?.success === false) throw new Error(result.error || 'Clock-out failed.');
      setNotice(`${shift.staff_name || shift.name || 'Staff member'} clocked out.`);
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
            <div><h2>Active roster</h2><p>{shifts.length} people currently accountable.</p></div>
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
              {shifts.map((shift) => (
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
                  {canManage && (
                    <button type="button" className="hpos-danger-action" disabled={saving} onClick={() => clockOut(shift)}>
                      <LogOut size={15} /> Clock out
                    </button>
                  )}
                </article>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
