import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardCheck,
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
import { playScanBeep } from '../../../../shared/tillSound';
import {
  HposButton,
  HposEmptyState,
  HposNotice,
  HposPageHero,
  HposStatusBadge,
} from './HposUi';

const queueId = (row) => row?._queue_id || row?.id || null;
const eventName = (row) => String(row?.action || row?.event_type || row?.type || 'POS event').replaceAll('_', ' ');
const issueLabel = (entry) => String(entry?.scope || entry?.operation || 'system')
  .replaceAll('_', ' ')
  .replace(/\bpos\b/gi, 'sale')
  .replace(/\brpc\b/gi, '')
  .replace(/\s+/g, ' ')
  .trim()
  .replace(/\b\w/g, (ch) => ch.toUpperCase()) || 'System';
const issueTone = (entry) => {
  const scope = String(entry?.scope || entry?.operation || '').toLowerCase();
  const level = String(entry?.severity || entry?.level || '').toLowerCase();
  return scope.includes('financial') || scope.includes('db_init') || level === 'error' ? 'danger' : 'warning';
};
const issueTime = (ts) => {
  if (!ts) return 'Time unknown';
  try { return new Date(ts).toLocaleString('en-GB'); } catch { return ts; }
};

export default function HposSystemHealth() {
  const [searchParams] = useSearchParams();
  const access = useAccess();
  const { settings } = useSettings();
  const barOnly = isBarOnlyMode(settings);
  const canSync = canAccessCapability(access, 'sync.manage');
  const canManagePos = canAccessCapability(access, 'settings.manage_general');
  const canAudit = canAccessCapability(access, 'audit.view');
  const canClearIssues = canAccessCapability(access, 'system.health');
  const requestedTab = searchParams.get('tab');
  const initialTab = ['sync', 'issues', 'devices', 'checks'].includes(requestedTab) || (requestedTab === 'audit' && canAudit)
    ? requestedTab
    : 'sync';
  const [activeTab, setActiveTab] = useState(initialTab);
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
  const [criticalErrors, setCriticalErrors] = useState([]);
  const [unsyncedVoids, setUnsyncedVoids] = useState([]);
  const [rendererErrors, setRendererErrors] = useState([]);
  const [printers, setPrinters] = useState([]);
  const [showAdvancedScanner, setShowAdvancedScanner] = useState(false);
  const [displayFullScreen, setDisplayFullScreen] = useState(true);
  const [testingAll, setTestingAll] = useState(false);
  const [scanResults, setScanResults] = useState(null);
  const [scanning, setScanning] = useState(false);
  const [drawerReason, setDrawerReason] = useState('');
  const [scanProductName, setScanProductName] = useState('');
  const [morningCheck, setMorningCheck] = useState(null);
  const [checkingMorning, setCheckingMorning] = useState(false);
  const [helpBusy, setHelpBusy] = useState(false);
  const [mesh, setMesh] = useState(null);
  const [meshBusy, setMeshBusy] = useState(false);
  const [peerAddress, setPeerAddress] = useState('');
  const [peerPort, setPeerPort] = useState('');
  const canCashup = canAccessCapability(access, 'pos.cashup');
  const dailyChecksKey = `hpos-daily-checks:${new Date().toLocaleDateString('en-CA')}`;
  const [dailyChecks, setDailyChecks] = useState(() => {
    try {
      const raw = window.localStorage?.getItem(`hpos-daily-checks:${new Date().toLocaleDateString('en-CA')}`);
      const parsed = raw ? JSON.parse(raw) : null;
      return parsed && typeof parsed === 'object' ? parsed : { open: {}, close: {}, cardMachineTotal: '', tillCardTotal: '' };
    } catch {
      return { open: {}, close: {}, cardMachineTotal: '', tillCardTotal: '' };
    }
  });

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
      playScanBeep(true);
      setNotice(`Scanner input verified (${result.characterCount} characters, ${result.terminator || 'idle'} terminator).${scanProductName ? ` This barcode belongs to: ${scanProductName}.` : ''}`);
      setPendingScannerVerification(null);
    } catch (verificationError) {
      playScanBeep(false);
      setError(verificationError?.message || 'Scanner verification failed.');
    }
  }, [pendingScannerVerification, scanProductName]);

  // When a barcode is captured, look it up in the menu so the operator sees
  // the product name, not just numbers. Best-effort: verification works
  // without it.
  useEffect(() => {
    const barcode = pendingScannerVerification?.barcode;
    if (!barcode) {
      setScanProductName('');
      return;
    }
    let active = true;
    Promise.resolve(window.api?.pos?.getMenuItems?.()).then((rows) => {
      if (!active) return;
      const list = Array.isArray(rows) ? rows : [];
      const match = list.find((item) => String(item?.barcode ?? '').trim() === String(barcode).trim());
      setScanProductName(match ? String(match.name || match.item_name || 'Unnamed product') : '');
    }).catch(() => {});
    return () => { active = false; };
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
        window.api?.reports?.criticalErrors?.(12).catch(() => []) || Promise.resolve([]),
        window.api?.app?.getRendererErrors?.(6).catch(() => []) || Promise.resolve([]),
        window.api?.pos?.getVoidHistory?.('', '').catch(() => []) || Promise.resolve([]),
        window.api?.receipts?.listPrinters?.().catch(() => []) || Promise.resolve([]),
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
      setCriticalErrors(results[6].status === 'fulfilled' && Array.isArray(results[6].value) ? results[6].value : []);
      setRendererErrors(results[7].status === 'fulfilled' && Array.isArray(results[7].value) ? results[7].value : []);
      const voidRows = results[8].status === 'fulfilled' && Array.isArray(results[8].value) ? results[8].value : [];
      setUnsyncedVoids(voidRows.filter((row) => row?._pending_sync === true
        || ['pending', 'failed', 'manual_review_required'].includes(String(row?._sync_state || ''))));
      setPrinters(results[9]?.status === 'fulfilled' && Array.isArray(results[9].value) ? results[9].value : []);
      if (results[0].status === 'rejected' && results[1].status === 'rejected') {
        throw new Error('System status could not be loaded.');
      }
    } catch (loadError) {
      setError(loadError?.message || 'System status could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, [canAudit]);

  const loadMesh = useCallback(async () => {
    try {
      const snapshot = await window.api?.mesh?.getDiagnostics?.();
      if (snapshot && typeof snapshot === 'object') setMesh(snapshot);
    } catch {
      /* mesh panel stays empty; sync status still shows connectivity */
    }
  }, []);

  const meshAction = async (action) => {
    setMeshBusy(true);
    setNotice('');
    setError('');
    try {
      let result = null;
      if (action === 'refresh') result = await window.api?.mesh?.refreshDiscovery?.();
      if (action === 'connect') {
        const address = String(peerAddress || '').trim();
        if (!address) throw new Error('Type the other till’s address first (for example 192.168.1.20).');
        const port = Number(peerPort) > 0 ? Number(peerPort) : null;
        result = await window.api?.mesh?.connectManualPeer?.(address, port);
        if (result?.success === false) throw new Error(result.error || 'The other till did not answer.');
      }
      if (result?.mesh) setMesh(result.mesh);
      else await loadMesh();
      setNotice(action === 'refresh' ? 'Looking for nearby tills…' : 'Connection attempt sent — the till appears below when it answers.');
    } catch (meshError) {
      setError(meshError?.message || 'The mesh action failed.');
    } finally {
      setMeshBusy(false);
    }
  };

  useEffect(() => {
    load();
    loadMesh();
    const off = window.api?.sync?.onStatusChanged?.((next) => {
      setStatus((previous) => ({ ...previous, ...next }));
      if (next?.mesh && typeof next.mesh === 'object') setMesh(next.mesh);
    });
    const offConflict = window.api?.mesh?.onConflictDetected?.((payload) => {
      setError(`The two tills disagree on ${payload?.subject || 'a record'} — a manager should review it in Open tabs or System Health before retrying.`);
    });
    return () => { off?.(); offConflict?.(); };
  }, [load, loadMesh]);

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

  const clearFailedItems = async (row = null) => {
    setRunning(true);
    setNotice('');
    setError('');
    try {
      const rows = row ? [row] : (details?.failed || []);
      if (rows.some((entry) => entry?.isFinancial)) {
        const okToClear = window.confirm(
          'Some of these are financial operations. Clearing stops retries and records the item for manager review. Clear anyway?',
        );
        if (!okToClear) return;
      }
      const ids = rows.map(queueId).filter(Boolean);
      if (row && ids.length === 0) throw new Error('This failed operation has no reference to clear.');
      const result = await window.api?.sync?.clearFailed?.(row ? ids : undefined);
      if (result?.success === false) throw new Error(result.error || 'Failed operations could not be cleared.');
      const removed = Number(result?.removed ?? ids.length ?? 0);
      setNotice(`${removed} cleared operation${removed === 1 ? '' : 's'} recorded for manager review on this computer.`);
      await load();
    } catch (clearError) {
      setError(clearError?.message || 'Failed operations could not be cleared.');
    } finally {
      setRunning(false);
    }
  };

  const discardVoidRecord = async (row) => {
    setRunning(true);
    setNotice('');
    setError('');
    try {
      const overrideId = row?.id || null;
      if (!overrideId) throw new Error('This void record has no reference to discard.');
      const orderShort = String(row?.order_id || '').slice(0, 8) || 'unknown order';
      const okToDiscard = window.confirm(
        `Discard the unconfirmed void record for order ${orderShort} (${row?.reason || 'no reason recorded'})? The server is checked first — a confirmed void is never discarded. Discarding keeps the server state as-is and records the decision for manager review. Discard anyway?`,
      );
      if (!okToDiscard) return;
      const result = await window.api?.pos?.discardLocalVoidRecord?.(overrideId);
      if (!result?.success) throw new Error(result?.error || 'Void record could not be discarded.');
      setNotice(result?.resolved === 'synced'
        ? 'The server already recorded that void — marked confirmed.'
        : `Void record discarded (${result?.disposition || 'reviewed'}). Recorded for manager review on this computer.`);
      await load();
    } catch (discardError) {
      setError(discardError?.message || 'Void record could not be discarded.');
    } finally {
      setRunning(false);
    }
  };

  const clearIssues = async () => {
    setRunning(true);
    setNotice('');
    setError('');
    try {
      const result = await window.api?.reports?.clearCriticalErrors?.();
      if (result?.success === false) throw new Error(result.error || 'Saved app issues could not be cleared.');
      setCriticalErrors([]);
      setNotice('Saved app issues cleared on this computer.');
      window.dispatchEvent(new Event('saved-app-issues-cleared'));
    } catch (clearError) {
      setError(clearError?.message || 'Saved app issues could not be cleared.');
    } finally {
      setRunning(false);
    }
  };

  const saveHardwareWith = async (next, successMessage = 'POS device settings saved on this computer.') => {
    setRunning(true);
    setNotice('');
    setError('');
    try {
      const result = await window.api?.pos?.saveHardwareSettings?.(next);
      if (result?.success === false) throw new Error(result.error || 'Device settings could not be saved.');
      if (result?.settings) setHardware(result.settings);
      else setHardware(next);
      setNotice(successMessage);
    } catch (saveError) {
      setError(saveError?.message || 'Device settings could not be saved.');
    } finally {
      setRunning(false);
    }
  };

  const saveHardware = async () => saveHardwareWith(hardware);

  const pinFieldForKind = (kind) => kind === 'bar'
    ? 'display_bar_display_id'
    : kind === 'kitchen'
      ? 'display_kitchen_display_id'
      : 'display_customer_display_id';

  const pinDisplay = async (kind, displayId, displayLabel) => {
    const field = pinFieldForKind(kind);
    const name = kind === 'customer' ? 'Customer display' : kind === 'bar' ? 'Bar board' : 'Kitchen board';
    // Pin onto freshly loaded settings, not the on-screen form: pinning must
    // never silently commit half-typed edits elsewhere on this page.
    const fresh = await Promise.resolve(window.api?.pos?.getHardwareSettings?.()).catch(() => null);
    const base = fresh && typeof fresh === 'object' ? fresh : {};
    await saveHardwareWith(
      { ...base, [field]: String(displayId || '') },
      displayId
        ? `${name} pinned to ${displayLabel || 'the selected monitor'}. It reopens there after restart. (Other unsaved edits were not kept — finish typing them first, then press Save.)`
        : `${name} unpinned. It opens on the remembered screen.`,
    );
    await load().catch(() => {});
  };

  const reopenPinnedDisplays = async () => {
    setNotice('');
    setError('');
    const kinds = barOnly ? ['customer', 'bar'] : ['customer', 'kitchen', 'bar'];
    const pinned = kinds.filter((kind) => hardware[pinFieldForKind(kind)]);
    if (pinned.length === 0) {
      setError('No display is pinned yet. Pin each screen below first.');
      return;
    }
    setRunning(true);
    try {
      for (const kind of pinned) {
        const displayId = hardware[pinFieldForKind(kind)];
        const result = await window.api?.pos?.openDisplay?.(kind, { displayId, fullScreen: displayFullScreen });
        if (result?.success === false) throw new Error(result.error || `${kind} display could not be opened.`);
      }
      setNotice(`Reopened ${pinned.length} pinned display${pinned.length === 1 ? '' : 's'} on ${pinned.length === 1 ? 'its' : 'their'} pinned screen${displayFullScreen ? ' full screen' : ''}.`);
    } catch (reopenError) {
      setError(reopenError?.message || 'Pinned displays could not be reopened.');
    } finally {
      setRunning(false);
    }
  };

  const testHardware = async (kind) => {
    setRunning(true);
    setNotice('');
    setError('');
    try {
      const result = await Promise.resolve(window.api?.pos?.testHardware?.(kind)).catch(() => null);
      if (!result) throw new Error('Device test is unavailable in this app build.');
      // Manual card mode is not a failure: nothing to test, machine as usual.
      if (result?.success === false && result?.manual === true) {
        setNotice(result.error || 'Manual mode: nothing to test — charge on the machine as usual.');
        return;
      }
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

  const openCashDrawerTest = async () => {
    setRunning(true);
    setNotice('');
    setError('');
    try {
      const result = await window.api?.pos?.testHardware?.('drawer');
      if (result?.success === false) throw new Error(result.error || result.message || 'Cash drawer test failed.');
      setNotice(result?.message || 'Cash drawer test completed.');
    } catch (drawerError) {
      setError(drawerError?.message || 'Cash drawer test failed.');
    } finally {
      setRunning(false);
    }
  };

  const testAllDevices = async () => {
    setTestingAll(true);
    setRunning(true);
    setNotice('');
    setError('');
    const outcomes = [];
    try {
      const receipt = await Promise.resolve(window.api?.pos?.testHardware?.('receipt')).catch(() => null);
      outcomes.push(receipt?.success === false
        ? `Receipt: ${receipt?.error || 'failed'}`
        : receipt?.verified === false
          ? `Receipt: set up, not proven — use Test receipt to print a real page (${receipt?.message || 'Windows printer mode'})`
          : `Receipt: ${receipt?.message || 'ok'}`);
      if (hardware.cash_drawer_enabled === true && hardware.cash_drawer_manual !== true) {
        const drawer = await Promise.resolve(window.api?.pos?.testHardware?.('drawer')).catch(() => null);
        outcomes.push(`Drawer: ${drawer?.success === false ? drawer?.error || 'failed' : drawer?.message || 'ok'}`);
      } else {
        outcomes.push(hardware.cash_drawer_manual === true ? 'Drawer: manual drawer — no kick test' : 'Drawer: skipped (not enabled)');
      }
      const terminal = await Promise.resolve(window.api?.pos?.testHardware?.('payment-terminal')).catch(() => null);
      outcomes.push(terminal?.success === false && terminal?.manual === true
        ? `Card terminal: manual mode — nothing to test (${terminal?.error || 'charge on the machine as usual'})`
        : `Card terminal: ${terminal?.success === false ? terminal?.error || 'failed' : terminal?.message || 'ok'}`);
      const scannerState = hardware.scanner_last_verified_at
        ? `Scanner: last verified ${new Date(hardware.scanner_last_verified_at).toLocaleString('en-GB')}`
        : 'Scanner: not yet verified on this computer — use Verify scanner input';
      outcomes.push(scannerState);
      outcomes.push(displays.length
        ? `Displays: ${displays.length} monitor${displays.length === 1 ? '' : 's'} detected`
        : 'Displays: none detected — connect a monitor, then Refresh');
      const failed = outcomes.some((line) => /failed|not yet verified|none detected/i.test(line));
      if (failed) setError(outcomes.join(' · '));
      else setNotice(outcomes.join(' · '));
      await load();
    } catch (testAllError) {
      setError(testAllError?.message || outcomes.join(' · ') || 'Device tests could not run.');
    } finally {
      setTestingAll(false);
      setRunning(false);
    }
  };

  const applyDetectedPrinter = async () => {
    const first = printers.find((printer) => printer?.name)?.name || printers[0]?.name;
    if (!first) {
      setError('No Windows printers were detected on this computer.');
      return;
    }
    setHardware((previous) => ({ ...previous, receipt_printer_name: first }));
    setNotice(`Receipt printer set to ${first}. Save device settings to keep it.`);
  };

  const scanNetwork = async () => {
    setScanning(true);
    setNotice('');
    setError('');
    try {
      const result = await window.api?.pos?.scanNetworkPrinters?.();
      if (result?.success === false) throw new Error(result.error || 'Network printer scan failed.');
      setScanResults(result?.found || []);
      setNotice(result?.message || 'Network scan finished.');
    } catch (scanError) {
      setScanResults([]);
      setError(scanError?.message || 'Network printer scan failed.');
    } finally {
      setScanning(false);
    }
  };

  const applyScannedPrinter = (host, port) => {
    setHardware((previous) => ({
      ...previous,
      receipt_print_mode: 'escpos',
      escpos_enabled: true,
      escpos_connection_type: 'network',
      escpos_network_host: host,
      escpos_network_port: port,
    }));
    setNotice(`Direct-print target set to ${host}:${port}. Save device settings, then Test receipt.`);
  };

  const openDrawerNoSale = async () => {
    const reason = String(drawerReason || '').trim();
    if (!reason) {
      setError('Type a reason first (for example: change run, float top-up). The reason is written to the audit trail.');
      return;
    }
    setRunning(true);
    setNotice('');
    setError('');
    try {
      const result = await window.api?.pos?.openCashDrawer?.({ reason: `manual_no_sale: ${reason}` });
      if (result?.success === false) throw new Error(result.error || 'The drawer did not open.');
      setDrawerReason('');
      setNotice(result?.message || 'Cash drawer opened. The reason was recorded.');
    } catch (drawerError) {
      setError(drawerError?.message || 'The drawer did not open.');
    } finally {
      setRunning(false);
    }
  };

  // Morning check looks but never touches: no test prints, no drawer kicks.
  // It reads detection + saved setup and answers green/red per device.
  const runMorningCheck = async () => {
    setCheckingMorning(true);
    setMorningCheck(null);
    try {
      const [printerList, displayList, syncStatus] = await Promise.all([
        Promise.resolve(window.api?.receipts?.listPrinters?.()).catch(() => []) || [],
        Promise.resolve(window.api?.pos?.listDisplays?.()).catch(() => []) || [],
        Promise.resolve(window.api?.sync?.getStatus?.()).catch(() => null) || null,
      ]);
      const detectedNames = (Array.isArray(printerList) ? printerList : []).map((printer) => printer?.name).filter(Boolean);
      const printerOk = hardware.receipt_print_mode === 'escpos'
        ? escposTargetConfigured
        : detectedNames.length === 0 || !hardware.receipt_printer_name || detectedNames.includes(hardware.receipt_printer_name);
      const drawerOk = hardware.cash_drawer_manual === true || hardware.cash_drawer_enabled !== true || escposTargetConfigured;
      const scannerOk = hardware.barcode_scanner_enabled === false || scannerAgeDays === null || scannerAgeDays <= 30;
      const pinnedIds = pinnedKinds.map((kind) => String(hardware[pinFieldForKind(kind)] || '')).filter(Boolean);
      const liveIds = new Set((Array.isArray(displayList) ? displayList : []).map((display) => String(display.id)));
      const screensOk = pinnedIds.length === 0 || pinnedIds.some((id) => liveIds.has(id));
      const terminalOk = terminalMode === 'manual' || terminalBridgeReady;
      setMorningCheck([
        { label: 'Internet', ok: syncStatus?.isOnline !== false, detail: syncStatus?.isOnline !== false ? 'Online.' : 'Offline — keep selling, work sends later.' },
        { label: 'Receipt printer', ok: printerOk, detail: hardware.receipt_print_mode === 'escpos' ? (escposTargetConfigured ? 'Direct-print target saved.' : 'No printer target — receipts will fail.') : (hardware.receipt_printer_name ? (printerOk ? `Found: ${hardware.receipt_printer_name}.` : 'Saved printer not found — check the cable or WiFi.') : 'Using the system default printer.') },
        { label: 'Cash drawer', ok: drawerOk, detail: hardware.cash_drawer_manual === true ? 'Manual drawer — opened with the key.' : hardware.cash_drawer_enabled === true ? (drawerOk ? 'Drawer kicks via the receipt printer.' : 'Drawer needs the printer target above.') : 'Disabled — nothing to check.' },
        { label: 'Scanner', ok: scannerOk, detail: hardware.barcode_scanner_enabled === false ? 'Disabled — nothing to check.' : (scannerAgeDays === null ? 'Never tested here — verify below.' : (scannerAgeDays > 30 ? `Last tested ${scannerAgeDays} days ago — re-verify below.` : 'Verified.')) },
        { label: 'Guest screen', ok: screensOk, detail: pinnedIds.length === 0 ? 'No screen pinned — pin one below.' : (screensOk ? 'Pinned screen detected.' : 'Pinned screen missing — check the HDMI cable or pin another.') },
        { label: 'Card machine', ok: terminalOk, detail: terminalMode === 'manual' ? 'Manual mode — switch it on and check its paper.' : (terminalOk ? 'Bridge ready.' : 'Provider or bridge address missing.') },
      ]);
      setNotice('Morning check finished — green means ready, red means fix before the rush.');
    } catch (checkError) {
      setError(checkError?.message || 'Morning check could not run.');
    } finally {
      setCheckingMorning(false);
    }
  };

  const toggleDailyCheck = (group, key) => {
    setDailyChecks((previous) => {
      const next = {
        open: { ...(previous.open || {}) },
        close: { ...(previous.close || {}) },
        cardMachineTotal: previous.cardMachineTotal ?? '',
        tillCardTotal: previous.tillCardTotal ?? '',
      };
      next[group][key] = !next[group][key];
      try { window.localStorage?.setItem(dailyChecksKey, JSON.stringify(next)); } catch { /* per-day helper */ }
      return next;
    });
  };

  const setDailyCardTotals = (field, value) => {
    setDailyChecks((previous) => {
      const next = { ...previous, [field]: value };
      try { window.localStorage?.setItem(dailyChecksKey, JSON.stringify(next)); } catch { /* per-day helper */ }
      return next;
    });
  };

  const sendHelpRequest = async () => {
    setHelpBusy(true);
    setNotice('');
    setError('');
    try {
      if (typeof window.api?.admin?.createSupportTicket !== 'function') {
        throw new Error('This app build cannot send help requests. Relaunch the app fully and try again.');
      }
      const lines = [
        'A staff member pressed "Something is wrong — get help" on the Bar terminal.',
        '',
        `Devices: ${deviceReadiness.map((item) => `${item.label}: ${item.value}`).join(' | ')}`,
        `App issues saved: ${criticalErrors.length}`,
        `Failed operations waiting: ${failed}`,
        `Operations waiting to send: ${pending}`,
        `Internet: ${online ? 'online' : 'offline'}`,
      ];
      const result = await window.api.admin.createSupportTicket({
        title: `Bar terminal help request${criticalErrors.length > 0 || failed > 0 ? ' — issues found' : ''}`,
        description: lines.join('\n'),
        category: 'Technical Support',
        priority: criticalErrors.length > 0 || failed > 0 ? 'High' : 'Normal',
        source: 'hpos-system-health',
      });
      if (result?.success === false || !result?.id) {
        throw new Error(result?.error || 'The help request was not confirmed. Connect to the internet and try again.');
      }
      setNotice('Help request sent. Support can see your device summary — never type PINs or card numbers here.');
    } catch (helpError) {
      setError(helpError?.message || 'The help request could not be sent.');
    } finally {
      setHelpBusy(false);
    }
  };

  const escposTargetConfigured = Boolean(
    String(hardware.escpos_connection_type || 'network').toLowerCase() === 'network'
      ? hardware.escpos_network_host || hardware.escpos_printer_path
      : hardware.escpos_printer_path,
  );
  const printerNames = printers.map((printer) => printer?.name).filter(Boolean);
  const savedPrinterMissing = Boolean(hardware.receipt_printer_name)
    && printerNames.length > 0
    && !printerNames.includes(hardware.receipt_printer_name);
  const terminalMode = String(hardware.payment_terminal_mode || 'manual').toLowerCase();
  const terminalBridgeReady = terminalMode !== 'manual'
    && Boolean(hardware.payment_terminal_provider)
    && Boolean(hardware.payment_terminal_bridge_url);
  const scannerVerifiedAt = hardware.scanner_last_verified_at ? new Date(hardware.scanner_last_verified_at) : null;
  const scannerAgeDays = scannerVerifiedAt && !Number.isNaN(scannerVerifiedAt.getTime())
    ? Math.floor((Date.now() - scannerVerifiedAt.getTime()) / 86400000)
    : null;

  const deviceReadiness = useMemo(() => {
    const receipts = hardware.receipt_print_mode === 'escpos'
      ? (escposTargetConfigured
        ? { label: 'Receipts', value: 'ESC/POS target set', tone: 'success' }
        : { label: 'Receipts', value: 'Needs ESC/POS target', tone: 'danger' })
      : (hardware.receipt_printer_name
        ? (savedPrinterMissing
          ? { label: 'Receipts', value: 'Printer not found on this PC', tone: 'danger' }
          : { label: 'Receipts', value: 'Windows printer set', tone: 'success' })
        : { label: 'Receipts', value: printers.length ? 'Detected — pick a printer' : 'System default printer', tone: 'warning' });
    const drawer = hardware.cash_drawer_manual === true
      ? { label: 'Cash drawer', value: 'Manual drawer — key open', tone: 'success' }
      : hardware.cash_drawer_enabled === true
        ? (escposTargetConfigured
          ? { label: 'Cash drawer', value: 'Enabled', tone: 'success' }
          : { label: 'Cash drawer', value: 'Needs printer target', tone: 'danger' })
        : { label: 'Cash drawer', value: 'Disabled', tone: 'neutral' };
    const card = terminalMode === 'manual'
      ? { label: 'Card terminal', value: 'Manual mode', tone: 'neutral' }
      : (terminalBridgeReady
        ? { label: 'Card terminal', value: 'Bridge ready', tone: 'success' }
        : { label: 'Card terminal', value: 'Needs provider + bridge URL', tone: 'danger' });
    const scanner = hardware.barcode_scanner_enabled === false
      ? { label: 'Scanner', value: 'Disabled', tone: 'neutral' }
      : (scannerAgeDays === null
        ? { label: 'Scanner', value: 'Not yet verified', tone: 'warning' }
        : (scannerAgeDays > 30
          ? { label: 'Scanner', value: `Verified ${scannerAgeDays}d ago — re-verify`, tone: 'warning' }
          : { label: 'Scanner', value: 'Verified', tone: 'success' }));
    const screens = displays.length
      ? { label: 'Displays', value: `${displays.length} monitor${displays.length === 1 ? '' : 's'} detected`, tone: 'success' }
      : { label: 'Displays', value: 'None detected', tone: 'warning' };
    return [receipts, drawer, card, scanner, screens];
  }, [displays.length, escposTargetConfigured, hardware.barcode_scanner_enabled, hardware.cash_drawer_enabled, hardware.receipt_print_mode, hardware.receipt_printer_name, printers.length, savedPrinterMissing, scannerAgeDays, terminalBridgeReady, terminalMode]);

  const displayIds = useMemo(
    () => new Set(displays.map((display) => String(display.id))),
    [displays],
  );
  const pinnedKinds = barOnly ? ['customer', 'bar'] : ['customer', 'kitchen', 'bar'];
  const pinnedName = (kind) => kind === 'customer' ? 'Customer display' : kind === 'bar' ? 'Bar board' : 'Kitchen board';

  // Numbered first-time setup: printer → drawer → scanner → screens → card.
  // A disabled device counts as done (nothing to plug in); manual card mode
  // counts as done (works with any machine, no bridge needed).
  const setupSteps = useMemo(() => {
    const printerDone = hardware.receipt_print_mode === 'escpos'
      ? escposTargetConfigured
      : Boolean(hardware.receipt_printer_name) && !savedPrinterMissing;
    const drawerDone = hardware.cash_drawer_manual === true
      || hardware.cash_drawer_enabled !== true
      || escposTargetConfigured;
    const scannerDone = hardware.barcode_scanner_enabled === false || scannerAgeDays !== null;
    const screensDone = pinnedKinds.some((kind) => hardware[pinFieldForKind(kind)] && displayIds.has(String(hardware[pinFieldForKind(kind)])));
    const cardDone = terminalMode === 'manual' || terminalBridgeReady;
    return [
      { step: 1, label: 'Receipt printer', done: printerDone, hint: printerDone ? 'Printer target saved.' : 'Pick a detected printer, then Save.' },
      { step: 2, label: 'Cash drawer', done: drawerDone, hint: hardware.cash_drawer_manual === true ? 'Manual drawer — opened with the key.' : hardware.cash_drawer_enabled === true ? (drawerDone ? 'Drawer kicks via the receipt printer.' : 'Set the printer target first — the drawer cable plugs into the printer.') : 'Disabled — nothing to plug in.' },
      { step: 3, label: 'Barcode scanner', done: scannerDone, hint: hardware.barcode_scanner_enabled === false ? 'Disabled — nothing to plug in.' : (scannerDone ? 'Verified with a real scan.' : 'Click Verify scanner input and scan one label.') },
      { step: 4, label: 'Pin screens', done: screensDone, hint: screensDone ? 'A screen is pinned to its monitor.' : 'Pin the customer display to the guest-facing monitor below.' },
      { step: 5, label: 'Card machine', done: cardDone, hint: terminalMode === 'manual' ? 'Manual mode works with any machine.' : (cardDone ? 'Bridge ready.' : 'Enter the provider + bridge URL, then Test.') },
    ];
  }, [displayIds, escposTargetConfigured, hardware, pinnedKinds, savedPrinterMissing, scannerAgeDays, terminalBridgeReady, terminalMode]);
  const setupDoneCount = setupSteps.filter((item) => item.done).length;
  const nextSetupStep = setupSteps.find((item) => !item.done) || null;

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

  const openChecklist = [
    ['float', 'Shift opened with the float counted'],
    ['paper', 'Paper inside the printer (open it and look)'],
    ['receipt', 'Test receipt printed and readable'],
    ['drawer', 'Drawer kicks open (Test drawer below)'],
    ['screen', 'Guest screen on, on its pinned monitor'],
    ['machine', 'Card machine on, charged, paper inside'],
    ['scanner', 'Scanner verified (skip if you never scan)'],
  ];
  const closeChecklist = [
    ['tabs', 'All tabs settled — no open tabs left'],
    ['cash', 'Cash counted and submitted for review'],
    ['settle', 'Card machine settled (end-of-day on the machine)'],
    ['compare', 'Card compare done below — machine and report agree'],
    ['charger', 'Portable card machine back on its charger'],
    ['signout', 'Till signed out, guest screen left tidy'],
  ];
  const openDone = openChecklist.filter(([key]) => dailyChecks.open?.[key]).length;
  const closeDone = closeChecklist.filter(([key]) => dailyChecks.close?.[key]).length;
  const machineTotal = Number(String(dailyChecks.cardMachineTotal || '').replace(/[^0-9.]/g, ''));
  const tillTotal = Number(String(dailyChecks.tillCardTotal || '').replace(/[^0-9.]/g, ''));
  const cardCompareReady = Number.isFinite(machineTotal) && Number.isFinite(tillTotal)
    && String(dailyChecks.cardMachineTotal || '').trim() !== '' && String(dailyChecks.tillCardTotal || '').trim() !== '';
  const cardCompareDiff = cardCompareReady ? Math.round((machineTotal - tillTotal) * 100) / 100 : null;

  const tabs = [
    ['sync', 'Sync & queue', Database, failed + pending],
    ['issues', 'App issues', AlertTriangle, criticalErrors.length],
    ['devices', 'Devices & displays', Settings2, displays.length],
    ['checks', 'Daily checks', ClipboardCheck, (openChecklist.length - openDone) + (closeChecklist.length - closeDone)],
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
              <div><h2>Operation queue</h2><p>Retries keep the original operation identifiers and payloads. Clearing stops retries and records the item for manager review.</p></div>
              {canSync && <HposButton tone="primary" icon={RefreshCw} onClick={runNow} disabled={running}>{running ? 'Working…' : 'Sync now'}</HposButton>}
            </div>
            {(details?.failed || []).length > 0 && (
              <div className="hpos-sync-list">
                <header><strong>Failed operations</strong>{canSync && <span className="hpos-sync-header-actions"><HposButton onClick={() => retryFailed()} disabled={running}>Retry all failed</HposButton><HposButton onClick={() => clearFailedItems()} disabled={running}>Clear all failed</HposButton></span>}</header>
                {(details.failed || []).map((row) => (
                  <article key={queueId(row) || JSON.stringify(row)}>
                    <span className="hpos-health-icon is-danger"><AlertTriangle size={17} /></span>
                    <div><strong>{String(row.table || row.type || 'Operation').replaceAll('_', ' ')}</strong><p>{row.displayError || row.lastError || 'This operation did not sync.'}</p><small>{row.isFinancial ? 'Financial operation · preserve for review' : row.dependencyLabel || 'Operational item'}</small></div>
                    {row.isFinancial && <HposStatusBadge tone="danger">Financial</HposStatusBadge>}
                    {canSync && <span className="hpos-sync-row-actions"><HposButton onClick={() => retryFailed(row)} disabled={running}>Retry</HposButton><HposButton onClick={() => clearFailedItems(row)} disabled={running}>Clear</HposButton></span>}
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
            {unsyncedVoids.length > 0 && (
              <div className="hpos-sync-list">
                <header><strong>Void records awaiting confirmation</strong><HposStatusBadge tone="danger">{unsyncedVoids.length} unconfirmed</HposStatusBadge></header>
                {unsyncedVoids.map((row) => (
                  <article key={row?.id || JSON.stringify(row)}>
                    <span className="hpos-health-icon is-danger"><AlertTriangle size={17} /></span>
                    <div><strong>Void order {String(row?.order_id || '').slice(0, 8) || 'unknown'}</strong><p>{row?.reason || 'No reason recorded.'}</p><small>Financial record · {row?._sync_error || (row?._sync_state === 'pending' ? 'never sent — its queue entry is gone' : 'needs manager review')} · {issueTime(row?.created_at)}</small></div>
                    <HposStatusBadge tone="danger">Financial</HposStatusBadge>
                    {canSync && <span className="hpos-sync-row-actions"><HposButton onClick={() => discardVoidRecord(row)} disabled={running}>Discard</HposButton></span>}
                  </article>
                ))}
              </div>
            )}
            {!loading && !(details?.failed || []).length && !(details?.pending || []).length && unsyncedVoids.length === 0 && (
              <HposEmptyState icon={CheckCircle2} title="Operation queue is clear" description="No pending or failed operations are waiting on this computer." />
            )}
          </section>
          <section className="hpos-sync-desk" aria-label="Other tills on this network">
            <div className="hpos-section-heading">
              <span><Wifi size={18} /></span>
              <div><h2>Other tills on this network</h2><p>Nearby Bar tills share unsent sales, stock receipts, tabs, shifts, menu changes and counts directly — same Local Mesh as the lodge app. The server still confirms every sale. Staff sign-ins stay on their own till: everyone signs in on each till before going offline.</p></div>
              {canSync && <span className="hpos-sync-header-actions"><HposButton onClick={() => meshAction('refresh')} disabled={meshBusy || running}>{meshBusy ? 'Searching…' : 'Search again'}</HposButton></span>}
            </div>
            <div className="hpos-health-grid">
              <article><div><HposStatusBadge tone={mesh?.running ? 'success' : 'warning'}>{mesh?.running ? 'running' : 'off'}</HposStatusBadge></div><small>This till</small><strong>{mesh?.running ? 'Listening' : mesh?.lastError || 'Not started'}</strong><p>Port {mesh?.httpPort || '…'}</p></article>
              <article><div><HposStatusBadge tone={Number(mesh?.peerCount || 0) > 0 ? 'success' : 'neutral'}>{Number(mesh?.peerCount || 0) > 0 ? 'linked' : 'alone'}</HposStatusBadge></div><small>Nearby tills</small><strong>{Number(mesh?.peerCount || 0)}</strong><p>{Number(mesh?.peerCount || 0) > 0 ? 'Sales and counts flow between tills.' : 'No other till found yet.'}</p></article>
              <article><div><HposStatusBadge tone="neutral">info</HposStatusBadge></div><small>Last share</small><strong>{mesh?.lastQueueMergeAt ? new Date(mesh.lastQueueMergeAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : 'Not yet'}</strong><p>{Number(mesh?.lastQueueRepair?.importedCount || 0)} operation{Number(mesh?.lastQueueRepair?.importedCount || 0) === 1 ? '' : 's'} taken in last pass</p></article>
              <article><div><HposStatusBadge tone={(mesh?.activeLocks || []).filter((lock) => lock.resourceKind === 'pos-tab').length > 0 ? 'warning' : 'neutral'}>holds</HposStatusBadge></div><small>Tab holds</small><strong>{(mesh?.activeLocks || []).filter((lock) => lock.resourceKind === 'pos-tab').length}</strong><p>Tabs being settled right now</p></article>
            </div>
            {(mesh?.activeLocks || []).filter((lock) => lock.resourceKind === 'pos-tab').length > 0 && (
              <div className="hpos-sync-list is-pending">
                {(mesh.activeLocks || []).filter((lock) => lock.resourceKind === 'pos-tab').map((lock) => (
                  <article key={lock.lockId}>
                    <span className="hpos-health-icon is-warning"><AlertTriangle size={17} /></span>
                    <div><strong>Tab settling{lock.operator ? ` by ${lock.operator}` : ' on the other till'}</strong><p>Wait a moment, then check Open tabs.</p></div>
                  </article>
                ))}
              </div>
            )}
            {Array.isArray(mesh?.warnings) && mesh.warnings.length > 0 && (
              <div className="hpos-sync-list is-pending">
                {mesh.warnings.slice(0, 3).map((warning, index) => (
                  <article key={`${warning}-${index}`}>
                    <span className="hpos-health-icon is-warning"><Wifi size={17} /></span>
                    <div><strong>Network note</strong><p>{warning}</p></div>
                  </article>
                ))}
              </div>
            )}
            {Array.isArray(mesh?.peers) && mesh.peers.length > 0 && (
              <div className="hpos-display-list" aria-label="Connected tills">
                {mesh.peers.slice(0, 6).map((peer) => (
                  <article key={peer.nodeId}>
                    <div><strong>Till ···{String(peer.nodeId || '').slice(-4) || '?'}</strong><span>{peer.address}{peer.manual ? ' · added by hand' : ''} · seen {peer.lastSeenAt ? new Date(peer.lastSeenAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : 'just now'}</span></div>
                  </article>
                ))}
              </div>
            )}
            {mesh?.lastTeamSync?.at && (
              <p className="hpos-help-text">Team state (who is in shift, drawer cash, cash-ups) shared {new Date(mesh.lastTeamSync.at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })} — sign-ins themselves stay on their own till.</p>
            )}
            {canSync && (
              <div className="hpos-form-grid" aria-label="Add a nearby till by address">
                <label className="is-wide">Other till’s address<input value={peerAddress} onChange={(event) => setPeerAddress(event.target.value)} placeholder="Example: 192.168.1.20" inputMode="numeric" /></label>
                <label>Port (optional)<input value={peerPort} onChange={(event) => setPeerPort(event.target.value.replace(/[^0-9]/g, '').slice(0, 5))} placeholder="Blank = automatic" inputMode="numeric" /></label>
              </div>
            )}
            {canSync && <div className="hpos-device-actions"><HposButton tone="primary" onClick={() => meshAction('connect')} disabled={meshBusy || running}>Connect till</HposButton></div>}
          </section>
          <section className="hpos-health-guidance"><CheckCircle2 size={20} /><div><h2>Financial truth stays server-authoritative</h2><p>Pending work remains visibly queued. A retry reuses the existing operation identifier; this screen never invents a replacement payment, order, or stock movement.</p></div></section>
        </>
      )}

      {activeTab === 'issues' && (
        <>
          <section className="hpos-sync-desk">
            <div className="hpos-section-heading">
              <span><AlertTriangle size={18} /></span>
              <div><h2>Important app issues</h2><p>Saved desktop issues, the same list the top-right warning pill counts.</p></div>
              {canClearIssues && criticalErrors.length > 0 && <HposButton onClick={clearIssues} disabled={running}>Clear saved issues</HposButton>}
            </div>
            {criticalErrors.length === 0 ? (
              <HposEmptyState icon={CheckCircle2} title="No saved app issues" description="No important desktop issues were found recently." />
            ) : (
              <div className="hpos-sync-list">
                {criticalErrors.map((entry, index) => (
                  <article key={entry.id || `${entry.at || 'issue'}-${index}`}>
                    <span className={`hpos-health-icon is-${issueTone(entry)}`}><AlertTriangle size={17} /></span>
                    <div>
                      <strong>{issueLabel(entry)}</strong>
                      <p>{entry.message || 'No message recorded.'}</p>
                      <small>{issueTime(entry.at)}</small>
                      {entry.details && typeof entry.details === 'object' && Object.keys(entry.details).length > 0 && (
                        <details className="hpos-issue-details">
                          <summary>Show context</summary>
                          <pre>{JSON.stringify(entry.details, null, 2)}</pre>
                        </details>
                      )}
                    </div>
                    <HposStatusBadge tone={issueTone(entry)}>{issueTone(entry) === 'danger' ? 'Error' : 'Note'}</HposStatusBadge>
                  </article>
                ))}
              </div>
            )}
          </section>
          <section className="hpos-sync-desk">
            <div className="hpos-section-heading">
              <span><AlertTriangle size={18} /></span>
              <div><h2>Something is wrong — get help</h2><p>One tap sends your device summary to support. Never type PINs, passwords, or card numbers.</p></div>
              <HposButton tone="primary" onClick={sendHelpRequest} disabled={helpBusy || running}>{helpBusy ? 'Sending…' : 'Send problem to support'}</HposButton>
            </div>
          </section>
          <section className="hpos-sync-desk">
            <div className="hpos-section-heading">
              <span><AlertTriangle size={18} /></span>
              <div><h2>Recent crashes</h2><p>Crash details for when this app needs recovery.</p></div>
            </div>
            {rendererErrors.length === 0 ? (
              <HposEmptyState icon={CheckCircle2} title="No recent crashes" description="No crashes were found on this computer." />
            ) : (
              <div className="hpos-sync-list">
                {rendererErrors.map((entry, index) => (
                  <article key={entry.id || `${entry.at || 'crash'}-${index}`}>
                    <span className="hpos-health-icon is-danger"><AlertTriangle size={17} /></span>
                    <div>
                      <strong>{entry.message || 'Unknown app issue'}</strong>
                      <small>{issueTime(entry.at)}</small>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>
        </>
      )}

      {activeTab === 'devices' && (
        <div className="hpos-device-layout">
          <section className="hpos-device-panel is-wide" aria-label="Device readiness">
            <div className="hpos-section-heading"><span><Settings2 size={18} /></span><div><h2>Device readiness</h2><p>Detected on this POS computer. Work the steps in order: {setupDoneCount} of {setupSteps.length} done{nextSetupStep ? `. Next: step ${nextSetupStep.step} — ${nextSetupStep.label}: ${nextSetupStep.hint}` : ' — every device is ready.'}</p></div>{canManagePos && <HposButton tone="primary" icon={RefreshCw} onClick={testAllDevices} disabled={running || testingAll}>{testingAll ? 'Testing…' : 'Test all devices'}</HposButton>}</div>
            <div className="hpos-health-grid">
              {deviceReadiness.map((item) => (
                <article key={item.label}>
                  <div><HposStatusBadge tone={item.tone}>{item.tone}</HposStatusBadge></div>
                  <small>{item.label}</small><strong>{item.value}</strong>
                </article>
              ))}
            </div>
            <ol className="hpos-setup-steps" aria-label="Device setup steps">
              {setupSteps.map((item) => (
                <li key={item.step} className={item.done ? 'is-done' : 'is-next'}>
                  <strong>{item.step}. {item.label}</strong><span>{item.done ? 'Ready' : item.hint}</span>
                </li>
              ))}
            </ol>
            <p className="hpos-help-text">What plugs in where: the receipt printer connects by USB or network; the cash drawer cable plugs into the receipt printer (not the PC); the scanner pairs as a USB/Bluetooth keyboard; the card machine works standalone in Manual mode.</p>
            {canManagePos && <div className="hpos-device-actions"><HposButton onClick={runMorningCheck} disabled={checkingMorning || running}>{checkingMorning ? 'Checking…' : 'Run morning check'}</HposButton></div>}
            {morningCheck && (
              <ul className="hpos-setup-steps" aria-label="Morning check results">
                {morningCheck.map((row) => (
                  <li key={row.label} className={row.ok ? 'is-done' : 'is-next'}>
                    <strong>{row.ok ? '✓' : '✗'} {row.label}</strong><span>{row.detail}</span>
                  </li>
                ))}
              </ul>
            )}
            <details>
              <summary>First day with the till? Read this</summary>
              <div className="hpos-form-grid">
                <p className="hpos-help-text">1. Plug the printer into the PC (USB) or the bar WiFi, then pick it in the printer panel and Save. 2. Plug the drawer cable into the back of the printer, tick Cash drawer connected, Save, then Test drawer. 3. Plug the scanner in, press Verify scanner input, and scan any product. 4. Connect the second monitor, pin the Customer display to it, and tick Open on startup. 5. The card machine needs nothing — Manual mode works out of the box. Finish with Test all devices, then open the Daily checks tab and work the opening list.</p>
              </div>
            </details>
          </section>
          <section className="hpos-device-panel" aria-live="polite">
            <div className="hpos-section-heading"><span><ScanLine size={18} /></span><div><h2>Barcode scanner</h2><p>USB/Bluetooth scanners type like a keyboard — confirm with one real scan on this computer.</p></div></div>
            <div className="hpos-form-grid">
              <label><span>Scanner status</span><strong>{scannerVerifying ? `Waiting for scan${scannerCaptureCount ? ` · ${scannerCaptureCount} characters` : '…'}` : pendingScannerVerification ? 'Captured · confirmation required' : hardware.scanner_last_verified_at ? `Verified ${new Date(hardware.scanner_last_verified_at).toLocaleString('en-GB')}${scannerAgeDays !== null && scannerAgeDays > 30 ? ` · ${scannerAgeDays} days ago — re-verify` : ''}` : 'Not tested on this computer'}</strong></label>
              <label><span>Input framing</span><small>{hardware.barcode_scanner_accept_enter !== false ? 'Enter' : ''}{hardware.barcode_scanner_accept_enter !== false && hardware.barcode_scanner_accept_tab !== false ? ' or ' : ''}{hardware.barcode_scanner_accept_tab !== false ? 'Tab' : ''} terminator · idle completion supported</small></label>
            </div>
            <p className="hpos-help-text">Plug the scanner in as USB/Bluetooth keyboard mode. Click Verify, scan one real product label, and confirm the captured length and terminator. The audit stores only a one-way hash of the test barcode — never the barcode itself.</p>
            {canManagePos && <div className="hpos-form-grid" aria-label="Barcode scanner configuration">
              <label><span>Scanner enabled</span><input type="checkbox" checked={hardware.barcode_scanner_enabled !== false} onChange={(event) => setHardware({ ...hardware, barcode_scanner_enabled: event.target.checked })} /></label>
              <label><span>Minimum characters</span><input type="number" min="1" max="128" value={hardware.barcode_scanner_min_length ?? 4} onChange={(event) => setHardware({ ...hardware, barcode_scanner_min_length: Number(event.target.value) })} /></label>
              <label><span>Maximum characters</span><input type="number" min="1" max="128" value={hardware.barcode_scanner_max_length ?? 128} onChange={(event) => setHardware({ ...hardware, barcode_scanner_max_length: Number(event.target.value) })} /></label>
              <label><span>Terminator keys</span><select value={hardware.barcode_scanner_accept_enter !== false ? hardware.barcode_scanner_accept_tab !== false ? 'enter+tab' : 'enter' : 'tab'} onChange={(event) => { const value = event.target.value; setHardware({ ...hardware, barcode_scanner_accept_enter: value.includes('enter'), barcode_scanner_accept_tab: value.includes('tab') }); }}><option value="enter+tab">Enter or Tab</option><option value="enter">Enter only</option><option value="tab">Tab only</option></select></label>
            </div>}
            {canManagePos && (
              <details open={showAdvancedScanner} onToggle={(event) => setShowAdvancedScanner(event.target.open)}>
                <summary>Advanced scanner timing & framing</summary>
                <div className="hpos-form-grid" aria-label="Advanced barcode scanner settings">
                  <label><span>Inter-key limit (ms)</span><input type="number" min="10" max="1000" value={hardware.barcode_scanner_inter_key_ms ?? 120} onChange={(event) => setHardware({ ...hardware, barcode_scanner_inter_key_ms: Number(event.target.value) })} /></label>
                  <label><span>Idle completion (ms)</span><input type="number" min="50" max="2000" value={hardware.barcode_scanner_idle_complete_ms ?? 180} onChange={(event) => setHardware({ ...hardware, barcode_scanner_idle_complete_ms: Number(event.target.value) })} /></label>
                  <label><span>Prefix (optional)</span><input maxLength="16" value={hardware.barcode_scanner_prefix || ''} onChange={(event) => setHardware({ ...hardware, barcode_scanner_prefix: event.target.value })} placeholder="e.g. ]C1" /></label>
                  <label><span>Suffix (optional)</span><input maxLength="16" value={hardware.barcode_scanner_suffix || ''} onChange={(event) => setHardware({ ...hardware, barcode_scanner_suffix: event.target.value })} placeholder="Optional framing" /></label>
                </div>
                <p className="hpos-help-text">Only change timing if fast scans are missed or typing is mistaken for scans. Most scanners work with the defaults.</p>
              </details>
            )}
            {pendingScannerVerification && <div className="hpos-health-guidance"><ScanLine size={18} /><div><strong>Captured barcode: <code>{pendingScannerVerification.barcode}</code></strong><p>{pendingScannerVerification.characterCount} characters · {pendingScannerVerification.terminator || 'idle'} terminator{scanProductName ? ` · belongs to: ${scanProductName}` : ' · no product uses this barcode yet — add it in Products if needed'}</p></div></div>}
            <p className="hpos-help-text">Scan beeps follow the till sound switch (top bar, next to the date). A high double-beep means good, a low buzz means bad.</p>
            <div className="hpos-device-actions">
              <HposButton tone="primary" icon={ScanLine} onClick={() => { setError(''); setNotice('Scanner verification is listening. Scan one barcode now.'); setPendingScannerVerification(null); setScannerCaptureCount(0); setScannerVerifying(true); }} disabled={!canManagePos || scannerVerifying || hardware.barcode_scanner_enabled === false}>{scannerVerifying ? 'Waiting for scan…' : 'Verify scanner input'}</HposButton>
              {pendingScannerVerification && <HposButton tone="primary" onClick={confirmScannerVerification}>Confirm captured barcode</HposButton>}
              {pendingScannerVerification && <HposButton onClick={() => { setPendingScannerVerification(null); setNotice('Captured barcode discarded.'); }}>Discard</HposButton>}
              {scannerVerifying && <HposButton onClick={() => { setScannerVerifying(false); setScannerCaptureCount(0); setNotice('Scanner verification cancelled.'); }}>Cancel</HposButton>}
            </div>
          </section>
          <section className="hpos-device-panel">
            <div className="hpos-section-heading"><span><Printer size={18} /></span><div><h2>Receipt printer & cash drawer</h2><p>Settings apply to this POS computer. The drawer cable plugs into the receipt printer.</p></div></div>
            <div className="hpos-form-grid">
              <label className="is-wide">Windows printer name<input disabled={!canManagePos} value={hardware.receipt_printer_name || ''} onChange={(event) => setHardware({ ...hardware, receipt_printer_name: event.target.value })} placeholder="Leave blank to use the system default" list="hpos-printer-list" /></label>
              <datalist id="hpos-printer-list">
                {printerNames.map((name) => (<option key={name} value={name} />))}
              </datalist>
              <label>Print method<select disabled={!canManagePos} value={hardware.receipt_print_mode || 'windows'} onChange={(event) => setHardware({ ...hardware, receipt_print_mode: event.target.value })}><option value="windows">Windows printer</option><option value="escpos">Direct ESC/POS (network / till printer)</option></select></label>
              <label>Paper width<select disabled={!canManagePos} value={hardware.receipt_paper_width || '80mm'} onChange={(event) => setHardware({ ...hardware, receipt_paper_width: event.target.value })}><option value="80mm">80 mm</option><option value="58mm">58 mm</option></select></label>
            </div>
            {printers.length > 0 && (
              <p className="hpos-help-text">Detected printers on this PC: {printerNames.join(', ')}. {hardware.receipt_printer_name ? (savedPrinterMissing ? 'The saved name was not found — pick a detected printer, then Save.' : 'The saved printer matches this PC.') : 'Pick your receipt printer, then Save.'} {!hardware.receipt_printer_name && canManagePos && <button type="button" className="hpos-secondary-action" onClick={applyDetectedPrinter} disabled={running}>Use {printerNames[0]}</button>}</p>
            )}
            {printers.length === 0 && (
              <p className="hpos-help-text">No Windows printers detected yet. Connect or share the till printer, then press Refresh.</p>
            )}
            {hardware.receipt_print_mode === 'escpos' && (
              <div className="hpos-form-grid" aria-label="Direct ESC/POS target">
                <label>Connection<select disabled={!canManagePos} value={hardware.escpos_connection_type || 'network'} onChange={(event) => setHardware({ ...hardware, escpos_connection_type: event.target.value })}><option value="network">Network / IP</option><option value="share">Windows share</option><option value="serial">COM / LPT device</option><option value="path">Raw device path</option></select></label>
                <label>Printer IP or host<input disabled={!canManagePos} value={hardware.escpos_network_host || ''} onChange={(event) => setHardware({ ...hardware, escpos_network_host: event.target.value })} placeholder="e.g. 192.168.1.50" /></label>
                <label>Port<input disabled={!canManagePos} type="number" min="1" max="65535" value={hardware.escpos_network_port ?? 9100} onChange={(event) => setHardware({ ...hardware, escpos_network_port: Number(event.target.value) })} /></label>
                <label className="is-wide">Device path / share (optional)<input disabled={!canManagePos} value={hardware.escpos_printer_path || ''} onChange={(event) => setHardware({ ...hardware, escpos_printer_path: event.target.value })} placeholder="tcp://192.168.1.50:9100, COM3, or \\DESK\ReceiptPrinter" /></label>
                <label>Codepage<select disabled={!canManagePos} value={hardware.escpos_codepage || 'cp437'} onChange={(event) => setHardware({ ...hardware, escpos_codepage: event.target.value })}><option value="cp437">CP437</option><option value="cp850">CP850</option><option value="cp858">CP858</option></select></label>
                <label>Timeout (ms)<input disabled={!canManagePos} type="number" min="1500" max="60000" value={hardware.escpos_timeout_ms ?? 8000} onChange={(event) => setHardware({ ...hardware, escpos_timeout_ms: Number(event.target.value) })} /></label>
              </div>
            )}
            {hardware.receipt_print_mode === 'escpos' && !escposTargetConfigured && (
              <p className="hpos-help-text">Direct printing needs a target: enter the printer IP (or device path), then Save and Test receipt.</p>
            )}
            {hardware.receipt_print_mode === 'escpos' && canManagePos && (
              <div className="hpos-device-actions">
                <HposButton onClick={scanNetwork} disabled={scanning || running}>{scanning ? 'Scanning the bar network…' : 'Find printers on the network'}</HposButton>
              </div>
            )}
            {scanResults && scanResults.length > 0 && (
              <div className="hpos-display-list" aria-label="Found network printers">
                {scanResults.map((found) => (
                  <article key={`${found.host}:${found.port}`}>
                    <div><strong>{found.host}:{found.port}</strong><span>Answered on the printer port — print a test before saving</span></div>
                    <div>{canManagePos && <HposButton tone="primary" onClick={() => applyScannedPrinter(found.host, found.port)}>Use this printer</HposButton>}</div>
                  </article>
                ))}
              </div>
            )}
            <div className="hpos-device-toggles">
              <label><input type="checkbox" disabled={!canManagePos} checked={hardware.auto_print_receipts === true} onChange={(event) => setHardware({ ...hardware, auto_print_receipts: event.target.checked })} /><span><strong>Auto-print receipts</strong><small>Print after successful payment.</small></span></label>
              <label><input type="checkbox" disabled={!canManagePos} checked={hardware.receipt_cut_enabled !== false} onChange={(event) => setHardware({ ...hardware, receipt_cut_enabled: event.target.checked })} /><span><strong>Cut receipt paper</strong><small>Automatic cut, if the printer supports it.</small></span></label>
              <label><input type="checkbox" disabled={!canManagePos} checked={hardware.cash_drawer_enabled === true} onChange={(event) => setHardware({ ...hardware, cash_drawer_enabled: event.target.checked })} /><span><strong>Cash drawer connected</strong><small>Kicks via the receipt printer — set the printer above first.</small></span></label>
              <label><input type="checkbox" disabled={!canManagePos} checked={hardware.cash_drawer_manual === true} onChange={(event) => setHardware({ ...hardware, cash_drawer_manual: event.target.checked })} /><span><strong>Manual drawer (no printer)</strong><small>We open it with the key — no kick, no warnings. Money routines keep working.</small></span></label>
              {hardware.cash_drawer_manual !== true && <label><input type="checkbox" disabled={!canManagePos} checked={hardware.cash_drawer_open_on_cash === true} onChange={(event) => setHardware({ ...hardware, cash_drawer_open_on_cash: event.target.checked })} /><span><strong>Open on cash payment</strong><small>Trigger only after cash is recorded.</small></span></label>}
            </div>
            {hardware.cash_drawer_manual === true && <p className="hpos-help-text">Manual drawer: the Till never attempts an electronic kick, so receipts always print cleanly and no warnings appear. Float, drops, paid-outs, and cash-ups work exactly as usual.</p>}
            {hardware.cash_drawer_enabled === true && hardware.cash_drawer_manual !== true && (
              <div className="hpos-form-grid" aria-label="Cash drawer detail">
                <label>Open timing<select disabled={!canManagePos} value={hardware.cash_drawer_open_timing || 'after_payment'} onChange={(event) => setHardware({ ...hardware, cash_drawer_open_timing: event.target.value })}><option value="after_payment">After payment</option><option value="before_receipt">Before receipt</option></select></label>
                <label>Drawer pin<select disabled={!canManagePos} value={hardware.cash_drawer_pin || '0'} onChange={(event) => setHardware({ ...hardware, cash_drawer_pin: event.target.value })}><option value="0">Pin 0 (usual)</option><option value="1">Pin 1</option></select></label>
                <label>Pulse on (ms)<input disabled={!canManagePos} type="number" min="10" max="2550" value={hardware.cash_drawer_pulse_on_ms ?? 50} onChange={(event) => setHardware({ ...hardware, cash_drawer_pulse_on_ms: Number(event.target.value) })} /></label>
                <label>Pulse off (ms)<input disabled={!canManagePos} type="number" min="10" max="2550" value={hardware.cash_drawer_pulse_off_ms ?? 250} onChange={(event) => setHardware({ ...hardware, cash_drawer_pulse_off_ms: Number(event.target.value) })} /></label>
              </div>
            )}
            {canManagePos && <div className="hpos-device-actions"><HposButton tone="primary" onClick={saveHardware} disabled={running}>Save device settings</HposButton><HposButton icon={Printer} onClick={() => testHardware('receipt')} disabled={running}>Test receipt</HposButton>{hardware.cash_drawer_manual !== true && <HposButton onClick={openCashDrawerTest} disabled={running}>Test drawer</HposButton>}</div>}
            {canCashup && hardware.cash_drawer_manual !== true && (
              <div className="hpos-form-grid" aria-label="Open drawer without a sale">
                <label className="is-wide">Open drawer without a sale (reason is recorded)<input value={drawerReason} onChange={(event) => setDrawerReason(event.target.value)} placeholder="e.g. change run, float top-up" maxLength={120} /></label>
              </div>
            )}
            {canCashup && hardware.cash_drawer_manual !== true && <div className="hpos-device-actions"><HposButton onClick={openDrawerNoSale} disabled={running}>Open drawer (no sale)</HposButton></div>}
            {!canCashup && <p className="hpos-help-text">Opening the drawer without a sale needs cash-up access — ask a manager.</p>}
          </section>
          <section className="hpos-device-panel">
            <div className="hpos-section-heading"><span><CreditCard size={18} /></span><div><h2>Card machine (swipe terminal)</h2><p>Bank machines work in Manual mode with zero setup. Bridge mode sends the total at one tap.</p></div></div>
            <div className="hpos-form-grid">
              <label className="is-wide">Provider<input disabled={!canManagePos} value={hardware.payment_terminal_provider || ''} onChange={(event) => setHardware({ ...hardware, payment_terminal_provider: event.target.value })} placeholder="e.g. FNB, Stanbic, Absa, Yoco" list="hpos-terminal-providers" /></label>
              <datalist id="hpos-terminal-providers">
                {['FNB', 'Stanbic', 'Absa', 'Standard Chartered', 'Bank Gaborone', 'Yoco', 'DPO', 'Peach Payments'].map((name) => (<option key={name} value={name} />))}
              </datalist>
              <label>Terminal name<input disabled={!canManagePos} value={hardware.payment_terminal_name || ''} onChange={(event) => setHardware({ ...hardware, payment_terminal_name: event.target.value })} placeholder="Front bar terminal" /></label>
              <label>Mode<select disabled={!canManagePos} value={terminalMode} onChange={(event) => setHardware({ ...hardware, payment_terminal_mode: event.target.value })}><option value="manual">Manual — charge on the machine</option><option value="local_bridge">Local device bridge</option><option value="provider_api">Provider API URL</option></select></label>
            </div>
            {terminalMode !== 'manual' && (
              <div className="hpos-form-grid" aria-label="Card terminal bridge">
                <label className="is-wide">Bridge / API URL<input disabled={!canManagePos} value={hardware.payment_terminal_bridge_url || ''} onChange={(event) => setHardware({ ...hardware, payment_terminal_bridge_url: event.target.value })} placeholder="http://127.0.0.1:8787/charge" /></label>
                <label>Timeout (ms)<input disabled={!canManagePos} type="number" min="1500" max="60000" value={hardware.payment_terminal_timeout_ms ?? 8000} onChange={(event) => setHardware({ ...hardware, payment_terminal_timeout_ms: Number(event.target.value) })} /></label>
              </div>
            )}
            <p className="hpos-help-text">{terminalMode === 'manual' ? 'Manual mode (recommended to start): type the amount into the bank machine, take the card as usual, then enter the approval code at the Till (optional). Works with every machine — no extra setup needed.' : terminalBridgeReady ? 'Bridge mode: the Till sends the sale total to the machine and fills the approval code automatically. Save first, then Test (sends a P1 test, never real money).' : 'If your bank installed till-integration software on this PC, choose a bridge mode and paste the address from the bank technician, then Save and Test. Otherwise stay in Manual mode.'}</p>
            <details>
              <summary>Bank technician? See exactly what the Till sends</summary>
              <div className="hpos-form-grid">
                <p className="hpos-help-text">The Till posts this message to the bridge address and waits for an approval answer. Any helper program that accepts it works — show this to the technician wiring the machine.</p>
                <pre className="hpos-code-sample">{`POST bridge address, body:
{
  "type": "sale",
  "provider": "Your bank",
  "terminal": "Front bar terminal",
  "amount": 250.00,
  "currency": "BWP",
  "reference": "POS-…",
  "request_id": "pos-…"
}

Reply expected:
{ "approved": true, "approval_code": "…", "reference": "…" }`}</pre>
              </div>
            </details>
            {canManagePos && <div className="hpos-device-actions"><HposButton tone="primary" onClick={saveHardware} disabled={running}>Save device settings</HposButton><HposButton icon={CreditCard} onClick={() => testHardware('payment-terminal')} disabled={running}>Test card terminal</HposButton></div>}
          </section>
          <section className="hpos-device-panel">
            <div className="hpos-section-heading"><span><Monitor size={18} /></span><div><h2>Customer & preparation displays</h2><p>Pin each screen to a monitor — the pin survives restarts and auto-open uses it.</p></div>{canManagePos && pinnedKinds.some((kind) => hardware[pinFieldForKind(kind)]) && <HposButton icon={Monitor} onClick={reopenPinnedDisplays} disabled={running}>Reopen pinned</HposButton>}</div>
            <div className="hpos-device-toggles">
              <label><input type="checkbox" disabled={!canManagePos} checked={hardware.customer_display_enabled === true} onChange={(event) => setHardware({ ...hardware, customer_display_enabled: event.target.checked })} /><span><strong>Customer display enabled</strong><small>Show the guest their basket and total.</small></span></label>
              <label><input type="checkbox" disabled={!canManagePos} checked={displayFullScreen} onChange={(event) => setDisplayFullScreen(event.target.checked)} /><span><strong>Open full screen</strong><small>Untick to open as a movable window.</small></span></label>
              <label><input type="checkbox" disabled={!canManagePos} checked={hardware.display_customer_auto_open === true} onChange={(event) => setHardware({ ...hardware, display_customer_auto_open: event.target.checked })} /><span><strong>Open customer display on startup</strong><small>Reopens on its pinned screen. Save to keep.</small></span></label>
            </div>
            <div className="hpos-form-grid">
              <label className="is-wide">Welcome message on the guest screen<input disabled={!canManagePos} value={hardware.display_welcome_message || ''} onChange={(event) => setHardware({ ...hardware, display_welcome_message: event.target.value })} placeholder="e.g. Welcome to our bar — tonight: live music from 8pm" maxLength={140} /></label>
            </div>
            <div className="hpos-form-grid" aria-label="Pin screens to monitors">
              {pinnedKinds.map((kind) => {
                const field = pinFieldForKind(kind);
                const pinnedId = String(hardware[field] || '');
                const pinnedMissing = Boolean(pinnedId) && !displayIds.has(pinnedId);
                return (
                  <label key={kind}><span>{pinnedName(kind)} pinned to</span>
                    <select disabled={!canManagePos} value={pinnedId} onChange={(event) => pinDisplay(kind, event.target.value, displays.find((display) => String(display.id) === String(event.target.value))?.label)}>
                      <option value="">Not pinned — remembered screen</option>
                      {displays.map((display) => (
                        <option key={`${kind}-${display.id}`} value={display.id}>{display.label || `Display ${display.id}`}{display.isPrimary ? ' (Till screen)' : ' (guest screen candidate)'}</option>
                      ))}
                    </select>
                    {pinnedMissing && <small>Pinned screen not detected. Check the HDMI cable is pushed in at both ends and the screen is switched on — or pin another monitor.</small>}
                  </label>
                );
              })}
            </div>
            {displays.length === 0 ? <HposEmptyState icon={Monitor} title="No displays detected" description="Connect a monitor, then press Refresh above. With one screen the display opens as a window you can drag." /> : (
              <>
                <p className="hpos-help-text">{displays.length === 1 ? 'One screen detected: the customer display opens as a window on this screen. Connect a second monitor for a dedicated guest screen.' : `${displays.length} screens detected: pin the customer display to the guest-facing monitor and keep selling on the Till screen.`}</p>
                <div className="hpos-display-list">
                  {displays.map((display) => {
                    const pinnedFor = pinnedKinds.filter((kind) => String(hardware[pinFieldForKind(kind)] || '') === String(display.id));
                    return (
                      <article key={display.id}>
                        <div><strong>{display.label || `Display ${display.id}`}{pinnedFor.length > 0 ? ` · pinned: ${pinnedFor.map(pinnedName).join(', ')}` : ''}</strong><span>{display.isPrimary ? 'Primary · ' : ''}{display.bounds?.width || '—'} × {display.bounds?.height || '—'}</span></div>
                        <div><HposButton onClick={() => openDisplay('customer', display.id, displayFullScreen)}>Customer</HposButton>{!barOnly && <HposButton onClick={() => openDisplay('kitchen', display.id, displayFullScreen)}>Kitchen</HposButton>}<HposButton onClick={() => openDisplay('bar', display.id, displayFullScreen)}>Bar</HposButton></div>
                      </article>
                    );
                  })}
                </div>
              </>
            )}
            {canManagePos && <div className="hpos-device-actions"><HposButton tone="primary" onClick={saveHardware} disabled={running}>Save device settings</HposButton></div>}
          </section>
        </div>
      )}

      {activeTab === 'checks' && (
        <div className="hpos-device-layout">
          <section className="hpos-device-panel" aria-label="Open the bar checklist">
            <div className="hpos-section-heading"><span><ClipboardCheck size={18} /></span><div><h2>Open the bar</h2><p>Morning routine for this computer · {openDone} of {openChecklist.length} done.</p></div></div>
            <div className="hpos-device-toggles">
              {openChecklist.map(([key, label]) => (
                <label key={key}><input type="checkbox" checked={dailyChecks.open?.[key] === true} onChange={() => toggleDailyCheck('open', key)} /><span><strong>{label}</strong></span></label>
              ))}
            </div>
            {openDone === openChecklist.length && <p className="hpos-help-text">Bar is open — enjoy the rush. Run the morning check above if anything looks off.</p>}
          </section>
          <section className="hpos-device-panel" aria-label="Close the bar checklist">
            <div className="hpos-section-heading"><span><ClipboardCheck size={18} /></span><div><h2>Close the bar</h2><p>Evening routine for this computer · {closeDone} of {closeChecklist.length} done.</p></div></div>
            <div className="hpos-device-toggles">
              {closeChecklist.map(([key, label]) => (
                <label key={key}><input type="checkbox" checked={dailyChecks.close?.[key] === true} onChange={() => toggleDailyCheck('close', key)} /><span><strong>{label}</strong></span></label>
              ))}
            </div>
            <div className="hpos-form-grid" aria-label="Card compare">
              <label><span>Card machine total (from the machine end-of-day)</span><input inputMode="decimal" value={dailyChecks.cardMachineTotal || ''} onChange={(event) => setDailyCardTotals('cardMachineTotal', event.target.value)} placeholder="0.00" /></label>
              <label><span>Till card total (from Sales report)</span><input inputMode="decimal" value={dailyChecks.tillCardTotal || ''} onChange={(event) => setDailyCardTotals('tillCardTotal', event.target.value)} placeholder="0.00" /></label>
            </div>
            {cardCompareReady && (
              <p className="hpos-help-text">{cardCompareDiff === 0 ? 'Card totals agree — tick the compare box above.' : `Out by ${cardCompareDiff > 0 ? '+' : ''}${cardCompareDiff}. Find the missing slip before cash-up — do not tick compare until they agree.`}</p>
            )}
            {!cardCompareReady && <p className="hpos-help-text">Type both card totals to compare. These boxes are your own notes on this computer — the books stay server-side.</p>}
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
