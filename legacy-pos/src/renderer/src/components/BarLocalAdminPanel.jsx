import { useEffect, useState } from 'react';
import { barLocalNetworkRows } from './barLocalAdminResponse.js';

function getMessage(cause) {
  return cause && typeof cause.message === 'string' ? cause.message : 'The local Bar operation could not be completed.';
}

function bridge() {
  return window.api.barLocal || window.api.pos.barLocal;
}

function displayValue(value) {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  return String(value);
}

function Panel({ title, children, error }) {
  return (
    <section className="rounded-xl border border-slate-700 bg-slate-900 p-4">
      <h3 className="font-semibold">{title}</h3>
      {error && <p role="alert" className="mt-2 rounded border border-red-800 bg-red-950/50 p-2 text-xs text-red-100">{error}</p>}
      {children}
    </section>
  );
}

export default function BarLocalAdminPanel({ busy, pending, localReady, canManageBackup = false, canExport = false, refreshKey = 0, onCommand }) {
  const [status, setStatus] = useState(null);
  const [backups, setBackups] = useState(null);
  const [replication, setReplication] = useState(null);
  const [update, setUpdate] = useState(null);
  const [exportStatus, setExportStatus] = useState(null);
  const [loyaltyPrograms, setLoyaltyPrograms] = useState([]);
  const [loyaltyOutletId, setLoyaltyOutletId] = useState('');
  const [loyaltyProgramId, setLoyaltyProgramId] = useState('');
  const [loyaltyName, setLoyaltyName] = useState('');
  const [loyaltyEarnRate, setLoyaltyEarnRate] = useState('1');
  const [loyaltyRedeemValue, setLoyaltyRedeemValue] = useState('0');
  const [loyaltyMinimum, setLoyaltyMinimum] = useState('0');
  const [loyaltyActive, setLoyaltyActive] = useState(true);
  const [errors, setErrors] = useState({});
  const [loading, setLoading] = useState(false);
  const [actionBusy, setActionBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [backupLabel, setBackupLabel] = useState('');
  const [verifyName, setVerifyName] = useState('');
  const [drillFileName, setDrillFileName] = useState('');
  const [drillAuthorizedBy, setDrillAuthorizedBy] = useState('');
  const [drillReason, setDrillReason] = useState('');
  const [drillConfirm, setDrillConfirm] = useState('');
  const [drillResult, setDrillResult] = useState(null);
  const [durability, setDurability] = useState('single_host');
  const [switchReason, setSwitchReason] = useState('');
  const [switchConfirm, setSwitchConfirm] = useState('');
  const [switchAcknowledged, setSwitchAcknowledged] = useState(false);
  const [exportBatchId, setExportBatchId] = useState('');
  const [cloudSync, setCloudSync] = useState(null);
  const [cloudEnabled, setCloudEnabled] = useState(false);
  const [cloudReceiverUrl, setCloudReceiverUrl] = useState('');
  const [cloudScheduleMode, setCloudScheduleMode] = useState('fifteen_minutes');
  const [cloudDailyAt, setCloudDailyAt] = useState('23:30');
  const [cloudBatchLimit, setCloudBatchLimit] = useState('200');
  const [cloudSigningKeyId, setCloudSigningKeyId] = useState('');

  const blocked = busy || Boolean(pending) || !localReady;

  const load = async () => {
    setLoading(true);
    setErrors({});
    const api = bridge();
    const results = await Promise.allSettled([
      api.adminStatus(),
      canManageBackup ? api.adminBackups() : Promise.resolve(null),
      api.adminReplicationStatus(),
      api.adminUpdateStatus(),
      canExport ? api.query('outbox.status', {}) : Promise.resolve(null),
      api.query('loyalty.programs.list', {}),
      api.adminCloudSyncStatus()
    ]);
    const nextErrors = {};
    const [statusResult, backupsResult, replicationResult, updateResult, exportStatusResult, loyaltyResult, cloudResult] = results;
    if (statusResult.status === 'fulfilled') setStatus(statusResult.value.status);
    else nextErrors.status = getMessage(statusResult.reason);
    if (!canManageBackup) setBackups(null);
    else if (backupsResult.status === 'fulfilled') setBackups(backupsResult.value);
    else nextErrors.backups = getMessage(backupsResult.reason);
    if (replicationResult.status === 'fulfilled') setReplication(replicationResult.value);
    else nextErrors.replication = getMessage(replicationResult.reason);
    if (updateResult.status === 'fulfilled') setUpdate(updateResult.value);
    else nextErrors.update = getMessage(updateResult.reason);
    if (!canExport) setExportStatus(null);
    else if (exportStatusResult.status === 'fulfilled') setExportStatus(exportStatusResult.value?.data || null);
    else { setExportStatus(null); nextErrors.exportStatus = getMessage(exportStatusResult.reason); }
    const programs = loyaltyResult.status === 'fulfilled' ? loyaltyResult.value?.data : null;
    setLoyaltyPrograms(Array.isArray(programs) ? programs : []);
    setLoyaltyOutletId(String(loyaltyResult.status === 'fulfilled' ? loyaltyResult.value?.scope?.outlet_id || '' : ''));
    if (loyaltyResult.status === 'rejected') nextErrors.loyalty = getMessage(loyaltyResult.reason);
    else if (!Array.isArray(programs)) nextErrors.loyalty = 'The local authority returned an invalid programme list. Refresh before changing loyalty settings.';
    if (Array.isArray(programs)) {
      const selected = programs.find((program) => program.outlet_id) || programs[0];
      if (selected) {
        setLoyaltyProgramId(String(selected.program_id || ''));
        setLoyaltyName(String(selected.name || ''));
        setLoyaltyEarnRate(String(selected.earn_rate ?? '0'));
        setLoyaltyRedeemValue(String(selected.redeem_value ?? '0'));
        setLoyaltyMinimum(String(selected.min_redeem_points ?? '0'));
        setLoyaltyActive(selected.active !== false);
      }
    }
    if (cloudResult.status === 'fulfilled') {
      const cloud = cloudResult.value?.status;
      if (!cloud || typeof cloud !== 'object' || Array.isArray(cloud)) {
        setCloudSync(null);
        nextErrors.cloudSync = 'The local authority returned an unverified cloud synchronisation status.';
      } else {
        setCloudSync(cloud);
        setCloudEnabled(cloud.enabled === true);
        setCloudScheduleMode(cloud.schedule_mode === 'daily' ? 'daily' : 'fifteen_minutes');
        setCloudDailyAt(typeof cloud.daily_at === 'string' && /^\d{2}:\d{2}$/.test(cloud.daily_at) ? cloud.daily_at : '23:30');
        const limit = Number(cloud.batch_limit);
        setCloudBatchLimit(Number.isSafeInteger(limit) && limit > 0 ? String(limit) : '200');
        // Receiver URL and signing key are only entered when changing them;
        // the committed values stay on the Bar server and are shown in the
        // status block, never pushed back into renderer form state.
        setCloudReceiverUrl('');
        setCloudSigningKeyId('');
      }
    } else {
      setCloudSync(null);
      nextErrors.cloudSync = getMessage(cloudResult.reason);
    }
    setErrors(nextErrors);
    setLoading(false);
  };

  useEffect(() => {
    void load();
  }, [canExport, canManageBackup, refreshKey]);

  const run = async (name, action, successMessage, failureGuidance) => {
    if (blocked || actionBusy) return;
    setActionBusy(name);
    setError('');
    setNotice('');
    try {
      await action();
      setNotice(successMessage);
      await load();
    } catch (cause) {
      setError(`${getMessage(cause)}${failureGuidance ? ` ${failureGuidance}` : ''}`);
    } finally {
      setActionBusy('');
    }
  };

  const runBackup = (event) => {
    event.preventDefault();
    const request = backupLabel.trim() ? { label: backupLabel.trim() } : {};
    if (backupLabel.trim().length > 120) {
      setError('Backup label must be 120 characters or fewer.');
      return;
    }
    void run('backup', () => bridge().adminRunBackup(request),
      'Encrypted backup completed. Verify its package integrity before relying on it.',
      'Refresh the backup list before retrying; the authority may already have created a package.');
  };

  const verifyBackup = (event) => {
    event.preventDefault();
    if (!verifyName.trim()) {
      setError('Select or enter a backup package file name.');
      return;
    }
    void run('verify', () => bridge().adminVerifyBackup({ file_name: verifyName.trim() }),
      'Backup integrity verified. A restore test on an isolated target is still required.',
      'The verification result may be unknown. Refresh the backup list before retrying.');
  };

  const runRestoreDrill = (event) => {
    event.preventDefault();
    const fileName = drillFileName.trim();
    const authorizedBy = drillAuthorizedBy.trim();
    const reason = drillReason.trim();
    if (!fileName) {
      setError('Choose a listed backup package before running a restore drill.');
      return;
    }
    if (authorizedBy.length < 3) {
      setError('Enter the name of the owner or manager authorising this restore drill.');
      return;
    }
    if (reason.length < 8) {
      setError('Describe why this restore drill is being run (at least 8 characters).');
      return;
    }
    if (drillConfirm !== 'RESTORE_DRILL') {
      setError('Type RESTORE_DRILL exactly to confirm the drill.');
      return;
    }
    setDrillResult(null);
    void run('restore-drill', async () => {
      const result = await bridge().adminRestoreDrill({
        confirm: 'RESTORE_DRILL',
        file_name: fileName,
        authorized_by: authorizedBy,
        reason
      });
      setDrillResult(result);
    },
      'Restore drill passed in an isolated same-PC cluster. The live database, the package and the backup folder were not replaced.',
      'Keep the package and correct the reported cause before repeating the drill. The live database was not rolled back.');
  };

  const applyDurability = (event) => {
    event.preventDefault();
    void run('durability', () => bridge().adminSetDurability({ profile: durability }),
      'Durability profile applied and verified by the local authority.',
      'Refresh replication status before retrying; the database setting may already have changed.');
  };

  const switchOver = (event) => {
    event.preventDefault();
    if (switchConfirm !== 'SWITCHOVER' || !switchAcknowledged || switchReason.trim().length < 3) {
      setError('Type SWITCHOVER, confirm all tills are stopped, and enter a reason.');
      return;
    }
    void run('switchover', () => bridge().adminSwitchover({ confirm: 'SWITCHOVER', reason: switchReason.trim() }),
      'Switchover completed. Stop using the previous authority and repoint every till only through the documented recovery procedure.',
      'Do not repeat the switchover. Keep all tills stopped and verify replication status before any manual recovery.');
  };

  const saveCloudSyncConfig = (event) => {
    event.preventDefault();
    const limit = Number(cloudBatchLimit);
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000) {
      setError('The upload batch limit must be a whole number between 1 and 1000.');
      return;
    }
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(cloudDailyAt)) {
      setError('The daily upload time must use 24-hour HH:MM, for example 23:30.');
      return;
    }
    const payload = {
      enabled: cloudEnabled,
      schedule_mode: cloudScheduleMode,
      daily_at: cloudDailyAt,
      batch_limit: limit
    };
    if (cloudReceiverUrl.trim()) payload.receiver_url = cloudReceiverUrl.trim();
    if (cloudSigningKeyId.trim()) payload.signing_key_id = cloudSigningKeyId.trim();
    void run('cloud-config', () => bridge().adminCloudSyncConfig(payload),
      'Cloud synchronisation settings were saved by the local authority. Enabling upload does not acknowledge any batch until a receiver reports ingested.',
      'Refresh cloud synchronisation status before retrying; the configuration may already have been saved.');
  };

  const syncCloudNow = async () => {
    if (blocked || actionBusy) return;
    setActionBusy('cloud-run'); setError(''); setNotice('');
    try {
      const result = await bridge().adminCloudSyncRun({});
      const uploaded = Number(result?.uploaded_batches || 0);
      if (result?.status === 'ok') {
        setNotice(`Upload pass finished: ${uploaded} batch(es) confirmed ingested by the receiver. Pending work remains until a receiver acknowledgement arrives.`);
      } else if (result?.status === 'busy') {
        setNotice('An upload pass is already running. Check cloud synchronisation status again shortly.');
      } else {
        setError(`The upload pass did not complete (${String(result?.status || 'unknown')})${result?.last_error_message ? `: ${String(result.last_error_message)}` : ''}. Local trade is unaffected and pending work stays on this Bar server.`);
      }
      await load();
    } catch (cause) {
      setError(`${getMessage(cause)} Local trade is unaffected; this is not a cloud acknowledgement, and pending work remains on this Bar server.`);
    } finally { setActionBusy(''); }
  };

  const chooseLoyaltyProgram = (id) => {
    setLoyaltyProgramId(id);
    if (id === '' || id === 'new-outlet') {
      setLoyaltyName('');
      setLoyaltyEarnRate('1');
      setLoyaltyRedeemValue('0');
      setLoyaltyMinimum('0');
      setLoyaltyActive(true);
      return;
    }
    const selected = loyaltyPrograms.find((program) => program.program_id === id);
    setLoyaltyName(String(selected?.name || ''));
    setLoyaltyEarnRate(String(selected?.earn_rate ?? '0'));
    setLoyaltyRedeemValue(String(selected?.redeem_value ?? '0'));
    setLoyaltyMinimum(String(selected?.min_redeem_points ?? '0'));
    setLoyaltyActive(selected?.active !== false);
  };

  const saveLoyaltyProgram = (event) => {
    event.preventDefault();
    const name = loyaltyName.trim();
    const earnRate = Number(loyaltyEarnRate);
    const redeemValue = Number(loyaltyRedeemValue);
    const minimum = Number(loyaltyMinimum);
    if (!name || name.length > 120 || !Number.isFinite(earnRate) || earnRate < 0
      || !Number.isFinite(redeemValue) || redeemValue < 0 || !Number.isSafeInteger(minimum) || minimum < 0) {
      setError('Enter a programme name and non-negative rates; the minimum points must be a whole number.');
      return;
    }
    const selected = loyaltyPrograms.find((program) => program.program_id === loyaltyProgramId);
    const payload = { name, earn_rate: earnRate, redeem_value: redeemValue, min_redeem_points: minimum, active: loyaltyActive };
    if (loyaltyProgramId === 'new-outlet') payload.outlet_id = loyaltyOutletId;
    if (selected) {
      payload.program_id = selected.program_id;
      payload.expected_version = selected.version;
    }
    void run('loyalty', () => onCommand('loyalty.program.upsert', payload),
      'Loyalty programme settings were saved by the local authority. Refresh customer accounts before quoting a points balance.',
      'If another manager changed the programme, refresh it and apply the change again.');
  };

  const saveExportBundle = async (batchId = exportBatchId, allowBusy = false) => {
    if ((blocked && !allowBusy) || (actionBusy && !allowBusy) || !canExport || !batchId) return;
    setActionBusy('export-save'); setError(''); setNotice('');
    try {
      const response = await bridge().query('outbox.bundle.get', { batch_id: batchId });
      const bundle = response?.data;
      if (response?.complete !== true || !bundle || typeof bundle !== 'object' || Array.isArray(bundle)
        || (Array.isArray(response.unavailable) && response.unavailable.length > 0)
        || bundle.batch_id !== batchId || bundle.schema !== 'bar-local-export-bundle'
        || bundle.signature !== null || bundle.signature_key_id !== null
        || (bundle.signature_algorithm !== undefined && bundle.signature_algorithm !== null)
        || bundle.signature_status !== 'unavailable'
        || bundle.transport_status !== 'integration_disabled' || bundle.status !== 'integration_disabled'
        || !Array.isArray(bundle.events) || bundle.event_count !== bundle.events.length
        || !Number.isSafeInteger(bundle.checkpoint) || !Number.isSafeInteger(bundle.event_count)) {
        throw new Error('The local authority did not return a complete, unsigned bundle for this batch. Keep the batch ID and refresh the authority status before retrying.');
      }
      const file = new Blob([`${JSON.stringify(bundle, null, 2)}\n`], { type: 'application/json' });
      const objectUrl = URL.createObjectURL(file);
      const link = document.createElement('a');
      link.href = objectUrl;
      link.download = `bar-export-${batchId}.json`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
      setNotice(`Download requested for unsigned local export ${batchId}. Confirm the file appears in Downloads; it has not been uploaded or acknowledged.`);
    } catch (cause) {
      setError(`${getMessage(cause)} The batch ID is retained so you can retry retrieving this same export without creating another checkpoint.`);
    } finally { setActionBusy(''); }
  };

  const createAndSaveExport = async () => {
    const statusHealthy = !errors.exportStatus && Boolean(exportStatus) && Array.isArray(exportStatus.batches)
      && exportStatus.batches.every((batch) => batch.integrity_valid === true);
    if (blocked || actionBusy || !canExport || !statusHealthy || typeof onCommand !== 'function') return;
    setActionBusy('export-create'); setError(''); setNotice('');
    try {
      const result = await onCommand('export.bundle.create', { limit: 200 });
      const batchId = result?.outcome === 'committed_local' && result.result?.batch_id;
      if (typeof batchId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(batchId)) {
        setError('The export command did not return a confirmed batch ID. Resolve any pending operation using its original operation ID before creating another export.');
        return;
      }
      setExportBatchId(batchId);
      await saveExportBundle(batchId, true);
    } finally { setActionBusy(''); }
  };

  const statusBody = status || {};
  const backupBody = backups || {};
  const replicationBody = replication?.replication || null;
  const replicationConfig = replication?.config || null;
  const updateBody = update || {};
  const networkRows = barLocalNetworkRows(statusBody);
  const hasGlobalLoyaltyProgram = loyaltyPrograms.some((program) => !program.outlet_id);
  const hasOutletLoyaltyProgram = loyaltyPrograms.some((program) => Boolean(program.outlet_id));
  const cloudAvailable = cloudSync?.available === true;
  const cloudTransport = cloudSync?.transport;
  const cloudTransportNote = cloudTransport === 'local_test'
    ? 'Cloud upload is limited to a loopback test receiver on this machine. No hosted or internet receiver is used, and this is not a Supabase connection.'
    : cloudTransport === 'approved'
      ? 'Cloud upload is configured for an approved receiver. Only the receiver’s own ingested acknowledgement counts as accepted.'
      : 'Cloud upload is disabled in this Bar server configuration. Local trade and cash-up remain authoritative and nothing is sent to a receiver.';

  return (
    <section className="mt-5 space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-amber-800 bg-amber-950/30 p-4">
        <div>
          <h2 className="font-semibold">Local authority administration</h2>
          <p className="mt-1 max-w-3xl text-xs text-amber-100">These actions inspect and manage the paired Bar authority. Backup creation needs the backup capability and replication control needs settings management. Switchover is local-machine only, is never automatic, and requires manual till repointing.</p>
        </div>
        <button type="button" disabled={loading || blocked || Boolean(actionBusy)} onClick={() => void load()} className="rounded border border-slate-500 px-3 py-2 text-xs disabled:opacity-40">{loading ? 'Loading…' : 'Refresh administration'}</button>
      </div>

      {error && <p role="alert" className="rounded border border-red-700 bg-red-950/50 p-3 text-sm text-red-100">{error}</p>}
      {notice && <p role="status" className="rounded border border-emerald-700 bg-emerald-950/40 p-3 text-sm text-emerald-100">{notice}</p>}
      {!localReady && <p role="status" className="rounded border border-amber-700 bg-amber-950/40 p-3 text-sm text-amber-100">Authenticated readiness is not current. Administration actions are paused until the local service reports ready.</p>}

      <Panel title="Loyalty programme">
        <p className="mt-2 text-xs text-slate-400">Programme changes use the local authority’s version-checked command. Existing customer points are ledger-backed and are not changed by editing these rates.</p>
        {errors.loyalty && <p role="alert" className="mt-2 rounded border border-amber-700 bg-amber-950/40 p-2 text-xs text-amber-100">Programme settings are unavailable: {errors.loyalty}</p>}
        <label className="mt-3 block text-xs">Programme scope
          <select value={loyaltyProgramId} onChange={(event) => chooseLoyaltyProgram(event.target.value)} className="mt-1 w-full rounded bg-slate-800 p-2 text-sm">
            <option value="" disabled={hasGlobalLoyaltyProgram}>New business-wide programme{hasGlobalLoyaltyProgram ? ' (already configured)' : ''}</option>
            <option value="new-outlet" disabled={!loyaltyOutletId || hasOutletLoyaltyProgram}>New programme for this outlet{hasOutletLoyaltyProgram ? ' (already configured)' : ''}</option>
            {loyaltyPrograms.map((program) => <option key={program.program_id} value={program.program_id}>{program.name} · {program.outlet_id ? 'This outlet' : 'All outlets'} · v{program.version}</option>)}
          </select>
        </label>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <label className="text-xs">Name<input maxLength={120} value={loyaltyName} onChange={(event) => setLoyaltyName(event.target.value)} className="mt-1 w-full rounded bg-slate-800 p-2 text-sm" /></label>
          <label className="text-xs">Points earned per currency unit<input inputMode="decimal" value={loyaltyEarnRate} onChange={(event) => setLoyaltyEarnRate(event.target.value)} className="mt-1 w-full rounded bg-slate-800 p-2 text-sm" /></label>
          <label className="text-xs">Redemption value per point<input inputMode="decimal" value={loyaltyRedeemValue} onChange={(event) => setLoyaltyRedeemValue(event.target.value)} className="mt-1 w-full rounded bg-slate-800 p-2 text-sm" /></label>
          <label className="text-xs">Minimum points to redeem<input inputMode="numeric" value={loyaltyMinimum} onChange={(event) => setLoyaltyMinimum(event.target.value)} className="mt-1 w-full rounded bg-slate-800 p-2 text-sm" /></label>
        </div>
        <label className="mt-3 flex items-center gap-2 text-xs"><input type="checkbox" checked={loyaltyActive} onChange={(event) => setLoyaltyActive(event.target.checked)} />Programme is active</label>
        <p className="mt-2 text-xs text-amber-200">New business-wide programmes affect all outlets; new outlet programmes affect only this outlet. Existing programmes can be selected for edits. Concurrent edits are refused and must be refreshed.</p>
        <button type="button" disabled={blocked || Boolean(actionBusy) || Boolean(errors.loyalty) || typeof onCommand !== 'function' || (loyaltyProgramId === '' && hasGlobalLoyaltyProgram) || (loyaltyProgramId === 'new-outlet' && (!loyaltyOutletId || hasOutletLoyaltyProgram))} onClick={saveLoyaltyProgram} className="mt-3 rounded bg-sky-600 px-4 py-2 text-sm font-semibold disabled:opacity-50">{actionBusy === 'loyalty' ? 'Saving…' : 'Save programme'}</button>
      </Panel>

      <div className="grid gap-4 lg:grid-cols-2">
        {canExport && <Panel title="Local export bundle">
          <p className="mt-2 text-xs text-slate-400">Create a checkpoint and request a download of its complete event bundle as JSON. The file is unsigned and stays on this device. Saving a file is not an upload or an acknowledgement; only a cloud receiver’s own ingested acknowledgement counts as accepted. Highest sequences show the highest observed event numbers; gaps and pending work may remain before them.</p>
          {errors.exportStatus && <p role="alert" className="mt-2 rounded border border-amber-700 bg-amber-950/40 p-2 text-xs text-amber-100">Export status is unavailable: {errors.exportStatus} Refresh before relying on backlog or checkpoint totals.</p>}
          {exportStatus && <div className="mt-3 grid gap-2 text-xs sm:grid-cols-2"><p className="rounded border border-slate-700 bg-slate-950/60 p-2">Pending events: {displayValue(exportStatus.pending_events)}</p><p className="rounded border border-slate-700 bg-slate-950/60 p-2">Exported, unacknowledged: {displayValue(exportStatus.exported_unacknowledged)}</p><p className="rounded border border-slate-700 bg-slate-950/60 p-2">Highest exported sequence: {displayValue(exportStatus.exported_watermark)}</p><p className="rounded border border-slate-700 bg-slate-950/60 p-2">Highest acknowledged sequence: {displayValue(exportStatus.acknowledged_watermark)}</p></div>}
          {Array.isArray(exportStatus?.batches) && exportStatus.batches.length > 0 && <div className="mt-3 space-y-2"><p className="text-xs text-slate-400">Recent batches (up to 50)</p>{exportStatus.batches.map((batch) => <div key={String(batch.batch_id)} className="flex flex-wrap items-center justify-between gap-2 rounded border border-slate-700 bg-slate-950/60 p-2 text-xs"><span className="min-w-0 break-all font-mono">{String(batch.batch_id)}</span><span className={batch.integrity_valid === true ? 'text-emerald-300' : 'text-rose-300'}>{batch.integrity_valid === true ? 'Integrity checked' : 'Integrity failed'} · {batch.acknowledged_at ? 'Acknowledged' : 'Not acknowledged'}</span><button type="button" disabled={blocked || Boolean(actionBusy) || batch.integrity_valid !== true} onClick={() => { setExportBatchId(String(batch.batch_id)); void saveExportBundle(String(batch.batch_id)); }} className="rounded border border-slate-600 px-2 py-1 disabled:opacity-40">Download</button></div>)}</div>}
          {Array.isArray(exportStatus?.batches) && exportStatus.batches.some((batch) => batch.integrity_valid !== true) && <p role="alert" className="mt-2 rounded border border-red-800 bg-red-950/50 p-2 text-xs text-red-100">An export batch failed integrity reconciliation. New exports are paused; keep the batch ID and contact your local Bar administrator before continuing.</p>}
          {exportStatus?.batches_truncated === true && <p role="status" className="mt-2 rounded border border-slate-700 bg-slate-950/60 p-2 text-xs text-slate-300">Only the 50 most recent batches are listed here. Totals and highest sequences cover the full current scope.</p>}
          <button type="button" disabled={blocked || Boolean(actionBusy) || Boolean(errors.exportStatus) || !exportStatus || !Array.isArray(exportStatus.batches) || !exportStatus.batches.every((batch) => batch.integrity_valid === true) || typeof onCommand !== 'function'} onClick={() => void createAndSaveExport()} className="mt-3 rounded bg-sky-600 px-3 py-2 text-sm font-semibold disabled:opacity-40">{actionBusy === 'export-create' ? 'Creating…' : 'Create and save export'}</button>
          {exportBatchId && <div className="mt-3 rounded border border-slate-700 bg-slate-950/60 p-3"><p className="text-xs text-slate-400">Last confirmed batch ID</p><p className="mt-1 break-all font-mono text-xs">{exportBatchId}</p><button type="button" disabled={blocked || Boolean(actionBusy)} onClick={() => void saveExportBundle()} className="mt-2 rounded border border-slate-600 px-3 py-1 text-xs disabled:opacity-40">Save this batch again</button></div>}
          <p className="mt-2 text-xs text-amber-200">Saving the file does not mark it as uploaded or acknowledged. Retain the batch ID if file saving is interrupted.</p>
        </Panel>}
        <Panel title="Authority status" error={errors.status}>
          {!status ? <p className="mt-2 text-sm text-slate-300">{errors.status ? 'Status is unavailable.' : 'Loading status…'}</p> : <div className="mt-3 space-y-2 text-sm">
            <p>Service version {displayValue(statusBody.service?.version)} · uptime {displayValue(statusBody.service?.uptime_seconds)}s</p>
            <p>Database {displayValue(statusBody.database?.database)} · reachable {displayValue(statusBody.database?.reachable)} · port {displayValue(statusBody.database?.port)}</p>
            <p>Devices {displayValue(statusBody.devices?.active)} active / {displayValue(statusBody.devices?.count)} total</p>
            <p>Replication role {displayValue(statusBody.replication?.role)} · caught-up standbys {displayValue(statusBody.replication?.caught_up_standbys)}</p>
            <p>Backup configured {displayValue(statusBody.backup?.configured)} · key configured {displayValue(statusBody.backup?.key_configured)} · schedule installed {displayValue(statusBody.backup?.schedule_installed)}</p>
            {statusBody.backup?.copy_destination_status && statusBody.backup.copy_destination_status !== 'not_configured' && <p>Secondary copy {displayValue(statusBody.backup.copy_destination_status)} · {displayValue(statusBody.backup.copy_destination)}. A second folder on the same physical drive is not an independent backup.</p>}
            <p>Schema {displayValue(statusBody.update?.schema_migration)} · contract {displayValue(statusBody.update?.contract_version)}</p>
            <div aria-label="Local Bar network diagnostics" className="rounded border border-slate-700 bg-slate-950/60 p-2 text-xs text-slate-300">
              <p className="font-semibold">Network diagnostics</p>
              <dl className="mt-1 grid gap-x-3 gap-y-1 sm:grid-cols-[auto_1fr]">{networkRows.map(([label, value]) => <div key={label} className="contents"><dt>{label}</dt><dd className="break-words">{value}</dd></div>)}</dl>
              <p className="mt-2 text-amber-200">Reachability does not prove authenticated trading readiness. Automatic failover is not authorized by this status screen.</p>
            </div>
          </div>}
        </Panel>

        <Panel title="Backup packages" error={errors.backups}>
          {!canManageBackup ? <p className="mt-2 text-sm text-amber-100">Your role can inspect authority status but does not hold the backup.manage capability. Ask the Bar owner or an administrator with backup authority to create and verify backup packages.</p> : <>
          <form onSubmit={runBackup} className="mt-3 flex flex-wrap items-end gap-2">
            <label className="min-w-[14rem] flex-1 text-xs">Optional label<input maxLength={120} value={backupLabel} onChange={(event) => setBackupLabel(event.target.value)} className="mt-1 w-full rounded bg-slate-800 p-2 text-sm" /></label>
            <button type="submit" disabled={blocked || Boolean(actionBusy)} className="rounded bg-amber-500 px-3 py-2 text-sm font-semibold text-slate-950 disabled:opacity-40">{actionBusy === 'backup' ? 'Creating…' : 'Create encrypted backup'}</button>
          </form>
          <p className="mt-2 text-xs text-slate-400">Configured {displayValue(backupBody.configured)} · destination {displayValue(backupBody.destination)} · retention {displayValue(backupBody.retention)} day(s).</p>
          {statusBody.backup?.destination_status === 'unavailable' && <p role="alert" className="mt-2 rounded border border-amber-700 bg-amber-950/40 p-2 text-xs text-amber-100">The backup destination is unavailable{statusBody.backup?.destination_error ? ` (${String(statusBody.backup.destination_error)})` : ''}. The package list may be incomplete. Check the configured backup folder and service permissions, then refresh before creating or relying on a backup.</p>}
          {statusBody.backup?.copy_destination_status === 'unavailable' && <p role="alert" className="mt-2 rounded border border-amber-700 bg-amber-950/40 p-2 text-xs text-amber-100">The configured secondary backup copy cannot be read. Reconnect the destination and confirm the Bar service account can write there before relying on it.</p>}
          <div className="mt-3 rounded border border-slate-700 bg-slate-950/60 p-2 text-xs">
            <p className="font-semibold">Scheduled backups · {displayValue(statusBody.backup?.schedule?.health)}</p>
            <p className="mt-1 text-slate-300">{displayValue(statusBody.backup?.schedule?.schedule_message)}</p>
            <p className="mt-1 text-slate-300">Last scheduled run {displayValue(statusBody.backup?.schedule?.last_run_at)} · {displayValue(statusBody.backup?.schedule?.last_run_result)} · latest package age {displayValue(statusBody.backup?.schedule?.latest_backup_age_hours)} h (stale after {displayValue(statusBody.backup?.schedule?.stale_after_hours)} h)</p>
            <p role="note" className="mt-2 rounded border border-amber-800 bg-amber-950/40 p-2 text-amber-100">{displayValue(statusBody.backup?.schedule?.warning)}</p>
          </div>
          <div className="mt-3 max-h-64 space-y-2 overflow-y-auto">
            {(Array.isArray(backupBody.packages) ? backupBody.packages : []).map((item) => <div key={String(item.file_name)} className="rounded border border-slate-700 bg-slate-950/60 p-2 text-xs">
              <p className="font-semibold break-all">{String(item.file_name)}</p>
              <p className="mt-1 text-slate-300">{displayValue(item.created_at)} · {displayValue(item.bytes)} bytes · {item.label ? String(item.label) : 'No label'}</p>
              <button type="button" disabled={blocked || Boolean(actionBusy)} onClick={() => setVerifyName(String(item.file_name))} className="mt-2 rounded border border-slate-600 px-2 py-1 disabled:opacity-40">Verify this package</button>
            </div>)}
            {(!Array.isArray(backupBody.packages) || backupBody.packages.length === 0) && <p className="text-sm text-slate-300">{errors.backups || statusBody.backup?.destination_status === 'unavailable' ? 'Backup listing is unavailable; no conclusion can be drawn about packages on disk.' : 'No backup packages are available.'}</p>}
          </div>
          <form onSubmit={verifyBackup} className="mt-3 border-t border-slate-700 pt-3">
            <label className="block text-xs">Backup package file name<input required maxLength={255} value={verifyName} onChange={(event) => setVerifyName(event.target.value)} placeholder="bar-backup.blbkup" className="mt-1 w-full rounded bg-slate-800 p-2 text-sm" /></label>
            <button type="submit" disabled={blocked || Boolean(actionBusy) || !verifyName.trim()} className="mt-2 rounded border border-emerald-600 px-3 py-2 text-sm disabled:opacity-40">{actionBusy === 'verify' ? 'Verifying…' : 'Verify package integrity'}</button>
          </form>
          <form onSubmit={runRestoreDrill} className="mt-3 border-t border-slate-700 pt-3">
            <p className="font-semibold text-sm">Guarded restore drill (same PC)</p>
            <p className="mt-1 text-xs text-slate-400">Restores the selected encrypted package into a disposable bundled PostgreSQL cluster on this PC, checks schema checksums and financial/security invariants, then removes the temporary cluster. The live database, the package and the backup folder are not modified. This is not an off-site restoration or a point-in-time recovery test.</p>
            <label className="mt-2 block text-xs">Backup package
              <select value={drillFileName} onChange={(event) => setDrillFileName(event.target.value)} className="mt-1 w-full rounded bg-slate-800 p-2 text-sm">
                <option value="">Select a listed package</option>
                {(Array.isArray(backupBody.packages) ? backupBody.packages : []).map((item) => <option key={String(item.file_name)} value={String(item.file_name)}>{String(item.file_name)}</option>)}
              </select>
            </label>
            <label className="mt-2 block text-xs">Authorised by<input maxLength={120} value={drillAuthorizedBy} onChange={(event) => setDrillAuthorizedBy(event.target.value)} placeholder="Owner or manager name" className="mt-1 w-full rounded bg-slate-800 p-2 text-sm" /></label>
            <label className="mt-2 block text-xs">Reason for drill<textarea maxLength={500} value={drillReason} onChange={(event) => setDrillReason(event.target.value)} className="mt-1 w-full rounded bg-slate-800 p-2 text-sm" /></label>
            <label className="mt-2 block text-xs">Type RESTORE_DRILL to confirm<input value={drillConfirm} onChange={(event) => setDrillConfirm(event.target.value)} autoComplete="off" className="mt-1 w-full rounded bg-slate-800 p-2 text-sm" /></label>
            <button type="submit" disabled={blocked || Boolean(actionBusy) || drillConfirm !== 'RESTORE_DRILL' || !drillFileName || drillAuthorizedBy.trim().length < 3 || drillReason.trim().length < 8} className="mt-2 rounded border border-sky-600 px-3 py-2 text-sm disabled:opacity-40">{actionBusy === 'restore-drill' ? 'Restoring into a disposable cluster…' : 'Run restore drill'}</button>
            {actionBusy === 'restore-drill' && <p className="mt-2 text-xs text-slate-400">This can take several minutes. Keep the app and this PC powered until it finishes.</p>}
            {drillResult && <div className="mt-2 rounded border border-emerald-800 bg-emerald-950/40 p-2 text-xs">
              <p className="font-semibold text-emerald-200">Restore drill verified</p>
              <p className="mt-1 text-slate-200">{displayValue(drillResult.message)}</p>
              <p className="mt-1 text-slate-300">Checks passed: {displayValue(drillResult.checks?.passed)} of {displayValue(drillResult.checks?.total)} · completed {displayValue(drillResult.completed_at)}</p>
              <p className="mt-1 break-all text-slate-400">Evidence: {displayValue(drillResult.evidence_path)}</p>
              <p className="mt-1 text-slate-400">Temporary cluster stopped: {displayValue(drillResult.cleanup?.cluster_stopped)} · temporary data removed: {displayValue(drillResult.cleanup?.data_removed)}</p>
            </div>}
            <p className="mt-2 text-xs text-slate-400">A failed drill leaves the package and backups untouched. Correct the reported cause, keep the failed package, and repeat the drill before relying on that package for recovery.</p>
          </form>
          </>}
        </Panel>

        <Panel title="Replication and durability" error={errors.replication}>
          {!replication ? <p className="mt-2 text-sm text-slate-300">{errors.replication ? 'Replication status is unavailable.' : 'Loading replication status…'}</p> : <div className="mt-3 space-y-2 text-sm">
            <p>Role {displayValue(replicationBody?.role)} · in recovery {displayValue(replicationBody?.in_recovery)} · LSN {displayValue(replicationBody?.current_lsn)}</p>
            <p>Synchronous commit {displayValue(replicationBody?.synchronous_commit)} · standbys “{displayValue(replicationBody?.synchronous_standby_names)}” · replay lag {displayValue(replicationBody?.replay_lag_bytes)} bytes</p>
            <p>Streaming standbys: {Array.isArray(replicationBody?.streaming_standbys) && replicationBody.streaming_standbys.length > 0 ? replicationBody.streaming_standbys.map((standby) => `${standby.application_name || 'unnamed'} (${standby.state || 'unknown'})`).join(', ') : 'none reported'}</p>
            <p className="rounded border border-amber-700 bg-amber-950/40 p-2 text-xs text-amber-100">Automatic failover: {replicationBody?.automatic_failover?.verified === true ? 'verified' : 'not verified'}. {String(replicationBody?.automatic_failover?.detail || '')}</p>
            {Array.isArray(replicationBody?.limitations) && replicationBody.limitations.length > 0 && <ul className="list-disc space-y-1 pl-5 text-xs text-amber-100">{replicationBody.limitations.map((item) => <li key={String(item)}>{String(item)}</li>)}</ul>}
            <p className="text-xs text-slate-400">Config role {displayValue(replicationConfig?.role)} · coordinator {displayValue(replicationConfig?.coordinator)} · admin DB configured {displayValue(replicationConfig?.admin_database_configured)} · standby admin DB configured {displayValue(replicationConfig?.standby_admin_database_configured)}</p>
            <form onSubmit={applyDurability} className="mt-3 border-t border-slate-700 pt-3">
              <label className="block text-xs">Durability profile<select value={durability} onChange={(event) => setDurability(event.target.value)} className="mt-1 w-full rounded bg-slate-800 p-2 text-sm"><option value="single_host">Single host</option><option value="synchronous_one_standby">Synchronous, one caught-up standby</option></select></label>
              <button type="submit" disabled={blocked || Boolean(actionBusy)} className="mt-2 rounded bg-sky-600 px-3 py-2 text-sm font-semibold disabled:opacity-40">{actionBusy === 'durability' ? 'Applying…' : 'Apply durability profile'}</button>
            </form>
          </div>}
        </Panel>

        <Panel title="Manual switchover">
          <p className="mt-2 text-xs text-amber-100">This fences the current primary and attempts to promote the configured standby. It does not repoint tills automatically. Stop every till first. If promotion fails, keep everything stopped and follow the documented manual recovery procedure.</p>
          <form onSubmit={switchOver} className="mt-3 space-y-2">
            <label className="block text-xs">Reason<input required maxLength={500} value={switchReason} onChange={(event) => setSwitchReason(event.target.value)} className="mt-1 w-full rounded bg-slate-800 p-2 text-sm" /></label>
            <label className="block text-xs">Type SWITCHOVER to confirm<input required autoComplete="off" value={switchConfirm} onChange={(event) => setSwitchConfirm(event.target.value.toUpperCase())} className="mt-1 w-full rounded bg-slate-800 p-2 text-sm" /></label>
            <label className="flex items-start gap-2 text-xs"><input type="checkbox" checked={switchAcknowledged} onChange={(event) => setSwitchAcknowledged(event.target.checked)} className="mt-1" /><span>I confirm every till is stopped and understand that this till will need manual repointing.</span></label>
            <button type="submit" disabled={blocked || Boolean(actionBusy) || switchConfirm !== 'SWITCHOVER' || !switchAcknowledged || switchReason.trim().length < 3} className="rounded bg-rose-700 px-3 py-2 text-sm font-semibold disabled:opacity-40">{actionBusy === 'switchover' ? 'Switching over…' : 'Run manual switchover'}</button>
          </form>
        </Panel>

        <Panel title="Cloud synchronisation" error={errors.cloudSync}>
          <div className="mt-2 flex flex-wrap items-start justify-between gap-2">
            <p className="max-w-2xl text-xs text-slate-400">Local PostgreSQL remains the financial authority. This panel reports the durable outbox upload state. The highest acknowledged sequence can have gaps or pending work before it and does not confirm complete ingestion.</p>
            <button type="button" disabled={blocked || Boolean(actionBusy) || !cloudAvailable || cloudTransport === 'disabled'} onClick={() => void syncCloudNow()} className="rounded bg-sky-600 px-3 py-2 text-sm font-semibold disabled:opacity-40">{actionBusy === 'cloud-run' ? 'Uploading…' : 'Sync now'}</button>
          </div>
          {cloudSync && !cloudAvailable && <p role="status" className="mt-2 rounded border border-slate-700 bg-slate-950/60 p-2 text-xs text-slate-300">The upload worker is not running in this process, so upload state cannot be inspected here.</p>}
          {cloudSync && <p className={`mt-2 rounded border p-2 text-xs ${cloudTransport === 'disabled' ? 'border-slate-700 bg-slate-950/60 text-slate-300' : 'border-sky-800 bg-sky-950/40 text-sky-100'}`}>{cloudTransportNote}</p>}
          {cloudAvailable && cloudSync?.signing_secret_configured !== true && <p role="alert" className="mt-2 rounded border border-amber-700 bg-amber-950/40 p-2 text-xs text-amber-100">This Bar server has no cloud signing secret configured. Upload attempts fail closed and nothing is sent; local trade is unaffected. Your Bar server administrator must provision the secret outside the till.</p>}
          {cloudAvailable && <div className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
            <p className="rounded border border-slate-700 bg-slate-950/60 p-2 text-xs">Configured {displayValue(cloudSync.configured)} · upload enabled {displayValue(cloudSync.enabled)} · signing secret {cloudSync.signing_secret_configured === true ? 'configured' : 'missing'}</p>
            <p className="rounded border border-slate-700 bg-slate-950/60 p-2 text-xs">Schedule {cloudSync.schedule_mode === 'daily' ? `daily at ${displayValue(cloudSync.daily_at)}` : 'every 15 minutes'} · batch limit {displayValue(cloudSync.batch_limit)}</p>
            <p className="rounded border border-slate-700 bg-slate-950/60 p-2 text-xs">Pending events {displayValue(cloudSync.pending_events)} · prepared batches {displayValue(cloudSync.prepared_batches)} · failed batches <span className={Number(cloudSync.failed_batches || 0) > 0 ? 'text-rose-300' : ''}>{displayValue(cloudSync.failed_batches)}</span></p>
            <p className="rounded border border-slate-700 bg-slate-950/60 p-2 text-xs">Highest acknowledged sequence {displayValue(cloudSync.acknowledged_watermark)} · last success {displayValue(cloudSync.last_success_at)}</p>
            <p className="rounded border border-slate-700 bg-slate-950/60 p-2 text-xs">Last checked {displayValue(cloudSync.last_check_at)} · next due {displayValue(cloudSync.next_due_at)}</p>
            <p className="rounded border border-slate-700 bg-slate-950/60 p-2 text-xs">Cash-up final sync {displayValue(cloudSync.last_final_sync_state)} · {displayValue(cloudSync.last_final_sync_at)}</p>
          </div>}
          {cloudAvailable && cloudSync?.last_error_code && <p role="alert" className="mt-2 rounded border border-rose-800 bg-rose-950/50 p-2 text-xs text-rose-100">Last upload failure {String(cloudSync.last_error_code)}: {displayValue(cloudSync.last_error_message)}. Pending work is retained and retries; local trade is unaffected.</p>}
          {cloudAvailable && cloudSync?.latest_batch && <p className="mt-2 rounded border border-slate-700 bg-slate-950/60 p-2 text-xs text-slate-300">Latest batch {displayValue(cloudSync.latest_batch.batch_id)} · {displayValue(cloudSync.latest_batch.status)} · {displayValue(cloudSync.latest_batch.transport_status)} · {displayValue(cloudSync.latest_batch.attempts)} attempt(s) · {cloudSync.latest_batch.acknowledged_at ? `acknowledged ${String(cloudSync.latest_batch.acknowledged_at)}` : 'not acknowledged'}</p>}
          {cloudAvailable && <form onSubmit={saveCloudSyncConfig} className="mt-3 border-t border-slate-700 pt-3">
            <p className="text-xs text-slate-400">Leave the receiver URL and signing key identifier blank to keep the values already committed on the Bar server. Enabling upload requires both to be present; the service still fails closed without its signing secret.</p>
            <label className="mt-2 flex items-center gap-2 text-xs"><input type="checkbox" checked={cloudEnabled} onChange={(event) => setCloudEnabled(event.target.checked)} />Enable cloud upload on the designated Bar server</label>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              <label className="text-xs">New receiver URL<input maxLength={500} value={cloudReceiverUrl} onChange={(event) => setCloudReceiverUrl(event.target.value)} placeholder={typeof cloudSync?.receiver_url === 'string' ? `Current: ${cloudSync.receiver_url}` : 'https://receiver.example/bar-local'} className="mt-1 w-full rounded bg-slate-800 p-2 text-sm" /></label>
              <label className="text-xs">New signing key identifier<input maxLength={120} value={cloudSigningKeyId} onChange={(event) => setCloudSigningKeyId(event.target.value)} placeholder={typeof cloudSync?.signing_key_id === 'string' ? `Current: ${cloudSync.signing_key_id}` : 'e.g. bar-prod-1'} className="mt-1 w-full rounded bg-slate-800 p-2 text-sm" /></label>
              <label className="text-xs">Schedule<select value={cloudScheduleMode} onChange={(event) => setCloudScheduleMode(event.target.value)} className="mt-1 w-full rounded bg-slate-800 p-2 text-sm"><option value="fifteen_minutes">Every 15 minutes</option><option value="daily">Once daily</option></select></label>
              <label className="text-xs">Daily time (HH:MM)<input maxLength={5} value={cloudDailyAt} onChange={(event) => setCloudDailyAt(event.target.value)} className="mt-1 w-full rounded bg-slate-800 p-2 text-sm" /></label>
              <label className="text-xs">Batch limit per pass<input inputMode="numeric" value={cloudBatchLimit} onChange={(event) => setCloudBatchLimit(event.target.value)} className="mt-1 w-full rounded bg-slate-800 p-2 text-sm" /></label>
            </div>
            <button type="submit" disabled={blocked || Boolean(actionBusy)} className="mt-3 rounded bg-sky-600 px-3 py-2 text-sm font-semibold disabled:opacity-40">{actionBusy === 'cloud-config' ? 'Saving…' : 'Save upload settings'}</button>
          </form>}
        </Panel>

        <Panel title="Update status" error={errors.update}>
          {!update ? <p className="mt-2 text-sm text-slate-300">{errors.update ? 'Update status is unavailable.' : 'Loading update status…'}</p> : <div className="mt-3 space-y-2 text-sm">
            <p>Service {displayValue(updateBody.service_version)} · schema {displayValue(updateBody.schema_migration)} · contract {displayValue(updateBody.contract_version)}</p>
            <p>Package availability {updateBody.availability_checked === true ? displayValue(updateBody.update_available) : 'not checked'} · automatic install supported {displayValue(updateBody.automatic_install_supported)}</p>
            <p>Staging directory {displayValue(updateBody.staging_dir)}</p>
            <p className="rounded border border-slate-700 bg-slate-950/60 p-2 text-xs text-slate-300">{String(updateBody.message || 'No update guidance was returned.')}</p>
          </div>}
        </Panel>
      </div>
    </section>
  );
}
