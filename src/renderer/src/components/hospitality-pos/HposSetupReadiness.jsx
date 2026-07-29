import { useCallback, useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Circle, ClipboardCheck, ExternalLink, RefreshCw } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
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
  ['modifiers_combos', 'Stock catalogue', 'Add the bottles, kegs, mixers, packaged snacks and prepared portions you count.', '/hpos/stock'],
  ['menu_categories', 'Product sections', 'Create clear sections such as Beer, Spirits, Softs, Wine, Snacks and Simple Food.', '/hpos/menu'],
  ['menu_pricing', 'Products & prices', 'Add every sellable product with a positive price and availability.', '/hpos/menu'],
  ['inventory', 'Product-to-stock links', 'Link each product to the exact counted stock item it consumes.', '/hpos/menu'],
  ['payments_tips', 'Supervised test sale', 'Run a paid test sale and verify its tender and receipt in Sales.', '/hpos/pos'],
  ['receipt_hardware', 'Till devices', 'Confirm the receipt printer, cash drawer or payment-terminal settings used here.', '/settings'],
  ['daily_checklists', 'Cash-up proof', 'Submit and approve a test cash-up so the opening float and handover are proven.', '/hpos/cash'],
];

export default function HposSetupReadiness() {
  const navigate = useNavigate();
  const { settings } = useSettings();
  const barOnly = isBarOnlyMode(settings);
  const stages = barOnly ? BAR_STAGES : STAGES;
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const [result, hardware] = await Promise.all([
        window.api?.pos?.getSetupProgress?.(),
        window.api?.pos?.getHardwareSettings?.().catch(() => ({})),
      ]);
      const detectedRows = Array.isArray(result) ? result : [];
      const hasHardware = Boolean(hardware?.receipt_printer_name || hardware?.cash_drawer_enabled || hardware?.payment_terminal_bridge_url);
      setRows(detectedRows.map((row) => row.stage_key === 'receipt_hardware' ? { ...row, detected: hasHardware, evidence: hasHardware ? 'Device settings are saved on this POS computer.' : row.evidence } : row));
    } catch (loadError) {
      setError(loadError?.message || 'Setup progress could not be loaded.');
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);
  const latest = useMemo(() => new Map(rows.map((row) => [row.stage_key, row])), [rows]);
  const completed = stages.filter(([key]) => latest.get(key)?.detected === true).length;

  useEffect(() => {
    if (loading || completed !== stages.length) return undefined;
    const timer = setTimeout(() => navigate('/hpos/manage', { replace: true }), 3500);
    return () => clearTimeout(timer);
  }, [completed, loading, navigate, stages.length]);

  return <div className="hpos-page-frame hpos-setup-readiness-page">
    <HposPageHero eyebrow="New venue setup" title={barOnly ? 'Bar setup readiness' : 'Restaurant setup readiness'} description={barOnly ? 'A focused path from empty till to safe first sale. Each stage advances only when the underlying setup evidence exists.' : 'An evidence-based 20-stage path from first configuration to a safe go-live. A stage only advances when the system detects its underlying setup data.'} actions={<HposButton icon={RefreshCw} onClick={load} disabled={loading}>{loading ? 'Refreshing…' : 'Refresh'}</HposButton>} />
    {error && <HposNotice tone="error">{error}</HposNotice>}
    {notice && <HposNotice>{notice}</HposNotice>}
    {!loading && completed === stages.length && <HposNotice>All setup evidence is present. This readiness board will now retire from Manage.</HposNotice>}
    <section className="hpos-setup-summary"><div><ClipboardCheck size={24} /><span><small>Setup complete</small><strong>{loading ? '—' : `${completed} / ${stages.length}`}</strong></span></div><div><span className="hpos-setup-progress"><i style={{ width: `${(completed / stages.length) * 100}%` }} /></span><p>{completed === stages.length ? 'All setup stages are confirmed.' : `${stages.length - completed} stage${stages.length - completed === 1 ? '' : 's'} still need manager confirmation.`}</p></div></section>
    <section className="hpos-setup-stage-list" aria-busy={loading}>
      {stages.map(([key, title, description, route], index) => {
        const row = latest.get(key); const done = row?.detected === true;
        return <article key={key} className={done ? 'is-done' : ''}>
          <span className="hpos-setup-stage-number">{done ? <CheckCircle2 size={18} /> : String(index + 1).padStart(2, '0')}</span>
          <div><h2>{title}</h2><p><strong>How:</strong> {description}</p><small>{row?.evidence || 'Checking configuration evidence…'}</small></div>
          <HposStatusBadge tone={done ? 'success' : 'warning'}>{done ? 'Detected' : 'Not detected'}</HposStatusBadge>
          <div className="hpos-setup-stage-actions"><HposButton icon={ExternalLink} onClick={() => navigate(route)}>{done ? 'Review' : 'Set up'}</HposButton></div>
        </article>;
      })}
    </section>
  </div>;
}
