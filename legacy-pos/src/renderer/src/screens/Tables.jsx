import { useState, useEffect, useCallback } from 'react';
import { Plus, RefreshCw } from 'lucide-react';

export default function Tables({ user, settings, isOnline }) {
  const [tables, setTables] = useState([]);
  const [tabs, setTabs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: '', area: '', seats: '' });
  const [saving, setSaving] = useState(false);

  const loadData = useCallback(async () => {
    try {
      const [t, tb] = await Promise.all([
        window.api.pos.getTables().catch(() => []),
        window.api.pos.getTabs().catch(() => [])
      ]);
      setTables(t || []);
      setTabs(tb || []);
    } catch (e) {
      console.error('Failed to load tables/tabs:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const handleSaveTable = async () => {
    if (!form.name) return;
    setSaving(true);
    try {
      await window.api.pos.saveTable({ ...form, status: 'available' });
      setShowForm(false);
      setForm({ name: '', area: '', seats: '' });
      await loadData();
    } catch (e) {
      alert(e?.message || 'Failed to save table.');
    } finally {
      setSaving(false);
    }
  };

const statusColor = (status) => {
    const s = String(status || 'available').toLowerCase();
    if (s === 'running' || s === 'open') return 'bg-amber-100 text-amber-700 border-amber-300';
    if (s === 'ready') return 'bg-blue-100 text-blue-700 border-blue-300';
    return 'bg-emerald-50 text-emerald-700 border-emerald-200';
};

const tabTotalLabel = (tab) => {
  const snapshot = tab?.financial_snapshot && typeof tab.financial_snapshot === 'object' ? tab.financial_snapshot : null;
  const certified = tab?.financial_complete === true || tab?._financial_complete === true || snapshot?.financial_complete === true;
  const value = Number(tab?.total ?? snapshot?.total);
  return certified && Number.isFinite(value) ? `P ${value.toFixed(2)}` : 'Amount unavailable';
};

  return (
    <div className="p-6">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-bold text-slate-800">Tables & Tabs</h1>
        <div className="flex gap-2">
          <button onClick={loadData} className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm hover:bg-slate-50">
            <RefreshCw className="inline h-4 w-4" />
          </button>
          {isOnline && (
            <button onClick={() => setShowForm(true)} className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700">
              <Plus className="mr-1 inline h-4 w-4" /> Add Table
            </button>
          )}
        </div>
      </div>

      {loading ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {[1,2,3,4,5,6].map((i) => (
            <div key={i} className="h-24 animate-pulse rounded-xl border-2 border-slate-200 bg-white" />
          ))}
        </div>
      ) : (
        <div className="space-y-6">
          <div>
            <h2 className="mb-3 text-sm font-bold text-slate-500 uppercase tracking-wide">Tables</h2>
            {tables.length === 0 ? (
              <p className="text-sm text-slate-400">No tables configured. Add tables to start tracking table service.</p>
            ) : (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                {tables.map((table) => (
                  <div key={table.id} className={`rounded-xl border-2 p-4 ${statusColor(table.status)}`}>
                    <p className="text-lg font-bold">{table.name}</p>
                    {table.area && <p className="text-xs opacity-75">{table.area}</p>}
                    {table.seats && <p className="text-xs opacity-75">{table.seats} seats</p>}
                    <p className="mt-2 text-xs font-semibold uppercase">{table.status || 'available'}</p>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div>
            <h2 className="mb-3 text-sm font-bold text-slate-500 uppercase tracking-wide">Open Tabs</h2>
            {tabs.length === 0 ? (
              <p className="text-sm text-slate-400">No open tabs.</p>
            ) : (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                {tabs.map((tab) => (
                  <div key={tab.id} className="rounded-xl border border-slate-200 bg-white p-4">
                    <p className="font-bold text-slate-800">{tab.name || tab.tab_name || 'Tab'}</p>
                    {tab.waiter_name && <p className="text-xs text-slate-500">Waiter: {tab.waiter_name}</p>}
                    <p className="mt-1 text-sm font-bold text-emerald-700">{tabTotalLabel(tab)}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-sm rounded-2xl bg-white shadow-2xl p-6 space-y-4">
            <h2 className="font-bold text-slate-800">Add Table</h2>
            <input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="Table name/number" className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" />
            <input type="text" value={form.area} onChange={(e) => setForm({ ...form, area: e.target.value })}
              placeholder="Area (e.g. Patio, Main)" className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" />
            <input type="number" value={form.seats} onChange={(e) => setForm({ ...form, seats: e.target.value })}
              placeholder="Number of seats" className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" min="1" />
            <div className="flex gap-3">
              <button onClick={handleSaveTable} disabled={saving || !form.name}
                className="flex-1 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50">
                {saving ? 'Saving...' : 'Save'}
              </button>
              <button onClick={() => setShowForm(false)} className="rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-600">Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
