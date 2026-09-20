import { AlertCircle, ShieldCheck, X } from 'lucide-react'
import { ErrorNotice } from '../shared/ErrorNotice'

export default function HposTillOperatorDialog({ staff = [], staffId, pin, error, busy, onStaff, onPin, onConfirm, onClose, activeStaffIds = null, isOnline = null }) {
  const append = (value) => onPin(`${pin}${value}`.slice(0, 6))
  // Defensive copy: older main builds may return a bare wrong-PIN message.
  // Every bartender, cashier and operator must see the admin-reset path.
  const displayError = (() => {
    const text = String(error || '');
    if (!text) return '';
    if (text.includes('ask an admin to reset it')) return text;
    if (/incorrect staff pin|invalid pin/i.test(text)) {
      return `${text.replace(/\s+$/, '')} If you forgot it, ask an admin to reset it in Staff Management.`;
    }
    return text;
  })();
  // Online unlocks require prior clock-in (the server refuses anyone else),
  // so only staff on shift are listed. Offline unlocks auto-create attendance
  // and unknown states fail open to today's full list — the server stays the
  // backstop either way.
  const canFilter = isOnline === true && Array.isArray(activeStaffIds);
  const activeSet = canFilter ? new Set(activeStaffIds.map((id) => String(id))) : null;
  const visibleStaff = canFilter ? staff.filter((member) => activeSet.has(String(member.id))) : staff;
  const effectiveStaffId = visibleStaff.some((member) => member.id === staffId) ? staffId : '';
  return <div className="hpos-modal-backdrop hpos-till-unlock-backdrop" role="presentation"><section className="hpos-till-unlock" role="dialog" aria-modal="true" aria-labelledby="hpos-till-unlock-title"><button type="button" className="hpos-service-dialog__close" onClick={onClose} disabled={busy} aria-label="Close"><X size={18}/></button><div className="hpos-till-unlock-head"><span><ShieldCheck size={25}/></span><div><p>Shared Till</p><h2 id="hpos-till-unlock-title">Who is taking this order?</h2><small>{canFilter ? 'Only staff currently clocked in are listed. Your sales and cash-up stay assigned to you.' : 'Choose your name and enter your private Staff PIN. Your sales and cash-up stay assigned to you.'}</small></div></div>{displayError && <ErrorNotice className="hpos-till-unlock-error" scrollInDialog><AlertCircle size={18}/><span>{displayError}</span></ErrorNotice>}{canFilter && visibleStaff.length === 0 ? (<div className="hpos-till-unlock-empty" role="status"><strong>No one is clocked in right now.</strong><span>Clock in at Staff shift close first — the Till only unlocks for staff on shift.</span></div>) : (<><div className="hpos-till-staff-grid">{visibleStaff.map((member) => <button key={member.id} type="button" className={effectiveStaffId === member.id ? 'is-selected' : ''} onClick={() => { onStaff(member.id); onPin('') }} disabled={busy || !member.has_pin}><strong>{member.name || member.email}</strong><small>{member.has_pin ? 'Tap to select' : 'PIN setup required'}</small></button>)}</div><div className="hpos-till-pin"><span>Staff PIN</span><strong>{pin ? '•'.repeat(pin.length) : 'Enter PIN'}</strong><div className="hpos-till-keypad">{[1,2,3,4,5,6,7,8,9].map((number) => <button key={number} type="button" onClick={() => append(number)} disabled={!effectiveStaffId || busy}>{number}</button>)}<button type="button" onClick={() => onPin('')} disabled={!pin || busy}>Clear</button><button type="button" onClick={() => append(0)} disabled={!effectiveStaffId || busy}>0</button><button type="button" onClick={() => onPin(pin.slice(0, -1))} disabled={!pin || busy}>⌫</button></div></div><button type="button" className="hpos-primary-action hpos-till-unlock-confirm" onClick={onConfirm} disabled={!effectiveStaffId || !pin || busy}>{busy ? 'Checking PIN…' : 'Unlock Till'}</button></>)}</section></div>
}
