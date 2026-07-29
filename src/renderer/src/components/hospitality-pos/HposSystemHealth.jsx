import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  AlertTriangle,
  CheckCircle2,
  CloudOff,
  CreditCard,
  Database,
  ListChecks,
  Monitor,
  Printer,
  RefreshCw,
  ScanLine,
  Server,
  Settings2,
  Wifi,
} from 'lucide-react';
import { useAccess, useSettings } from '../../app-context';
import { canAccessCapability } from '../../../../shared/accessControl';
import { isBarOnlyMode } from '../../../../shared/propertyTypes';
import { createBarcodeScannerDecoder } from '../../../../shared/barcodeScanner';
import {
  HposButton,
  HposEmptyState,
  HposNotice,
  HposPageHero,
  HposStatusBadge,
} from './HposUi';

const queueId = (row) => row?._queue_id || row?.id || null;
const eventName = (row) => String(row?.action || row?.event_type || row?.type || 'POS event').replaceAll('_', ' ');

export default function HposSystemHealth() {
  const [searchParams] = useSearchParams();
  const access = useAccess();
  const { settings } = useSettings();
  const barOnly = isBarOnlyMode(settings);
  const canSync = canAccessCapability(access, 'sync.manage');
  const canManagePos = canAccessCapability(access, 'pos.manage');
  const canAudit = canAccessCapability(access, 'audit.view');
  const [activeTab, setActiveTab] = useState(() => searchParams.get('tab') === 'audit' ? 'audit' : 'sync');
  const [status, setStatus] = useState(null);
  const [details, setDetails] = useState(null);
  const [hardware, setHardware] = useState({});
  const [displays, setDisplays] = useState([]);
  const [audit, setAudit] = useState([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [scannerVerifying, setScannerVerifying] = useState(false);
  const [scannerCaptureCount, setScannerCaptureCount] = useState(0);
  const [pendingScannerVerification, setPendingScannerVerification] = useState(null);

  const scannerVerification = useCallback(async (result) => {
    setScannerVerifying(false);
    setScannerCaptureCount(0);
    if (!result?.success) {
      setPendingScannerVerification(null);
      setError(result?.error || `Barcode scan failed: ${result?.code || 'invalid_scan'}.`);
      return;
    }
    setPendingScannerVerification(result);
    setNotice(`Barcode captured: ${result.barcode}. Confirm that it matches the product label.`);
  }, []);

  const confirmScannerVerification = useCallback(async () => {
    const result = pendingScannerVerification;
    if (!result?.success) return;
    try {
      const saved = await window.api?.pos?.verifyBarcodeScanner?.({
        barcode: result.barcode,
        terminator: result.terminator,
        characterCount: result.characterCount,
        averageInterKeyMs: result.averageInterKeyMs,
      });
      if (saved?.success === false) throw new Error(saved.error || 'Scanner verification failed.');
      if (saved?.settings) setHardware(saved.settings);
      setNotice(`Scanner input verified (${result.characterCount} characters, ${result.terminator || 'idle'} terminator).`);
      setPendingScannerVerification(null);
    } catch (verificationError) {
      setError(verificationError?.message || 'Scanner verification failed.');
    }
  }, [pendingScannerVerification]);

  useEffect(() => {
    if (!scannerVerifying) return undefined;
    let idleTimer = null;
    const decoder = createBarcodeScannerDecoder({
      minLength: Number(hardware.barcode_scanner_min_length) || 4,
      maxLength: Number(hardware.barcode_scanner_max_length) || 128,
      interKeyMs: Number(hardware.barcode_scanner_inter_key_ms) || 120,
      idleCompleteMs: Number(hardware.barcode_scanner_idle_complete_ms) || 180,
      prefix: hardware.barcode_scanner_prefix || '',
      suffix: hardware.barcode_scanner_suffix || '',
      acceptEnter: hardware.barcode_scanner_accept_enter !== false,
      acceptTab: hardware.barcode_scanner_accept_tab !== false,
    });
    const finishIdle = () => {
      const outcome = decoder.flush('idle');
      if (outcome.type === 'completed') scannerVerification(outcome.result);
    };
    const onKeyDown = (event) => {
      const key = String(event.key || '');
      if (!(key.length === 1 || key === 'Enter' || key === 'NumpadEnter' || key === 'Tab')) return;
      const outcome = decoder.consumeKey(event);
      if (outcome.type === 'buffered' || outcome.type === 'completed') event.preventDefault();
      if (idleTimer) window.clearTimeout(idleTimer);
      if (outcome.type === 'buffered') {
        setScannerCaptureCount(outcome.length || 0);
        idleTimer = window.setTimeout(finishIdle, Number(hardware.barcode_scanner_idle_complete_ms) || 180);
      } else if (outcome.type === 'completed') {
        scannerVerification(outcome.result);
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      if (idleTimer) window.clearTimeout(idleTimer);
      decoder.reset();
    };
  }, [hardware, scannerVerification, scannerVerifying]);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const results = await Promise.allSettled([
        window.api?.sync?.getStatus?.(),
        window.api?.sync?.getDetails?.(),
        window.api?.pos?.getHardwareSettings?.(),
        window.api?.pos?.listDisplays?.(),
        canAudit ? window.api?.pos?.getAuditLog?.(100) : Promise.resolve([]),
        canAudit ? window.api?.users?.getAccessAudit?.() : Promise.resolve({ success: true, entries: [] }),
      ]);
      setStatus(results[0].status === 'fulfilled' ? results[0].value || {} : {});
      setDetails(results[1].status === 'fulfilled' ? results[1].value || {} : {});
      setHardware(results[2].status === 'fulfilled' ? results[2].value || {} : {});
      setDisplays(results[3].status === 'fulfilled' && Array.isArray(results[3].value) ? results[3].value : []);
      const posAudit = results[4].status === 'fulfilled' && Array.isArray(results[4].value) ? results[4].value : [];
      const accessAudit = results[5].status === 'fulfilled' && results[5].value?.success !== false && Array.isArray(results[5].value?.entries)
        ? results[5].value.entries.map((entry) => ({ ...entry, _audit_source: 'staff access' }))
        : [];
      setAudit([...posAudit, ...accessAudit]
        .sort((a, b) => new Date(b.created_at || b.timestamp || 0) - new Date(a.created_at || a.timestamp || 0))
        .slice(0, 150));
      if (results[0].status === 'rejected' && results[1].status === 'rejected') {
        throw new Error('System status could not be loaded.');
      }
    } catch (loadError) {
      setError(loadError?.message || 'System status could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, [canAudit]);

  useEffect(() => {
    load();
    const off = window.api?.sync?.onStatusChanged?.((next) =>
      setStatus((previous) => ({ ...previous, ...next })),
    );
    return () => off?.();
  }, [load]);

  const runNow = async () => {
    setRunning(true);
    setNotice('');
    setError('');
    try {
      const result = await window.api?.sync?.runNow?.();
      if (result?.success === false) throw new Error(result.error || 'Sync could not run.');
      setNotice('Sync check completed.');
      await load();
    } catch (runError) {
      setError(runError?.message || 'Sync could not run.');
    } finally {
      setRunning(false);
    }
  };

  const retryFailed = async (row = null) => {
    setRunning(true);
    setNotice('');
    setError('');
    try {
      const ids = row ? [queueId(row)].filter(Boolean) : (details?.failed || []).map(queueId).filter(Boolean);
      const result = await window.api?.sync?.retryFailed?.(ids);
      if (result?.success === false) throw new Error(result.error || 'Retry could not be queued.');
      setNotice(`${Number(result?.retried ?? ids.length)} failed operation${Number(result?.retried ?? ids.length) === 1 ? '' : 's'} returned to the existing sync queue.`);
      await load();
    } catch (retryError) {
      setError(retryError?.message || 'Failed operations could not be retried.');
    } finally {
      setRunning(false);
    }
  };

  const saveHardware = async () => {
    setRunning(true);
    setNotice('');
    setError('');
    try {
      const result = await window.api?.pos?.saveHardwareSettings?.(hardware);
      if (result?.success === false) throw new Error(result.error || 'Device settings could not be saved.');
      if (result?.settings) setHardware(result.settings);
      setNotice('POS device settings saved on this computer.');
    } catch (saveError) {
      setError(saveError?.message || 'Device settings could not be saved.');
    } finally {
      setRunning(false);
    }
  };

  const testHardware = async (kind) => {
    setRunning(true);
    setNotice('');
    setError('');
    try {
      const result = await window.api?.pos?.testHardware?.(kind);
      if (result?.success === false) throw new Error(result.error || result.message || 'Device test failed.');
      setNotice(result?.message || `${kind.replaceAll('-', ' ')} test completed.`);
    } catch (testError) {
      setError(testError?.message || 'Device test failed.');
    } finally {
      setRunning(false);
    }
  };

  const openDisplay = async (kind, displayId, fullScreen = true) => {
    setNotice('');
    setError('');
    try {
      const result = await window.api?.pos?.openDisplay?.(kind, { displayId, fullScreen });
      if (result?.success === false) throw new Error(result.error || 'Display could not be opened.');
      setNotice(`${kind === 'customer' ? 'Customer' : kind === 'bar' ? 'Bar' : 'Kitchen'} display opened${fullScreen ? ' full screen' : ''}.`);
    } catch (displayError) {
      setError(displayError?.message || 'Display could not be opened.');
    }
  };

  const pending = Number(status?.pending ?? details?.pendingCount ?? 0);
  const failed = Number(status?.failed ?? details?.failedCount ?? 0);
  const online = status?.isOnline !== false;
  const cards = useMemo(
    () => [
      { label: 'Connection', value: online ? 'Online' : 'Offline', icon: online ? Wifi : CloudOff, tone: online ? 'success' : 'danger', detail: online ? 'Server-backed work is available.' : 'Approved offline contracts remain available.' },
      { label: 'Waiting to sync', value: pending, icon: Database, tone: pending ? 'warning' : 'success', detail: pending ? 'Saved operations are awaiting confirmation.' : 'No queued work is waiting.' },
      { label: 'Needs attention', value: failed, icon: AlertTriangle, tone: failed ? 'danger' : 'success', detail: failed ? 'Failed operations require manager review.' : 'No failed operations detected.' },
      { label: 'Last confirmed sync', value: status?.lastSuccessfulSyncAt ? new Date(status.lastSuccessfulSyncAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : 'Not yet', icon: Server, tone: 'neutral', detail: 'Most recent server-confirmed sync on this computer.' },
    ],
    [failed, online, pending, status],
  );

  const tabs = [
    ['sync', 'Sync & queue', Database, failed + pending],
    ['devices', 'Devices & displays', Settings2, displays.length],
    ...(canAudit ? [['audit', 'POS audit trail', ListChecks, audit.length]] : []),
  ];

  return (
    <div className="hpos-page-frame hpos-health-page">
      <HposPageHero
        eyebrow="Reliability & devices"
        title="System health"
        description={barOnly ? 'Keep bar sales sync, receipt hardware, displays and the operational audit trail visible from one control desk.' : 'Keep server sync, receipt hardware, customer-facing screens, and the local POS audit trail visible from one restaurant control desk.'}
        actions={<HposButton icon={RefreshCw} className={loading ? 'is-loading' : ''} onClick={load} disabled={loading}>Refresh</HposButton>}
      />
      {error && <HposNotice tone="error">{error}</HposNotice>}
      {notice && <HposNotice>{notice}</HposNotice>}

      <div className="hpos-control-tabs" role="tablist" aria-label="System health sections">
        {tabs.map(([id, label, Icon, count]) => (
          <button key={id} type="button" role="tab" aria-selected={activeTab === id} className={activeTab === id ? 'is-active' : ''} onClick={() => setActiveTab(id)}>
            <Icon size={15} /> {label} <span>{count}</span>
          </button>
        ))}
      </div>

      {activeTab === 'sync' && (
        <>
          <section className="hpos-health-grid" aria-busy={loading}>
            {cards.map((card) => (
              <article key={card.label}>
                <div><span className={`hpos-health-icon is-${card.tone}`}><card.icon size={19} /></span><HposStatusBadge tone={card.tone}>{card.tone}</HposStatusBadge></div>
                <small>{card.label}</small><strong>{loading ? '—' : card.value}</strong><p>{card.detail}</p>
              </article>
            ))}
          </section>
          <section className="hpos-sync-desk">
            <div className="hpos-section-heading">
              <span><Database size={18} /></span>
              <div><h2>Operation queue</h2><p>Retries keep the original operation identifiers and payloads.</p></div>
              {canSync && <HposButton tone="primary" icon={RefreshCw} onClick={runNow} disabled={running}>{running ? 'Working…' : 'Sync now'}</HposButton>}
            </div>
            {(details?.failed || []).length > 0 && (
              <div className="hpos-sync-list">
                <header><strong>Failed operations</strong>{canSync && <HposButton onClick={() => retryFailed()} disabled={running}>Retry all failed</HposButton>}</header>
                {(details.failed || []).map((row) => (
                  <article key={queueId(row) || JSON.stringify(row)}>
                    <span className="hpos-health-icon is-danger"><AlertTriangle size={17} /></span>
                    <div><strong>{String(row.table || row.type || 'Operation').replaceAll('_', ' ')}</strong><p>{row.displayError || row.lastError || 'This operation did not sync.'}</p><small>{row.isFinancial ? 'Financial operation · preserve for review' : row.dependencyLabel || 'Operational item'}</small></div>
                    {row.isFinancial && <HposStatusBadge tone="danger">Financial</HposStatusBadge>}
                    {canSync && <HposButton onClick={() => retryFailed(row)} disabled={running}>Retry</HposButton>}
                  </article>
                ))}
              </div>
            )}
            {(details?.pending || []).length > 0 && (
              <div className="hpos-sync-list is-pending">
                <header><strong>Waiting for confirmation</strong><HposStatusBadge tone="warning">{details.pending.length} pending</HposStatusBadge></header>
                {(details.pending || []).slice(0, 20).map((row) => (
                  <article key={queueId(row) || JSON.stringify(row)}>
                    <span className="hpos-health-icon is-warning"><RefreshCw size={17} /></span>
                    <div><strong>{String(row.table || row.type || 'Operation').replaceAll('_', ' ')}</strong><p>{row.dependencyLabel || 'Waiting for the next successful sync.'}</p></div>
                    {row.isFinancial && <HposStatusBadge tone="warning">Financial</HposStatusBadge>}
                  </article>
                ))}
              </div>
            )}
            {!loading && !(details?.failed || []).length && !(details?.pending || []).length && (
              <HposEmptyState icon={CheckCircle2} title="Operation queue is clear" description="No pending or failed operations are waiting on this computer." />
            )}
          </section>
          <section className="hpos-health-guidance"><CheckCircle2 size={20} /><div><h2>Financial truth stays server-authoritative</h2><p>Pending work remains visibly queued. A retry reuses the existing operation identifier; this screen never invents a replacement payment, order, or stock movement.</p></div></section>
        </>
      )}

      {activeTab === 'devices' && (
        <div className="hpos-device-layout">
          <section className="hpos-device-panel" aria-live="polite">
            <div className="hpos-section-heading"><span><ScanLine size={18} /></span><div><h2>Barcode scanner</h2><p>Keyboard-wedge scanners are verified by a real scan on this POS computer.</p></div></div>
            <div className="hpos-form-grid">
              <label><span>Scanner status</span><strong>{scannerVerifying ? `Waiting for scan${scannerCaptureCount ? ` · ${scannerCaptureCount} characters` : '…'}` : pendingScannerVerification ? 'Captured · confirmation required' : hardware.scanner_last_verified_at ? `Verified ${new Date(hardware.scanner_last_verified_at).toLocaleString('en-GB')}` : 'Not tested on this computer'}</strong></label>
              <label><span>Input framing</span><small>{hardware.barcode_scanner_accept_enter !== false ? 'Enter' : ''}{hardware.barcode_scanner_accept_enter !== false && hardware.barcode_scanner_accept_tab !== false ? ' or ' : ''}{hardware.barcode_scanner_accept_tab !== false ? 'Tab' : ''} terminator · idle completion supported</small></label>
            </div>
            <p className="hpos-help-text">Configure the scanner as USB/Bluetooth keyboard mode. Click Verify, scan one real product label, and confirm the captured length and terminator. The audit stores only a one-way hash of the test barcode.</p>
            {canManagePos && <div className="hpos-form-grid" aria-label="Barcode scanner configuration">
              <label><span>Scanner enabled</span><input type="checkbox" checked={hardware.barcode_scanner_enabled !== false} onChange={(event) => setHardware({ ...hardware, barcode_scanner_enabled: event.target.checked })} /></label>
              <label><span>Minimum characters</span><input type="number" min="1" max="128" value={hardware.barcode_scanner_min_length ?? 4} onChange={(event) => setHardware({ ...hardware, barcode_scanner_min_length: Number(event.target.value) })} /></label>
              <label><span>Maximum characters</span><input type="number" min="1" max="128" value={hardware.barcode_scanner_max_length ?? 128} onChange={(event) => setHardware({ ...hardware, barcode_scanner_max_length: Number(event.target.value) })} /></label>
              <label><span>Inter-key limit (ms)</span><input type="number" min="10" max="1000" value={hardware.barcode_scanner_inter_key_ms ?? 120} onChange={(event) => setHardware({ ...hardware, barcode_scanner_inter_key_ms: Number(event.target.value) })} /></label>
              <label><span>Idle completion (ms)</span><input type="number" min="50" max="2000" value={hardware.barcode_scanner_idle_complete_ms ?? 180} onChange={(event) => setHardware({ ...hardware, barcode_scanner_idle_complete_ms: Number(event.target.value) })} /></label>
              <label><span>Terminator keys</span><select value={hardware.barcode_scanner_accept_enter !== false ? hardware.barcode_scanner_accept_tab !== false ? 'enter+tab' : 'enter' : 'tab'} onChange={(event) => { const value = event.target.value; setHardware({ ...hardware, barcode_scanner_accept_enter: value.includes('enter'), barcode_scanner_accept_tab: value.includes('tab') }); }}><option value="enter+tab">Enter or Tab</option><option value="enter">Enter only</option><option value="tab">Tab only</option></select></label>
              <label><span>Prefix (optional)</span><input maxLength="16" value={hardware.barcode_scanner_prefix || ''} onChange={(event) => setHardware({ ...hardware, barcode_scanner_prefix: event.target.value })} placeholder="e.g. ]C1" /></label>
              <label><span>Suffix (optional)</span><input maxLength="16" value={hardware.barcode_scanner_suffix || ''} onChange={(event) => setHardware({ ...hardware, barcode_scanner_suffix: event.target.value })} placeholder="Optional framing" /></label>
            </div>}
            {pendingScannerVerification && <div className="hpos-health-guidance"><ScanLine size={18} /><div><strong>Captured barcode: <code>{pendingScannerVerification.barcode}</code></strong><p>{pendingScannerVerification.characterCount} characters · {pendingScannerVerification.terminator || 'idle'} terminator</p></div></div>}
            <div className="hpos-device-actions">
              <HposButton tone="primary" icon={ScanLine} onClick={() => { setError(''); setNotice('Scanner verification is listening. Scan one barcode now.'); setPendingScannerVerification(null); setScannerCaptureCount(0); setScannerVerifying(true); }} disabled={!canManagePos || scannerVerifying || hardware.barcode_scanner_enabled === false}>{scannerVerifying ? 'Waiting for scan…' : 'Verify scanner input'}</HposButton>
              {pendingScannerVerification && <HposButton tone="primary" onClick={confirmScannerVerification}>Confirm captured barcode</HposButton>}
              {pendingScannerVerification && <HposButton onClick={() => { setPendingScannerVerification(null); setNotice('Captured barcode discarded.'); }}>Discard</HposButton>}
              {scannerVerifying && <HposButton onClick={() => { setScannerVerifying(false); setScannerCaptureCount(0); setNotice('Scanner verification cancelled.'); }}>Cancel</HposButton>}
            </div>
          </section>
          <section className="hpos-device-panel">
            <div className="hpos-section-heading"><span><Printer size={18} /></span><div><h2>Receipt & cash hardware</h2><p>Settings apply to this POS computer.</p></div></div>
            <div className="hpos-form-grid">
              <label className="is-wide">Windows printer name<input disabled={!canManagePos} value={hardware.receipt_printer_name || ''} onChange={(event) => setHardware({ ...hardware, receipt_printer_name: event.target.value })} placeholder="Leave blank to use the system default" /></label>
              <label>Print method<select disabled={!canManagePos} value={hardware.receipt_print_mode || 'windows'} onChange={(event) => setHardware({ ...hardware, receipt_print_mode: event.target.value })}><option value="windows">Windows printer</option><option value="escpos">ESC/POS</option></select></label>
              <label>Paper width<select disabled={!canManagePos} value={hardware.receipt_paper_width || '80mm'} onChange={(event) => setHardware({ ...hardware, receipt_paper_width: event.target.value })}><option value="80mm">80 mm</option><option value="58mm">58 mm</option></select></label>
            </div>
            <div className="hpos-device-toggles">
              <label><input type="checkbox" disabled={!canManagePos} checked={hardware.auto_print_receipts === true} onChange={(event) => setHardware({ ...hardware, auto_print_receipts: event.target.checked })} /><span><strong>Auto-print receipts</strong><small>Print after successful payment.</small></span></label>
              <label><input type="checkbox" disabled={!canManagePos} checked={hardware.cash_drawer_enabled === true} onChange={(event) => setHardware({ ...hardware, cash_drawer_enabled: event.target.checked })} /><span><strong>Cash drawer enabled</strong><small>Use configured receipt hardware to open the drawer.</small></span></label>
              <label><input type="checkbox" disabled={!canManagePos} checked={hardware.cash_drawer_open_on_cash === true} onChange={(event) => setHardware({ ...hardware, cash_drawer_open_on_cash: event.target.checked })} /><span><strong>Open on cash payment</strong><small>Trigger only after cash is recorded.</small></span></label>
            </div>
            {canManagePos && <div className="hpos-device-actions"><HposButton tone="primary" onClick={saveHardware} disabled={running}>Save device settings</HposButton><HposButton icon={Printer} onClick={() => testHardware('receipt')} disabled={running}>Test receipt</HposButton><HposButton icon={CreditCard} onClick={() => testHardware('payment-terminal')} disabled={running}>Test card terminal</HposButton></div>}
          </section>
          <section className="hpos-device-panel">
            <div className="hpos-section-heading"><span><Monitor size={18} /></span><div><h2>Customer & preparation displays</h2><p>Open on a selected monitor; the position is remembered.</p></div></div>
            {displays.length === 0 ? <HposEmptyState icon={Monitor} title="No displays detected" description="Connect a monitor, then refresh System Health." /> : (
              <div className="hpos-display-list">
                {displays.map((display) => (
                  <article key={display.id}>
                    <div><strong>{display.label || `Display ${display.id}`}</strong><span>{display.isPrimary ? 'Primary · ' : ''}{display.bounds?.width || '—'} × {display.bounds?.height || '—'}</span></div>
                    <div><HposButton onClick={() => openDisplay('customer', display.id)}>Customer</HposButton>{!barOnly && <HposButton onClick={() => openDisplay('kitchen', display.id)}>Kitchen</HposButton>}<HposButton onClick={() => openDisplay('bar', display.id)}>Bar</HposButton></div>
                  </article>
                ))}
              </div>
            )}
          </section>
        </div>
      )}

      {activeTab === 'audit' && canAudit && (
        <section className="hpos-audit-panel">
          <div className="hpos-section-heading"><span><ListChecks size={18} /></span><div><h2>{barOnly ? 'Bar audit trail' : 'POS audit trail'}</h2><p>Recent sales, cash, stock and operator events recorded on this device and queued for authoritative sync where required.</p></div></div>
          {audit.length === 0 ? <HposEmptyState icon={ListChecks} title="No audit events found" description="POS actions will appear here as they are recorded." /> : (
            <div className="hpos-audit-list">
              {audit.map((row, index) => (
                <article key={row.id || `${row.created_at}-${index}`}>
                  <div><strong>{eventName(row)}</strong><span>{row.entity_type ? String(row.entity_type).replaceAll('_', ' ') : 'POS'}</span></div>
                  <p>{row.details?.reason || row.details?.message || row.description || row.entity_id || 'Recorded operational event'}</p>
                  <time>{row.created_at ? new Date(row.created_at).toLocaleString('en-GB') : 'Time unavailable'}</time>
                </article>
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
