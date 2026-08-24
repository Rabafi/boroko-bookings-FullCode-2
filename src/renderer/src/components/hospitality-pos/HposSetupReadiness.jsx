import { useCallback, useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Circle, ClipboardCheck, ExternalLink, RefreshCw } from 'lucide-react';
import { useNavigate } from 'react-router';
import { HposButton, HposNotice, HposPageHero, HposStatusBadge } from './HposUi';
import { useSettings } from '../../app-context';
import { isBarOnlyMode } from '../../../../shared/propertyTypes';

const STAGES = [
  ['business_profile', 'Business profile', 'Open Settings and save the venue identity and operating profile.', '/settings'],
  ['tax_service', 'Tax & service settings', 'In Settings, save the tax and service-charge treatment used on receipts.', '/settings'],
  ['outlets', 'Outlets', 'Create each physical outlet that needs separate service or reporting.', '/multi-outlet-pos'],
  ['staff_accounts', 'Staff accounts', 'Add every person who needs to use the system.', '/staff'],
  ['staff_roles', 'Roles & access', 'Assign the least access each staff member needs.', '/staff'],
  ['staff_pins', 'Staff PINs', 'Set PINs for shared-terminal attendance and cash-up.', '/staff'],
  ['floor_plan', 'Floor plan', 'Create tables and service areas before taking table orders.', '/restaurant/floor-workspace'],
  ['menu_categories', 'Menu categories', 'Create at least one category, then group saleable items under it.', '/restaurant/menu-production'],
  ['menu_pricing', 'Menu & pricing', 'Add every saleable item with a positive price and availability.', '/restaurant/menu-production'],
  ['modifiers_combos', 'Inventory catalogue', 'Add each stock item with a unit, opening quantity and reorder point.', '/restaurant/inventory'],
  ['kitchen_stations', 'Stock cost basis', 'Enter a real positive unit cost for every item that contributes to cost reporting.', '/restaurant/inventory'],
  ['inventory', 'Menu-to-stock linkage', 'Link each saleable menu item to its stock item so sales consume and report the correct cost.', '/restaurant/menu-production'],
  ['suppliers_purchasing', 'Suppliers & purchasing', 'Add suppliers before creating or receiving purchase orders.', '/restaurant/inventory'],
  ['recipes_prep', 'Recipes & prep', 'Link ingredients or prep batches where stock should be consumed automatically.', '/restaurant/menu-production'],
  ['payments_tips', 'Payment-tender test', 'Run a supervised paid sale and verify the tender appears correctly in Till and reports.', '/hpos/pos'],
  ['receipt_hardware', 'Cash drawer close', 'Open, count and close a drawer so the first cash reconciliation is proven.', '/hpos/cash'],
  ['daily_checklists', 'Manager cash-up approval', 'Submit a staff cash-up and have a manager approve it with their own PIN.', '/hpos/cash'],
  ['guest_policy', 'Daily operational checklists', 'Create opening, service, safety and closing routines.', '/restaurant/control-workspace'],
  ['data_backup', 'End-of-day owner report', 'Generate the owner digest and verify its sales, tender, tax and exception figures.', '/restaurant/cash-close'],
  ['go_live_review', 'Go-live & recovery proof', 'Run a protected data export after the supervised sale and end-of-day controls.', '/data-management'],
];

const BAR_STAGES = [
  ['business_profile', 'Bar profile', 'Open Settings and confirm the bar name, currency and business details.', '/settings'],
  ['tax_service', 'Tax & receipt settings', 'Confirm the tax and service-charge treatment printed on every receipt.', '/settings'],
  ['outlets', 'Selling outlet', 'Confirm the outlet where this till sells and holds stock.', '/settings'],
  ['staff_accounts', 'Staff accounts', 'Add each bartender, cashier and manager who needs to use this till.', '/staff'],
  ['staff_roles', 'Least-privilege roles', 'Assign each active team member the least access needed for their bar duty.', '/staff'],
  ['staff_pins', 'Private staff PINs', 'Set a private attendance/POS PIN for each team member who will use the shared till.', '/staff'],
  ['modifiers_combos', 'Stock catalogue', 'Add the bottles, kegs, mixers, packaged snacks and prepared portions you count.', '/hpos/stock'],
  ['menu_categories', 'Product sections', 'Create clear sections such as Beer, Spirits, Softs, Wine, Snacks and Simple Food.', '/hpos/menu'],
  ['menu_pricing', 'Products & prices', 'Add every sellable product with a positive price and availability.', '/hpos/menu'],
  ['inventory', 'Product-to-stock links', 'Link each product to the exact counted stock item it consumes.', '/hpos/menu'],
  ['payments_tips', 'Supervised test sale', 'Run a paid test sale and verify its tender and receipt in Sales.', '/hpos/pos'],
  ['receipt_hardware', 'Till devices', 'Open System Health → Devices and complete a successful real receipt, drawer or terminal test on this POS computer.', '/hpos/system-health?tab=devices'],
  ['daily_checklists', 'Cash-up proof', 'Submit and approve a test cash-up so the opening float and handover are proven.', '/hpos/cash'],
  ['first_completed_shift', 'First completed shift', 'Clock a team member in with their private PIN, then complete and clock out the first supervised bar shift.', '/hpos/team'],
];

export default function HposSetupReadiness() {
  const navigate = useNavigate();
  const { settings } = useSettings();
  const barOnly = isBarOnlyMode(settings);
  const stages = barOnly ? BAR_STAGES : STAGES;
  const [rows, setRows] = useState([]);
  const [readStatus, setReadStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    setLoading(true); setError(''); setReadStatus(null);
    try {
      const [status, hardware] = await Promise.all([
        (async () => {
          const readWithStatus = window.api?.pos?.getSetupProgressWithReadStatus;
          if (typeof readWithStatus === 'function') return readWithStatus();
          const legacyRows = await window.api?.pos?.getSetupProgress?.();
          return {
            source: 'legacy',
            complete: false,
            online: null,
            rows: Array.isArray(legacyRows) ? legacyRows : [],
            error: 'This desktop build cannot verify setup evidence freshness. Update the POS and reconnect before relying on readiness.'
          };
        })(),
        Promise.resolve(window.api?.pos?.getHardwareSettings?.()).catch(() => ({})),
      ]);
      const safeStatus = status && typeof status === 'object'
        ? { source: 'unavailable', complete: false, online: null, rows: [], error: 'Setup evidence could not be verified.', ...status }
        : { source: 'unavailable', complete: false, online: null, rows: [], error: 'Setup evidence could not be verified.' };
      const detectedRows = Array.isArray(safeStatus.rows) ? safeStatus.rows : [];
      setReadStatus(safeStatus);
      const hardwareVerified = hardware?.hardware_last_test_success === true && Boolean(hardware?.hardware_last_test_at);
      const hardwareEvidence = hardwareVerified
        ? `A successful ${String(hardware.hardware_last_test_kind || 'device')} test was recorded on this POS computer at ${new Date(hardware.hardware_last_test_at).toLocaleString('en-GB')}.`
        : 'No successful real device test has been recorded on this POS computer. Open System Health → Devices and run a test.';
      setRows(detectedRows.map((row) => barOnly && row.stage_key === 'receipt_hardware'
        ? { ...row, detected: hardwareVerified, completed_at: hardwareVerified ? hardware.hardware_last_test_at : null, evidence: hardwareEvidence }
        : row));
    } catch (loadError) {
      setReadStatus({ source: 'unavailable', complete: false, online: null, rows: [], error: loadError?.message || 'Setup evidence could not be verified.' });
      setError(loadError?.message || 'Setup progress could not be loaded.');
    } finally { setLoading(false); }
  }, [barOnly]);

  useEffect(() => { load(); }, [load]);
  const latest = useMemo(() => new Map(rows.map((row) => [row.stage_key, row])), [rows]);
  const readComplete = readStatus?.complete === true;
  const completed = readComplete ? stages.filter(([key]) => latest.get(key)?.detected === true).length : 0;

  useEffect(() => {
    if (loading || !readComplete || completed !== stages.length) return undefined;
    const timer = setTimeout(() => navigate('/hpos/manage', { replace: true }), 3500);
    return () => clearTimeout(timer);
  }, [completed, loading, navigate, readComplete, stages.length]);

  return <div className="hpos-page-frame hpos-setup-readiness-page">
    <HposPageHero eyebrow="New venue setup" title={barOnly ? 'Bar setup readiness' : 'Restaurant setup readiness'} description={barOnly ? 'A focused path from empty till to safe first sale. Each stage advances only when the underlying setup evidence exists.' : 'An evidence-based 20-stage path from first configuration to a safe go-live. A stage only advances when the system detects its underlying setup data.'} actions={<HposButton icon={RefreshCw} onClick={load} disabled={loading}>{loading ? 'Refreshing…' : 'Refresh'}</HposButton>} />
    {error && <HposNotice tone="error">{error}</HposNotice>}
    {!loading && readStatus && readStatus.complete !== true && <HposNotice tone="warning">Setup evidence is not verified{readStatus.online === false ? ' because this POS is offline' : ''}. {readStatus.error || 'Reconnect and refresh before treating any stage as complete.'}</HposNotice>}
    {notice && <HposNotice>{notice}</HposNotice>}
    {!loading && readComplete && completed === stages.length && <HposNotice>All setup evidence is present. This readiness board will now retire from Manage.</HposNotice>}
    <section className="hpos-setup-summary"><div><ClipboardCheck size={24} /><span><small>{loading ? 'Checking setup evidence' : readComplete ? 'Setup complete' : 'Setup evidence not verified'}</small><strong>{loading ? '—' : readComplete ? `${completed} / ${stages.length}` : '—'}</strong></span></div><div><span className="hpos-setup-progress"><i style={{ width: `${readComplete ? (completed / stages.length) * 100 : 0}%` }} /></span><p>{loading ? 'Checking authoritative server evidence…' : !readComplete ? 'Completion is blocked until authoritative server evidence is available.' : completed === stages.length ? 'All setup stages are confirmed.' : `${stages.length - completed} stage${stages.length - completed === 1 ? '' : 's'} still need manager confirmation.`}</p></div></section>
    <section className="hpos-setup-stage-list" aria-busy={loading}>
      {stages.map(([key, title, description, route], index) => {
        const row = latest.get(key); const done = readComplete && row?.detected === true;
        const completedAt = row?.completed_at ? new Date(row.completed_at) : null;
        const completedLabel = readComplete && completedAt && !Number.isNaN(completedAt.getTime())
          ? `Authoritative evidence completed ${completedAt.toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}.`
          : (done ? 'Evidence is present; completion time is not available from the source record.' : '');
        const evidenceLabel = readComplete
          ? (row?.evidence || 'Checking configuration evidence…')
          : (row?.evidence ? `Last known evidence (not verified): ${row.evidence}` : 'Evidence unavailable until an online server read succeeds.');
        return <article key={key} className={done ? 'is-done' : ''}>
          <span className="hpos-setup-stage-number">{done ? <CheckCircle2 size={18} /> : String(index + 1).padStart(2, '0')}</span>
          <div><h2>{title}</h2><p><strong>How:</strong> {description}</p><small>{evidenceLabel}</small>{completedLabel && <small>{completedLabel}</small>}</div>
          <HposStatusBadge tone={done ? 'success' : 'warning'}>{done ? 'Detected' : readComplete ? 'Not detected' : 'Not verified'}</HposStatusBadge>
          <div className="hpos-setup-stage-actions"><HposButton icon={ExternalLink} onClick={() => navigate(route)}>{done ? 'Review' : 'Set up'}</HposButton></div>
        </article>;
      })}
    </section>
  </div>;
}
