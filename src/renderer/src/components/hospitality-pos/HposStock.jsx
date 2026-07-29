import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Boxes, ClipboardCheck, PackageCheck, Plus, RefreshCw, Search, X } from 'lucide-react'
import { useAccess, useSettings } from '../../app-context'
import { canAccessCapability } from '../../../../shared/accessControl'

const stockNumber = (item) => Number(item.current_stock || 0)
const reorderNumber = (item) => Number(item.reorder_level || 0)
const isLow = (item) => reorderNumber(item) > 0 && stockNumber(item) <= reorderNumber(item)

const formatAgeDate = (value) => {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toLocaleDateString()
}

const ageDescription = (row) => {
  if (!row) return 'Aging unavailable'
  if (row.days_since_receipt == null) return 'No receipt history'
  return `${row.days_since_receipt} day${Number(row.days_since_receipt) === 1 ? '' : 's'} since receipt`
}

export default function HposStock() {
  const access = useAccess()
  const { settings } = useSettings()
  const currency = settings?.currency || 'P'
  const canManage = canAccessCapability(access, 'inventory.manage')
  const [items, setItems] = useState([])
  const [aging, setAging] = useState([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [agingError, setAgingError] = useState('')
  const [saving, setSaving] = useState(false)
  const [showCreate, setShowCreate] = useState(false)
  const [editingItem, setEditingItem] = useState(null)
  const [stockAction, setStockAction] = useState(null)
  const [newItem, setNewItem] = useState({ name: '', category: 'Beer', opening_stock: '', unit: 'bottle', reorder_level: '', unit_cost: '' })
  const [actionForm, setActionForm] = useState({ quantity: '', reason: '' })

  const loadItems = async () => {
    setLoading(true)
    setError('')
    setAgingError('')
    const [itemsResult, agingResult] = await Promise.allSettled([
      window.api?.inventory?.getItems?.() ?? [],
      window.api?.inventory?.getBarStockAging?.() ?? []
    ])
    if (itemsResult.status === 'fulfilled') setItems(Array.isArray(itemsResult.value) ? itemsResult.value : [])
    else setError(itemsResult.reason?.message || 'Stock could not be refreshed.')
    if (agingResult.status === 'fulfilled') setAging(Array.isArray(agingResult.value) ? agingResult.value : [])
    else setAgingError(agingResult.reason?.message || 'Stock aging could not be refreshed.')
    setLoading(false)
  }

  useEffect(() => { loadItems() }, [])

  const filtered = useMemo(() => items.filter((item) =>
    String(item.name || '').toLowerCase().includes(search.trim().toLowerCase())), [items, search])
  const lowStock = filtered.filter(isLow)
  const healthyStock = filtered.filter((item) => !isLow(item))
  const agingByItem = useMemo(() => new Map(aging.map((row) => [row.item_id, row])), [aging])

  const openCreate = () => {
    setError('')
    setEditingItem(null)
    setNewItem({ name: '', category: 'Beer', opening_stock: '', unit: 'bottle', reorder_level: '', unit_cost: '' })
    setShowCreate(true)
  }

  const openEdit = (item) => {
    setError('')
    setEditingItem(item)
    setNewItem({
      name: item.name || '',
      category: item.category || 'Other',
      opening_stock: '',
      unit: item.unit || 'each',
      reorder_level: String(item.reorder_level ?? ''),
      unit_cost: item.unit_cost == null ? '' : String(item.unit_cost),
    })
    setShowCreate(true)
  }

  const saveItem = async () => {
    if (!newItem.name.trim()) { setError('Enter the stock item name.'); return }
    setSaving(true); setError(''); setNotice('')
    try {
      const result = editingItem
        ? await window.api.inventory.updateItem(editingItem.id, {
            name: newItem.name.trim(),
            category: newItem.category.trim() || null,
            unit: newItem.unit.trim() || 'each',
            reorder_level: Number(newItem.reorder_level || 0),
            unit_cost: newItem.unit_cost === '' ? 0 : Number(newItem.unit_cost),
            outlet_id: editingItem.outlet_id || null,
          })
        : await window.api.inventory.createItem({
            name: newItem.name.trim(),
            category: newItem.category.trim() || null,
            current_stock: Number(newItem.opening_stock || 0),
            unit: newItem.unit.trim() || 'each',
            reorder_level: Number(newItem.reorder_level || 0),
            unit_cost: newItem.unit_cost === '' ? null : Number(newItem.unit_cost),
          })
      if (!result?.success) throw new Error(result?.error || 'Could not create this stock item.')
      setNewItem({ name: '', category: 'Beer', opening_stock: '', unit: 'bottle', reorder_level: '', unit_cost: '' })
      setEditingItem(null)
      setShowCreate(false)
      setNotice(editingItem ? 'Stock item details updated.' : 'Stock item created. You can now link it to a sellable product.')
      await loadItems()
    } catch (saveError) { setError(saveError?.message || (editingItem ? 'Could not update this stock item.' : 'Could not create this stock item.')) }
    finally { setSaving(false) }
  }

  const recordStockAction = async () => {
    if (!stockAction?.item) return
    const entered = Number(actionForm.quantity)
    if (!Number.isFinite(entered) || entered < 0) { setError('Enter a valid quantity of zero or more.'); return }
    if (!actionForm.reason.trim()) { setError('Enter the delivery reference or count reason.'); return }
    const delta = stockAction.mode === 'count' ? entered - stockNumber(stockAction.item) : entered
    if (delta === 0) {
      setNotice(`Count confirmed for ${stockAction.item.name}; stock was already correct.`)
      setStockAction(null); setActionForm({ quantity: '', reason: '' }); return
    }
    setSaving(true); setError(''); setNotice('')
    try {
      const result = await window.api.inventory.adjustStock(
        stockAction.item.id,
        delta,
        `${stockAction.mode === 'count' ? 'Physical count' : 'Simple delivery'}: ${actionForm.reason.trim()}`,
        null,
        crypto.randomUUID(),
      )
      if (!result?.success) throw new Error(result?.error || 'Could not record this stock change.')
      setNotice(stockAction.mode === 'count' ? `Physical count recorded for ${stockAction.item.name}.` : `Delivery received for ${stockAction.item.name}.`)
      setStockAction(null); setActionForm({ quantity: '', reason: '' })
      await loadItems()
    } catch (saveError) { setError(saveError?.message || 'Could not record this stock change.') }
    finally { setSaving(false) }
  }

  return (
    <div style={{ maxWidth: 1180, margin: '0 auto', padding: '4px 0 28px' }}>
      <section style={{
        position: 'relative', overflow: 'hidden', borderRadius: 20, padding: '24px', color: '#fff',
        background: 'linear-gradient(135deg, #28202a 0%, #45303a 52%, #753e32 100%)',
        boxShadow: '0 18px 38px rgba(43, 27, 35, .24)'
      }}>
        <div style={{ position: 'absolute', width: 220, height: 220, borderRadius: '50%', background: 'rgba(255,255,255,.07)', right: -68, top: -112 }} />
        <div style={{ position: 'relative', display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'start', gap: 18 }}>
          <div>
            <p style={{ margin: 0, color: 'rgba(255,255,255,.66)', fontSize: 11, fontWeight: 800, letterSpacing: '.12em', textTransform: 'uppercase' }}>Service stock view</p>
            <h2 style={{ margin: '7px 0 5px', fontSize: 25, letterSpacing: '-.03em' }}>Know what is safe to sell</h2>
            <p style={{ margin: 0, maxWidth: 550, color: 'rgba(255,255,255,.78)', fontSize: 13, lineHeight: 1.5 }}>Create the bottles, kegs, mixers, snacks and prepared portions you count. Receive simple deliveries and record physical counts without opening a restaurant inventory workspace.</p>
          </div>
          <div style={{ display: 'flex', gap: 9 }}>
            <button type="button" onClick={loadItems} disabled={loading} aria-label="Refresh stock" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '10px 12px', borderRadius: 10, border: '1px solid rgba(255,255,255,.25)', color: '#fff', background: 'rgba(255,255,255,.1)', fontSize: 12, fontWeight: 800, cursor: loading ? 'wait' : 'pointer', opacity: loading ? .7 : 1 }}><RefreshCw className={loading ? 'is-spinning' : ''} size={14} /> {loading ? 'Refreshing…' : 'Refresh'}</button>
            {canManage && <button type="button" onClick={openCreate} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '10px 13px', borderRadius: 10, border: 0, color: '#33232b', background: '#f8d7a5', fontSize: 12, fontWeight: 800, cursor: 'pointer' }}><Plus size={14} /> Add stock item</button>}
          </div>
        </div>
        <div style={{ position: 'relative', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(145px, 1fr))', gap: 10, marginTop: 22 }}>
          {[
            ['Tracked items', items.length, Boxes, 'All inventory records'],
            ['Need attention', lowStock.length, AlertTriangle, lowStock.length ? 'Below reorder level' : 'Nothing below reorder level'],
            ['Available', healthyStock.length, PackageCheck, 'Not below reorder level']
          ].map(([label, value, Icon, description]) => <div key={label} style={{ padding: '13px 14px', borderRadius: 13, border: '1px solid rgba(255,255,255,.13)', background: 'rgba(16,10,16,.22)' }}><div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', color: 'rgba(255,255,255,.75)', fontSize: 11, fontWeight: 800 }}><span>{label}</span><Icon size={15} /></div><strong style={{ display: 'block', marginTop: 5, fontSize: 24 }}>{value}</strong><small style={{ color: 'rgba(255,255,255,.64)', fontSize: 10 }}>{description}</small></div>)}
        </div>
      </section>

      <section style={{ marginTop: 18, borderRadius: 18, border: '1px solid rgba(72, 45, 56, .13)', background: 'linear-gradient(145deg, #fffdf9, #f8f2ed)', boxShadow: '0 10px 28px rgba(57, 38, 46, .08)', overflow: 'hidden' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', gap: 12, padding: '18px 18px 14px', borderBottom: '1px solid rgba(72,45,56,.1)' }}>
          <div><h3 style={{ margin: 0, color: '#33232b', fontSize: 16 }}>Service stock list</h3><p style={{ margin: '4px 0 0', color: '#806f76', fontSize: 12 }}>Red rows need a manager decision before they affect service.</p></div>
          <label style={{ position: 'relative', minWidth: 240 }}><Search size={15} style={{ position: 'absolute', left: 11, top: 10, color: '#8c7b82' }} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Find stock…" style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px 9px 34px', borderRadius: 10, border: '1px solid rgba(72,45,56,.18)', background: '#fff', color: '#33232b', outline: 'none', fontSize: 12 }} /></label>
        </div>
        {error && <div role="alert" style={{ margin: 16, padding: '10px 12px', borderRadius: 10, color: '#9a3027', background: '#fff1ef', fontSize: 12 }}>{error}</div>}
        {notice && <div role="status" style={{ margin: 16, padding: '10px 12px', borderRadius: 10, color: '#215e47', background: '#e9f6ef', fontSize: 12 }}>{notice}</div>}
        {agingError && <div role="status" style={{ margin: 16, padding: '10px 12px', borderRadius: 10, color: '#79551e', background: '#fff6df', fontSize: 12 }}>Stock age is unavailable until the device reconnects and the server ledger can be read. Current on-hand quantities remain visible.</div>}
        {loading ? <div aria-live="polite" style={{ padding: 52, textAlign: 'center', color: '#806f76', fontSize: 13 }}>Loading stock…</div> : <div style={{ overflowX: 'auto' }}><table aria-label="Service stock list" style={{ width: '100%', minWidth: 900, borderCollapse: 'collapse', fontSize: 13 }}><thead><tr style={{ background: 'rgba(74,44,56,.045)' }}>{['Item', 'Status', 'On hand', 'Reorder point', 'Unit cost', 'Stock age', 'Actions'].map((heading) => <th key={heading} style={{ padding: '11px 18px', textAlign: 'left', color: '#806f76', fontSize: 10, fontWeight: 800, letterSpacing: '.08em', textTransform: 'uppercase' }}>{heading}</th>)}</tr></thead><tbody>{filtered.map((item) => {
          const attention = isLow(item)
          const age = agingByItem.get(item.id)
          const receiptDate = formatAgeDate(age?.last_received_at)
          const soldDate = formatAgeDate(age?.last_sold_at)
          return <tr key={item.id} style={{ background: attention ? 'rgba(194, 70, 55, .055)' : 'transparent', borderTop: '1px solid rgba(72,45,56,.08)' }}><td style={{ padding: '13px 18px', color: '#33232b', fontWeight: 800 }}>{item.name}<small style={{ display: 'block', marginTop: 2, color: '#917f87', fontWeight: 500 }}>{item.category || 'Uncategorised'}</small></td><td style={{ padding: '13px 18px' }}><span style={{ display: 'inline-block', padding: '4px 8px', borderRadius: 999, fontSize: 10, fontWeight: 800, color: attention ? '#a53a30' : '#28624d', background: attention ? '#fde5e1' : '#e4f4ea' }}>{attention ? 'Needs attention' : 'Available'}</span></td><td style={{ padding: '13px 18px', color: attention ? '#a53a30' : '#2e6450', fontWeight: 800 }}>{stockNumber(item)} {item.unit || 'each'}</td><td style={{ padding: '13px 18px', color: '#695961' }}>{reorderNumber(item) || '—'}</td><td style={{ padding: '13px 18px', color: '#695961' }}>{item.unit_cost != null ? `${currency}${Number(item.unit_cost).toFixed(2)}` : '—'}</td><td style={{ padding: '13px 18px', color: '#695961' }}><strong style={{ display: 'block', color: age?.age_bucket?.startsWith('Critical') ? '#a53a30' : '#5b4851', fontSize: 11 }}>{age?.age_bucket || 'Unavailable'}</strong><small style={{ display: 'block', marginTop: 2 }}>{ageDescription(age)}{receiptDate ? ` · ${receiptDate}` : ''}</small><small style={{ display: 'block', marginTop: 2, color: '#917f87' }}>{soldDate ? `Last sold ${soldDate}` : 'No recorded sale'}</small></td><td style={{ padding: '13px 18px' }}>{canManage ? <div style={{ display: 'flex', gap: 6 }}><button type="button" onClick={() => openEdit(item)} style={{ border: '1px solid #d7c4ba', background: '#fff', borderRadius: 8, padding: '6px 8px', fontWeight: 800, fontSize: 11 }}>Edit</button><button type="button" onClick={() => { setActionForm({ quantity: '', reason: '' }); setStockAction({ mode: 'receive', item }) }} style={{ border: '1px solid #d7c4ba', background: '#fff', borderRadius: 8, padding: '6px 8px', fontWeight: 800, fontSize: 11 }}>Receive</button><button type="button" onClick={() => { setActionForm({ quantity: String(stockNumber(item)), reason: '' }); setStockAction({ mode: 'count', item }) }} style={{ border: 0, background: '#3d2b34', color: '#fff', borderRadius: 8, padding: '6px 8px', fontWeight: 800, fontSize: 11 }}><ClipboardCheck size={12} style={{ display: 'inline', marginRight: 4 }}/>Count</button></div> : '—'}</td></tr>
        })}{!filtered.length && <tr><td colSpan="7" style={{ padding: 44, textAlign: 'center', color: '#806f76' }}>{items.length ? 'No stock items match that search.' : 'No stock items yet. Add the first bottle, keg, snack or prepared portion.'}</td></tr>}</tbody></table></div>}
      </section>

      {showCreate && <div className="hpos-modal-backdrop" role="presentation"><section className="hpos-service-dialog" role="dialog" aria-modal="true" aria-labelledby="bar-stock-create-title"><button className="hpos-service-dialog__close" type="button" onClick={() => { setShowCreate(false); setEditingItem(null) }} disabled={saving} aria-label="Close"><X size={18}/></button><p className="hpos-eyebrow">Base bar stock</p><h2 id="bar-stock-create-title">{editingItem ? 'Edit stock item' : 'Add a counted stock item'}</h2><p>{editingItem ? 'Update the name, category, counted unit, reorder point or cost basis. Use Receive or Count to change on-hand stock.' : 'Use one record for the exact unit you count, such as a 330ml bottle, one keg, one snack packet, or one prepared food portion.'}</p><div className="hpos-service-form hpos-service-form--two"><label className="is-wide">Item name<input autoFocus value={newItem.name} onChange={(e) => setNewItem({ ...newItem, name: e.target.value })} placeholder="Heineken 330ml"/></label><label>Category<input value={newItem.category} onChange={(e) => setNewItem({ ...newItem, category: e.target.value })}/></label><label>Counted unit<select value={newItem.unit} onChange={(e) => setNewItem({ ...newItem, unit: e.target.value })}><option value="bottle">Bottle</option><option value="can">Can</option><option value="keg">Keg</option><option value="packet">Packet</option><option value="portion">Prepared portion</option><option value="each">Each</option></select></label>{!editingItem && <label>Opening quantity<input type="number" min="0" step="0.01" value={newItem.opening_stock} onChange={(e) => setNewItem({ ...newItem, opening_stock: e.target.value })}/></label>}<label>Low-stock level<input type="number" min="0" step="0.01" value={newItem.reorder_level} onChange={(e) => setNewItem({ ...newItem, reorder_level: e.target.value })}/></label><label>Unit cost ({currency})<input type="number" min="0" step="0.01" value={newItem.unit_cost} onChange={(e) => setNewItem({ ...newItem, unit_cost: e.target.value })}/></label></div><footer><button type="button" onClick={() => { setShowCreate(false); setEditingItem(null) }} disabled={saving}>Cancel</button><button type="button" className="hpos-primary-action" onClick={saveItem} disabled={saving}>{saving ? 'Saving…' : editingItem ? 'Save changes' : 'Add stock item'}</button></footer></section></div>}

      {stockAction && <div className="hpos-modal-backdrop" role="presentation"><section className="hpos-service-dialog" role="dialog" aria-modal="true" aria-labelledby="bar-stock-action-title"><button className="hpos-service-dialog__close" type="button" onClick={() => setStockAction(null)} disabled={saving} aria-label="Close"><X size={18}/></button><p className="hpos-eyebrow">Audited stock movement</p><h2 id="bar-stock-action-title">{stockAction.mode === 'count' ? `Count ${stockAction.item.name}` : `Receive ${stockAction.item.name}`}</h2><p>{stockAction.mode === 'count' ? `Enter the physical quantity on hand. The system currently records ${stockNumber(stockAction.item)} ${stockAction.item.unit || 'each'}.` : 'Enter only the quantity physically received in this delivery.'}</p><div className="hpos-service-form"><label>{stockAction.mode === 'count' ? 'Physical quantity on hand' : 'Quantity received'}<input autoFocus type="number" min="0" step="0.01" value={actionForm.quantity} onChange={(e) => setActionForm({ ...actionForm, quantity: e.target.value })}/></label><label>{stockAction.mode === 'count' ? 'Count reason / reference' : 'Delivery reference'}<input value={actionForm.reason} onChange={(e) => setActionForm({ ...actionForm, reason: e.target.value })} placeholder={stockAction.mode === 'count' ? 'Weekly bottle count' : 'Supplier invoice or delivery note'}/></label></div><p style={{ fontSize: 12, color: '#806f76' }}>This records one idempotent, auditable stock movement. It never edits the displayed balance directly.</p><footer><button type="button" onClick={() => setStockAction(null)} disabled={saving}>Cancel</button><button type="button" className="hpos-primary-action" onClick={recordStockAction} disabled={saving}>{saving ? 'Recording…' : stockAction.mode === 'count' ? 'Post count' : 'Receive stock'}</button></footer></section></div>}
    </div>
  )
}
