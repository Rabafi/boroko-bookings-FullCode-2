import { useState, useEffect, useCallback } from 'react';
import { Plus, Pencil, Trash2, X, Package } from 'lucide-react';

export default function MenuManagement({ user, settings, isOnline }) {
  const [menuItems, setMenuItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingItem, setEditingItem] = useState(null);
  const [form, setForm] = useState({ name: '', category: 'Food', price: '', barcode: '', is_available: true, outlet_id: '' });
  const [outlets, setOutlets] = useState([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [showPackTemplate, setShowPackTemplate] = useState(false);
  const [packTemplate, setPackTemplate] = useState({ inventory_item_id: '', pack_size: '', enabled: false });

  const loadMenu = useCallback(async () => {
    try {
      const [items, outs] = await Promise.all([
        window.api.pos.getMenuItems().catch(() => []),
        window.api.pos.getOutlets().catch(() => [])
      ]);
      setMenuItems(items || []);
      setOutlets(outs || []);
    } catch (e) { console.error('Failed to load menu:', e); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { loadMenu(); }, [loadMenu]);

  const openCreate = () => { setEditingItem(null); setForm({ name: '', category: 'Food', price: '', barcode: '', is_available: true, outlet_id: '' }); setShowForm(true); setError(''); };
  const openEdit = (item) => { setEditingItem(item); setForm({ name: item.name || '', category: item.category || 'Food', price: item.price || '', barcode: item.barcode || '', is_available: item.is_available !== false, outlet_id: item.outlet_id || '' }); setShowForm(true); setError(''); };

  const handleSave = async () => {
    if (!form.name || !form.price) { setError('Name and price are required.'); return; }
    setSaving(true); setError('');
    try {
      if (editingItem) await window.api.pos.updateMenuItem(editingItem.id, form);
      else await window.api.pos.createMenuItem(form);
      setShowForm(false); await loadMenu();
    } catch (e) { setError(e?.message || 'Save failed.'); }
    finally { setSaving(false); }
  };

  const handleDelete = async (id) => {
    if (!confirm('Delete this menu item?')) return;
    try { await window.api.pos.deleteMenuItem(id); await loadMenu(); }
    catch (e) { alert(e?.message || 'Delete failed.'); }
  };

  const handleSavePackTemplate = async () => {
    if (!packTemplate.inventory_item_id || !packTemplate.pack_size) { alert('Select inventory item and pack size.'); return; }
    try {
      await window.api.pos.setBarPackTemplate({ ...packTemplate, pack_size: Number(packTemplate.pack_size) });
      setShowPackTemplate(false);
      alert('Pack template saved.');
    } catch (e) { alert(e?.message || 'Failed to save pack template.'); }
  };

  const categories = [...new Set(menuItems.map((i) => i.category || 'Other'))];

  return (
    <div className="p-6">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-bold text-slate-800">Menu Management</h1>
        <div className="flex gap-2">
          {isOnline && (
            <>
              <button onClick={() => setShowPackTemplate(true)} className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium hover:bg-slate-50">
                <Package className="mr-1 inline h-4 w-4" /> Bar Packs
              </button>
              <button onClick={openCreate} className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700">
                <Plus className="mr-1 inline h-4 w-4" /> Add Item
              </button>
            </>
          )}
        </div>
      </div>

      {!isOnline && <div className="mb-4 rounded-lg bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-700">Menu management requires online connection.</div>}

      {loading ? (
        <div className="flex py-12 justify-center"><div className="h-8 w-8 animate-spin rounded-full border-4 border-emerald-500 border-t-transparent" /></div>
      ) : menuItems.length === 0 ? (
        <p className="py-12 text-center text-sm text-slate-400">No menu items. Add your first item to get started.</p>
      ) : (
        <div className="space-y-4">
          {categories.map((cat) => (
            <div key={cat}>
              <h2 className="mb-2 text-sm font-bold text-slate-500 uppercase tracking-wide">{cat}</h2>
              <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
                <table className="w-full text-sm">
                  <thead className="border-b border-slate-100 bg-slate-50">
                    <tr>
                      <th className="px-4 py-2 text-left text-xs font-semibold text-slate-500">Name</th>
                      <th className="px-4 py-2 text-right text-xs font-semibold text-slate-500">Price</th>
                      <th className="px-4 py-2 text-left text-xs font-semibold text-slate-500">Barcode</th>
                      <th className="px-4 py-2 text-left text-xs font-semibold text-slate-500">Outlet</th>
                      <th className="px-4 py-2 text-center text-xs font-semibold text-slate-500">Status</th>
                      <th className="px-4 py-2 text-right text-xs font-semibold text-slate-500">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {menuItems.filter((i) => (i.category || 'Other') === cat).map((item) => {
                      const outlet = outlets.find((o) => o.id === item.outlet_id);
                      return (
                        <tr key={item.id} className="hover:bg-slate-50">
                          <td className="px-4 py-2.5 font-semibold text-slate-800">{item.name}</td>
                          <td className="px-4 py-2.5 text-right font-bold text-emerald-700">P {Number(item.price || 0).toFixed(2)}</td>
                          <td className="px-4 py-2.5 text-xs text-slate-500 font-mono">{item.barcode || '-'}</td>
                          <td className="px-4 py-2.5 text-xs text-slate-500">{outlet?.name || 'All'}</td>
                          <td className="px-4 py-2.5 text-center">
                            <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ${item.is_available !== false ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>
                              {item.is_available !== false ? 'Available' : 'Unavailable'}
                            </span>
                          </td>
                          <td className="px-4 py-2.5 text-right">
                            <button onClick={() => openEdit(item)} className="mr-2 text-slate-400 hover:text-blue-600"><Pencil className="inline h-4 w-4" /></button>
                            <button onClick={() => handleDelete(item.id)} className="text-slate-400 hover:text-red-600"><Trash2 className="inline h-4 w-4" /></button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      )}

      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-2xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
              <h2 className="font-bold text-slate-800">{editingItem ? 'Edit Item' : 'Add Item'}</h2>
              <button onClick={() => setShowForm(false)} className="text-slate-400 hover:text-slate-600"><X className="h-5 w-5" /></button>
            </div>
            <div className="p-6 space-y-4">
              {error && <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700">{error}</div>}
              <div>
                <label className="text-xs font-medium text-slate-500">Name *</label>
                <input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-slate-500">Category</label>
                  <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm">
                    <option>Food</option><option>Drinks</option><option>Other</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-500">Price (P) *</label>
                  <input type="number" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" min="0" step="0.01" />
                </div>
              </div>
              <div>
                <label className="text-xs font-medium text-slate-500">Barcode</label>
                <input type="text" value={form.barcode} onChange={(e) => setForm({ ...form, barcode: e.target.value })} className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="text-xs font-medium text-slate-500">Outlet</label>
                <select value={form.outlet_id} onChange={(e) => setForm({ ...form, outlet_id: e.target.value })} className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm">
                  <option value="">All outlets</option>
                  {outlets.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                </select>
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={form.is_available} onChange={(e) => setForm({ ...form, is_available: e.target.checked })} className="rounded border-slate-300" />
                Available for sale
              </label>
            </div>
            <div className="flex gap-3 border-t border-slate-100 px-6 py-4">
              <button onClick={handleSave} disabled={saving} className="flex-1 rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50">
                {saving ? 'Saving...' : 'Save'}
              </button>
              <button onClick={() => setShowForm(false)} className="rounded-lg border border-slate-200 px-4 py-2.5 text-sm text-slate-600 hover:bg-slate-50">Cancel</button>
            </div>
          </div>
        </div>
      )}

      {showPackTemplate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-sm rounded-2xl bg-white shadow-2xl p-6 space-y-4">
            <h2 className="font-bold text-slate-800">Bar Pack Template</h2>
            <p className="text-xs text-slate-500">Configure pack sizes for inventory-backed bar items.</p>
            <div>
              <label className="text-xs font-medium text-slate-500">Inventory Item</label>
              <select value={packTemplate.inventory_item_id} onChange={(e) => setPackTemplate({ ...packTemplate, inventory_item_id: e.target.value })}
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm">
                <option value="">Select item...</option>
                {menuItems.filter((i) => i.inventory_item_id).map((i) => (
                  <option key={i.inventory_item_id} value={i.inventory_item_id}>{i.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-slate-500">Pack Size</label>
              <select value={packTemplate.pack_size} onChange={(e) => setPackTemplate({ ...packTemplate, pack_size: e.target.value })}
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm">
                <option value="">Select...</option>
                <option value="6">6 Pack</option>
                <option value="12">12 Pack</option>
                <option value="24">Case (24)</option>
              </select>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={packTemplate.enabled} onChange={(e) => setPackTemplate({ ...packTemplate, enabled: e.target.checked })} className="rounded border-slate-300" />
              Enable pack template
            </label>
            <div className="flex gap-3">
              <button onClick={handleSavePackTemplate} className="flex-1 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700">Save</button>
              <button onClick={() => setShowPackTemplate(false)} className="rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-600">Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
