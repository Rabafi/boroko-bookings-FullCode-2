import { useState, useEffect, useCallback } from 'react';
import { RefreshCw, Wifi, WifiOff, AlertTriangle, CheckCircle, Clock } from 'lucide-react';

export default function Sync({ user, isOnline, setIsOnline }) {
  const [syncStatus, setSyncStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);

  const loadStatus = useCallback(async () => {
    try {
      const status = await window.api.pos.getSyncStatus();
      setSyncStatus(status);
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
        <div className="flex py-12 justify-center">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-emerald-500 border-t-transparent" />
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
            <h2 className="mb-4 font-bold text-slate-800">About Offline Mode</h2>
            <div className="space-y-2 text-sm text-slate-600">
              <p className="flex items-start gap-2"><CheckCircle className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" /> Sales made offline are queued locally and will sync when you reconnect.</p>
              <p className="flex items-start gap-2"><CheckCircle className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" /> Each sale uses an idempotency key to prevent duplicates on replay.</p>
              <p className="flex items-start gap-2"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" /> Room folio charges require the booking to be cached locally. If not cached, the sale will be blocked.</p>
              <p className="flex items-start gap-2"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" /> Voids and cash-ups require online connection in this version.</p>
              <p className="flex items-start gap-2"><Clock className="mt-0.5 h-4 w-4 shrink-0 text-blue-500" /> Inventory is reserved locally when queued offline. If the RPC rejects due to stock changes, the order enters manual review.</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
