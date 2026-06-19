import { useState, useEffect, useCallback } from 'react';
import { RefreshCw, Wifi, WifiOff, AlertTriangle, CheckCircle, Clock, ChevronDown, ChevronUp, Package, Download, Power } from 'lucide-react';

export default function Sync({ user, isOnline, setIsOnline }) {
  const [syncStatus, setSyncStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [queueDetail, setQueueDetail] = useState([]);
  const [showDetail, setShowDetail] = useState(false);
  const [inventoryDiag, setInventoryDiag] = useState(null);
  const [showInventoryDiag, setShowInventoryDiag] = useState(false);
  const [updateInfo, setUpdateInfo] = useState(null);
  const [updateBusy, setUpdateBusy] = useState('');
  const [meshStatus, setMeshStatus] = useState(null);
  const [manualMeshIp, setManualMeshIp] = useState('');
  const [meshBusy, setMeshBusy] = useState(false);

  const loadStatus = useCallback(async () => {
    try {
      const status = await window.api.pos.getSyncStatus();
      setSyncStatus(status);
      const detail = await window.api.pos.getSyncQueueDetail();
      setQueueDetail(detail || []);
      const diag = await window.api.pos.getInventoryDiagnostics().catch(() => null);
      setInventoryDiag(diag);
      const updates = await window.api.pos.updates?.getState?.().catch(() => null);
      if (updates) setUpdateInfo(updates);
      const mesh = await window.api.pos.mesh?.getStatus?.().catch(() => null);
      if (mesh) setMeshStatus(mesh);
    } catch (e) {
      console.error('Failed to load sync status:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadStatus(); }, [loadStatus]);

  useEffect(() => {
    const interval = setInterval(loadStatus, 20000);
    return () => clearInterval(interval);
  }, [loadStatus]);

  useEffect(() => {
    const updates = window.api.pos.updates;
    if (!updates) return undefined;
    const applyInfo = (info) => setUpdateInfo((prev) => ({ ...(prev || {}), ...(info || {}) }));
    const cleanups = [
      updates.onAvailable(applyInfo),
      updates.onNotAvailable(applyInfo),
      updates.onProgress(applyInfo),
      updates.onReady(applyInfo),
      updates.onError(applyInfo)
    ];
    return () => cleanups.forEach((cleanup) => cleanup?.());
  }, []);

  const handleToggleOnline = async () => {
    const newOnline = !isOnline;
    if (newOnline) {
      await window.api.pos.goOnline();
    } else {
      await window.api.pos.goOffline();
    }
    setIsOnline(newOnline);
    await loadStatus();
  };

  const handleRetrySync = async () => {
    setSyncing(true);
    try {
      const result = await window.api.pos.syncRetry();
      if (result?.synced > 0) {
        alert(`Synced ${result.synced} item(s).${result?.failed > 0 ? ` ${result.failed} failed.` : ''}`);
      } else if (result?.reason === 'offline') {
        alert('Cannot sync while offline.');
      } else if (result?.skipped) {
        alert('Sync already in progress or offline.');
      } else {
        alert('No pending items to sync.');
      }
    } catch (e) {
      alert(e?.message || 'Sync failed.');
    } finally {
      setSyncing(false);
      await loadStatus();
    }
  };

  const handleCheckUpdates = async () => {
    setUpdateBusy('checking');
    try {
      const result = await window.api.pos.updates.check();
      if (result?.state) setUpdateInfo(result.state);
      else await loadStatus();
    } finally {
      setUpdateBusy('');
    }
  };

  const handleDownloadUpdate = async () => {
    setUpdateBusy('downloading');
    try {
      const result = await window.api.pos.updates.download();
      if (result?.state) setUpdateInfo(result.state);
    } finally {
      setUpdateBusy('');
    }
  };

  const handleInstallUpdate = async () => {
    const result = await window.api.pos.updates.install();
    if (result?.blocked) {
      setUpdateInfo((prev) => ({ ...(prev || {}), safety: result.safety }));
      alert(`Finish these before installing:\n${(result.safety?.blockers || []).join('\n')}`);
    }
  };

  const activeItems = queueDetail.filter((i) => i.status !== 'synced');
  const pendingItems = activeItems.filter((i) => i.status === 'pending');
  const failedItems = activeItems.filter((i) => i.status === 'failed' || i.status === 'manual_review_required');
  const updatePhase = updateInfo?.phase || 'idle';
  const updateSafety = updateInfo?.safety || {};

  return (
    <div className="p-6">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-bold text-slate-800">Sync Status</h1>
        <div className="flex gap-2">
          <button onClick={loadStatus} className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm hover:bg-slate-50">
            <RefreshCw className="inline h-4 w-4" />
          </button>
        </div>
      </div>

      {loading ? (
        <div className="grid gap-6 lg:grid-cols-2">
          <div className="rounded-xl border border-slate-200 bg-white p-6 space-y-4">
            <div className="h-5 w-32 animate-pulse rounded bg-slate-200" />
            {[1,2,3].map((i) => <div key={i} className="h-10 w-full animate-pulse rounded bg-slate-100" />)}
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-6 space-y-4">
            <div className="h-5 w-40 animate-pulse rounded bg-slate-200" />
            {[1,2].map((i) => <div key={i} className="h-10 w-full animate-pulse rounded bg-slate-100" />)}
          </div>
        </div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          <div className="rounded-xl border border-slate-200 bg-white p-6">
            <h2 className="mb-4 font-bold text-slate-800">Connection</h2>
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                {isOnline ? (
                  <Wifi className="h-8 w-8 text-emerald-500" />
                ) : (
                  <WifiOff className="h-8 w-8 text-amber-500" />
                )}
                <div>
                  <p className="font-semibold text-slate-800">{isOnline ? 'Online' : 'Offline'}</p>
                  <p className="text-xs text-slate-500">{isOnline ? 'Connected to Supabase' : 'Working offline - sales will queue'}</p>
                </div>
              </div>
              <button onClick={handleToggleOnline}
                className={`w-full rounded-lg px-4 py-2.5 text-sm font-semibold ${
                  isOnline
                    ? 'bg-amber-50 text-amber-700 border border-amber-200 hover:bg-amber-100'
                    : 'bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100'
                }`}>
                {isOnline ? 'Go Offline' : 'Go Online'}
              </button>
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-6">
            <h2 className="mb-4 font-bold text-slate-800">Queue Status</h2>
            {syncStatus ? (
              <div className="space-y-3">
                <div className="grid grid-cols-3 gap-3 text-center">
                  <div className="rounded-lg bg-amber-50 p-3">
                    <p className="text-2xl font-bold text-amber-700">{syncStatus.pendingCount}</p>
                    <p className="text-[10px] font-semibold text-amber-600 uppercase">Pending</p>
                  </div>
                  <div className="rounded-lg bg-red-50 p-3">
                    <p className="text-2xl font-bold text-red-600">{syncStatus.failedCount}</p>
                    <p className="text-[10px] font-semibold text-red-500 uppercase">Failed</p>
                  </div>
                  <div className="rounded-lg bg-emerald-50 p-3">
                    <p className="text-2xl font-bold text-emerald-700">{syncStatus.syncedCount}</p>
                    <p className="text-[10px] font-semibold text-emerald-600 uppercase">Synced</p>
                  </div>
                </div>
                <p className="text-xs text-slate-500">Total queue items: {syncStatus.totalItems}</p>
                <button onClick={handleRetrySync} disabled={syncing || !isOnline}
                  className="w-full rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50">
                  {syncing ? 'Syncing...' : 'Retry Sync'}
                </button>
                {!isOnline && (
                  <p className="text-xs text-amber-600 text-center">Go online to sync queued items</p>
                )}
              </div>
            ) : (
              <p className="text-sm text-slate-400">No status available</p>
            )}
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-6 lg:col-span-2">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="font-bold text-slate-800">Local Lodge Mesh</h2>
                <p className="mt-1 text-sm text-slate-600">
                  {meshStatus?.running
                    ? `${meshStatus.peerCount || 0} nearby Boroko device${Number(meshStatus.peerCount || 0) === 1 ? '' : 's'} connected`
                    : (meshStatus?.lastError || 'Waiting for local mesh setup')}
                </p>
                {meshStatus?.lastMergeAt && (
                  <p className="mt-1 text-xs text-slate-400">Last local exchange: {new Date(meshStatus.lastMergeAt).toLocaleString()}</p>
                )}
                <p className="mt-1 text-xs text-slate-400">
                  Listening port: {meshStatus?.httpPort || 'starting'} · Remembered devices: {meshStatus?.rememberedPeerCount || 0}
                </p>
              </div>
              <button
                onClick={async () => {
                  setMeshBusy(true);
                  try {
                    const next = await window.api.pos.mesh?.refreshDiscovery?.();
                    if (next) setMeshStatus(next);
                  } finally {
                    setMeshBusy(false);
                  }
                }}
                disabled={!meshStatus?.running || meshBusy}
                className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">
                Search Again
              </button>
            </div>
            <div className="mt-4 flex flex-col gap-2 sm:flex-row">
              <input
                value={manualMeshIp}
                onChange={(event) => setManualMeshIp(event.target.value)}
                placeholder="Other device IP, e.g. 192.168.1.25"
                className="min-w-0 flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm"
              />
              <button
                onClick={async () => {
                  if (!manualMeshIp.trim()) return;
                  setMeshBusy(true);
                  try {
                    const result = await window.api.pos.mesh?.connectManual?.(manualMeshIp.trim());
                    if (result?.success) {
                      setMeshStatus(result.status);
                      setManualMeshIp('');
                    } else {
                      alert(result?.error || 'Could not reach that Boroko device.');
                    }
                  } catch (error) {
                    alert(error?.message || 'Could not reach that Boroko device.');
                  } finally {
                    setMeshBusy(false);
                  }
                }}
                disabled={meshBusy || !manualMeshIp.trim()}
                className="rounded-lg bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50">
                Connect IP
              </button>
              <button
                onClick={async () => {
                  setMeshBusy(true);
                  try {
                    const next = await window.api.pos.mesh?.syncNow?.();
                    if (next) setMeshStatus(next);
                  } finally {
                    setMeshBusy(false);
                  }
                }}
                disabled={!meshStatus?.running || meshBusy}
                className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">
                Exchange Now
              </button>
            </div>
            {Array.isArray(meshStatus?.localInterfaces) && meshStatus.localInterfaces.length > 0 && (
              <p className="mt-3 text-xs text-slate-500">
                Network: {meshStatus.localInterfaces.map((entry) => `${entry.name} ${entry.address}`).join(' · ')}
              </p>
            )}
            <p className="mt-2 text-xs text-slate-500">
              Different Wi-Fi names are okay when the extender uses Bridge/AP mode and Windows Firewall allows Boroko on Private networks.
            </p>
            {Array.isArray(meshStatus?.warnings) && meshStatus.warnings.map((warning) => (
              <div key={warning} className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                {warning}
              </div>
            ))}
          </div>

          {activeItems.length > 0 && (
            <div className="rounded-xl border border-slate-200 bg-white p-6 lg:col-span-2">
              <button onClick={() => setShowDetail(!showDetail)} className="flex items-center gap-2 w-full text-left">
                <h2 className="font-bold text-slate-800">Queue Detail ({activeItems.length} active)</h2>
                {showDetail ? <ChevronUp className="h-4 w-4 text-slate-500" /> : <ChevronDown className="h-4 w-4 text-slate-500" />}
              </button>
              {showDetail && (
                <div className="mt-4 space-y-2 max-h-96 overflow-y-auto">
                  {activeItems.map((item) => (
                    <div key={item.id} className="rounded-lg border border-slate-100 bg-slate-50 px-4 py-2.5 text-xs">
                      <div className="flex items-center gap-3">
                        <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                          item.status === 'manual_review_required' ? 'bg-red-100 text-red-700' :
                          item.status === 'failed' ? 'bg-amber-100 text-amber-700' :
                          'bg-blue-100 text-blue-700'
                        }`}>
                          {item.status === 'manual_review_required' ? 'REVIEW' : item.status}
                        </span>
                        <span className="font-semibold text-slate-700">{item.displayName || item.entityType}</span>
                        <span className="font-mono text-slate-500">{item.functionName}</span>
                        {item.isFinancial && <span className="rounded bg-red-50 px-1.5 py-0.5 text-[10px] font-semibold text-red-600">FINANCIAL</span>}
                        <span className="text-slate-400 ml-auto">{item.attempts} attempt(s)</span>
                      </div>
                      {item.dependsOn && (
                        <div className="mt-1 flex items-center gap-1 text-[10px]">
                          <Clock className="h-3 w-3 text-amber-500" />
                          <span className="text-amber-600">
                            Waiting for dependency
                            {item.dependencyState ? ` (${item.dependencyState})` : ''}
                          </span>
                        </div>
                      )}
                      {item.lastError && <p className="mt-1 text-red-500 truncate">{item.lastError}</p>}
                      {item.status === 'manual_review_required' && item.manualReviewAction && (
                        <p className="mt-1 text-[10px] font-medium text-slate-500">Action: {item.manualReviewAction}</p>
                      )}
                      <p className="text-[10px] text-slate-400 mt-1">{item.createdAt ? new Date(item.createdAt).toLocaleString() : ''}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="rounded-xl border border-slate-200 bg-white p-6 lg:col-span-2">
            <h2 className="mb-4 font-bold text-slate-800">App Updates</h2>
            <div className="grid gap-4 lg:grid-cols-[1fr_auto] lg:items-start">
              <div className="space-y-2 text-sm text-slate-600">
                <p>Current version: <span className="font-mono font-semibold text-slate-800">v{updateInfo?.currentVersion || '...'}</span></p>
                {updateInfo?.version && updateInfo.version !== updateInfo.currentVersion && (
                  <p>Available version: <span className="font-mono font-semibold text-slate-800">v{updateInfo.version}</span></p>
                )}
                <p className={`font-semibold ${
                  updatePhase === 'ready' ? 'text-emerald-700' :
                  updatePhase === 'error' || updatePhase === 'offline' ? 'text-red-600' :
                  updatePhase === 'available' || updatePhase === 'downloading' ? 'text-blue-700' :
                  'text-slate-500'
                }`}>
                  {updatePhase === 'dev' ? 'Update checks are disabled in development builds.' :
                    updatePhase === 'checking' ? 'Checking for updates...' :
                    updatePhase === 'available' ? 'Update available.' :
                    updatePhase === 'downloading' ? `Downloading update${updateInfo?.progress?.percent ? ` (${updateInfo.progress.percent}%)` : '...'}` :
                    updatePhase === 'ready' ? 'Update downloaded and ready to install.' :
                    updatePhase === 'uptodate' ? 'This POS is up to date.' :
                    updatePhase === 'offline' ? 'Internet connection required for updates.' :
                    updatePhase === 'error' ? (updateInfo?.error || 'Update check failed.') :
                    'Ready to check for updates.'}
                </p>
                {updatePhase === 'ready' && updateSafety.blocked && (
                  <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800">
                    Finish before restarting: {(updateSafety.blockers || []).join(', ')}
                  </div>
                )}
                {updateInfo?.releaseNotes && (
                  <details className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2 text-xs">
                    <summary className="cursor-pointer font-semibold text-slate-700">Release notes</summary>
                    <pre className="mt-2 whitespace-pre-wrap font-sans text-slate-600">{updateInfo.releaseNotes}</pre>
                  </details>
                )}
              </div>
              <div className="flex flex-wrap gap-2 lg:justify-end">
                <button onClick={handleCheckUpdates} disabled={!!updateBusy}
                  className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">
                  <RefreshCw className={`mr-1 inline h-4 w-4 ${updateBusy === 'checking' ? 'animate-spin' : ''}`} /> Check
                </button>
                {updatePhase === 'available' && (
                  <button onClick={handleDownloadUpdate} disabled={!!updateBusy}
                    className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50">
                    <Download className="mr-1 inline h-4 w-4" /> Download
                  </button>
                )}
                {updatePhase === 'ready' && (
                  <button onClick={handleInstallUpdate}
                    className="rounded-lg bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-700">
                    <Power className="mr-1 inline h-4 w-4" /> Restart to Install
                  </button>
                )}
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-6 lg:col-span-2">
            <h2 className="mb-4 font-bold text-slate-800">About Offline Mode</h2>
            <div className="space-y-2 text-sm text-slate-600">
              <p className="flex items-start gap-2"><CheckCircle className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" /> Sales made offline are queued locally and will sync when you reconnect.</p>
              <p className="flex items-start gap-2"><CheckCircle className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" /> Each sale uses an idempotency key to prevent duplicates on replay.</p>
              <p className="flex items-start gap-2"><CheckCircle className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" /> Voids, partial returns, shifts, and menu/table/tab changes all work offline and queue for sync.</p>
              <p className="flex items-start gap-2"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" /> Room folio charges require the booking to be cached locally.</p>
              <p className="flex items-start gap-2"><Clock className="mt-0.5 h-4 w-4 shrink-0 text-blue-500" /> Inventory is reserved locally when queued offline. Failed sync may require manual review.</p>
              <p className="flex items-start gap-2"><Clock className="mt-0.5 h-4 w-4 shrink-0 text-blue-500" /> Config changes (menu, tables, modifiers, promotions, floor layout) are cached locally and queue for replay.</p>
            </div>
          </div>

          {inventoryDiag && (
            <div className="rounded-xl border border-slate-200 bg-white p-6 lg:col-span-2">
              <button onClick={() => setShowInventoryDiag(!showInventoryDiag)} className="flex items-center gap-2 w-full text-left">
                <Package className="h-4 w-4 text-slate-500" />
                <h2 className="font-bold text-slate-800">Inventory Diagnostics</h2>
                {showInventoryDiag ? <ChevronUp className="h-4 w-4 text-slate-500" /> : <ChevronDown className="h-4 w-4 text-slate-500" />}
              </button>
              {showInventoryDiag && (
                <div className="mt-4 space-y-2 text-sm">
                  {inventoryDiag.error ? (
                    <p className="text-red-500">{inventoryDiag.error}</p>
                  ) : (
                    <>
                      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                        <div className="rounded-lg bg-slate-50 p-3 text-center">
                          <p className="text-lg font-bold text-slate-800">{inventoryDiag.remote_count ?? '—'}</p>
                          <p className="text-[10px] font-semibold text-slate-500 uppercase">Remote Inventory</p>
                        </div>
                        <div className="rounded-lg bg-slate-50 p-3 text-center">
                          <p className="text-lg font-bold text-slate-800">{inventoryDiag.bar_outlet_count ?? '—'}</p>
                          <p className="text-[10px] font-semibold text-slate-500 uppercase">Bar Outlet</p>
                        </div>
                        <div className="rounded-lg bg-slate-50 p-3 text-center">
                          <p className="text-lg font-bold text-slate-800">{inventoryDiag.cached_count ?? '—'}</p>
                          <p className="text-[10px] font-semibold text-slate-500 uppercase">Cached Locally</p>
                        </div>
                        <div className="rounded-lg bg-slate-50 p-3 text-center">
                          <p className="text-lg font-bold text-slate-800">{inventoryDiag.outlet_filter?.length ?? '—'}</p>
                          <p className="text-[10px] font-semibold text-slate-500 uppercase">Outlet Access</p>
                        </div>
                      </div>
                      {inventoryDiag.remote_count === 0 && inventoryDiag.cached_count > 0 && (
                        <p className="text-xs text-amber-600">Remote returned 0 items. Using cached inventory. Bar stock may need a sync refresh.</p>
                      )}
                      {inventoryDiag.remote_count > 0 && inventoryDiag.bar_outlet_count === 0 && (
                        <p className="text-xs text-amber-600">No Bar outlet inventory found. Check that inventory items have the correct outlet_id.</p>
                      )}
                      {inventoryDiag.bar_outlet_names?.length > 0 && (
                        <p className="text-xs text-slate-500">Bar outlets: {inventoryDiag.bar_outlet_names.join(', ')}</p>
                      )}
                      {Number(inventoryDiag.unlinked_bar_inventory_count || 0) > 0 && (
                        <p className="text-xs text-amber-600">{inventoryDiag.unlinked_bar_inventory_count} Bar inventory item(s) are not linked to POS menu items.</p>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
