import { useState, useEffect, useCallback } from 'react';
import { Plus, Unlock } from 'lucide-react';

const CURRENCY = 'P';
const fmt = (v) => Number(v || 0).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function Shifts({ user, settings, isOnline }) {
  const [shifts, setShifts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showOpen, setShowOpen] = useState(false);
  const [float, setFloat] = useState('');
  const [outlets, setOutlets] = useState([]);
  const [selectedOutletId, setSelectedOutletId] = useState('');
  const [saving, setSaving] = useState(false);
  const currency = settings?.currency || CURRENCY;

  const loadShifts = useCallback(async () => {
    try {
      const data = await window.api.pos.getShifts();
      setShifts(data || []);
    } catch (e) { console.error('Failed to load shifts:', e); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { loadShifts(); }, [loadShifts]);
  useEffect(() => {
    Promise.all([
      window.api.pos.getOutlets().catch(() => []),
      window.api.pos.getUserPosAccess().catch(() => ({ outletFilter: [] }))
    ]).then(([rows, access]) => {
      const allowed = access?.outletFilter;
      const visible = allowed === null
        ? (rows || [])
        : (rows || []).filter((outlet) => Array.isArray(allowed) && allowed.includes(outlet.id));
      setOutlets(visible.filter((outlet) => outlet?.id));
      if (visible.filter((outlet) => outlet?.id).length === 1) {
        setSelectedOutletId(visible.find((outlet) => outlet?.id)?.id || '');
      }
    });
  }, []);

  const openShift = async () => {
    if (!selectedOutletId) {
      alert('Select an outlet first.');
      return;
    }
    setSaving(true);
    try {
      await window.api.pos.openShift({ opening_float: Number(float) || 0, outlet_id: selectedOutletId });
      setFloat(''); setShowOpen(false);
      await loadShifts();
    } catch (e) { alert(e?.message || 'Failed to open shift.'); }
    finally { setSaving(false); }
  };

  const openShifts = shifts.filter((s) => s.status === 'open');
  const closedShifts = shifts.filter((s) => s.status === 'closed');

  return (
    <div className="p-6">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-bold text-slate-800">Shifts</h1>
        <button onClick={() => setShowOpen(true)} className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700">
          <Plus className="mr-1 inline h-4 w-4" /> Open Shift
        </button>
      </div>

      {loading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[1,2,3].map((i) => (
            <div key={i} className="h-32 animate-pulse rounded-xl border-2 border-slate-200 bg-white" />
          ))}
        </div>
      ) : (
        <div className="space-y-6">
          {openShifts.length > 0 && (
            <div>
              <h2 className="mb-3 text-sm font-bold text-slate-500 uppercase tracking-wide">Open Shifts</h2>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {openShifts.map((shift) => (
                  <div key={shift.id} className="rounded-xl border-2 border-emerald-300 bg-emerald-50 p-5">
                    <div className="flex items-center gap-2 mb-3">
                      <Unlock className="h-5 w-5 text-emerald-600" />
                      <span className="text-sm font-bold text-emerald-800">{shift.cashier_name || 'Unknown'}</span>
                    </div>
                    <div className="space-y-1 text-sm">
                      <div className="flex justify-between"><span className="text-slate-500">Opened</span><span>{shift.opened_at ? new Date(shift.opened_at).toLocaleString('en-GB') : '-'}</span></div>
                      <div className="flex justify-between"><span className="text-slate-500">Outlet</span><span>{outlets.find((outlet) => outlet.id === shift.outlet_id)?.name || 'Unknown'}</span></div>
                      <div className="flex justify-between"><span className="text-slate-500">Float</span><span className="font-semibold">{currency} {fmt(shift.opening_float)}</span></div>
                    </div>
                    <p className="mt-4 rounded-lg bg-white/80 px-3 py-2 text-xs font-semibold text-slate-600">
                      Complete Cash-Up to reconcile and close this shift.
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div>
            <h2 className="mb-3 text-sm font-bold text-slate-500 uppercase tracking-wide">Shift History</h2>
            {closedShifts.length === 0 ? (
              <p className="text-sm text-slate-400">No closed shifts yet.</p>
            ) : (
              <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
                <table className="w-full text-sm">
                  <thead className="border-b border-slate-200 bg-slate-50">
                    <tr>
                      <th className="px-4 py-2 text-left text-xs font-semibold text-slate-500">Cashier</th>
                      <th className="px-4 py-2 text-left text-xs font-semibold text-slate-500">Opened</th>
                      <th className="px-4 py-2 text-left text-xs font-semibold text-slate-500">Closed</th>
                      <th className="px-4 py-2 text-right text-xs font-semibold text-slate-500">Float</th>
                      <th className="px-4 py-2 text-right text-xs font-semibold text-slate-500">Closing Cash</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {closedShifts.map((s) => (
                      <tr key={s.id} className="hover:bg-slate-50">
                        <td className="px-4 py-2.5 font-semibold text-slate-800">{s.cashier_name || '-'}</td>
                        <td className="px-4 py-2.5 text-xs text-slate-500">{s.opened_at ? new Date(s.opened_at).toLocaleString('en-GB') : '-'}</td>
                        <td className="px-4 py-2.5 text-xs text-slate-500">{s.closed_at ? new Date(s.closed_at).toLocaleString('en-GB') : '-'}</td>
                        <td className="px-4 py-2.5 text-right font-bold">{currency} {fmt(s.opening_float)}</td>
                        <td className="px-4 py-2.5 text-right font-bold">{currency} {fmt(s.closing_cash)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {showOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-sm rounded-2xl bg-white shadow-2xl p-6 space-y-4">
            <h2 className="font-bold text-slate-800">Open Shift</h2>
            <div>
              <label className="text-xs font-medium text-slate-500">Outlet</label>
              <select
                value={selectedOutletId}
                onChange={(event) => setSelectedOutletId(event.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
              >
                <option value="">Select outlet</option>
                {outlets.map((outlet) => <option key={outlet.id} value={outlet.id}>{outlet.name}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-slate-500">Opening Float ({currency})</label>
              <input type="number" value={float} onChange={(e) => setFloat(e.target.value)} placeholder="0.00" className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" min="0" />
            </div>
            <div className="flex gap-3">
              <button onClick={openShift} disabled={saving} className="flex-1 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50">
                {saving ? 'Opening...' : 'Open Shift'}
              </button>
              <button onClick={() => setShowOpen(false)} className="rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-600">Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
