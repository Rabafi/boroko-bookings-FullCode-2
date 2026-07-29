import { useState, useEffect } from 'react'
import { Plus, X, FlaskConical, CheckCircle2, Clock } from 'lucide-react'
import { useSettings } from '../../app-context'
import { isBarOnlyMode } from '../../../../shared/propertyTypes'

export default function RestaurantPrepBatches() {
  const { settings } = useSettings()
  const barOnly = isBarOnlyMode(settings)
  const [prepItems, setPrepItems] = useState([])
  const [batches, setBatches] = useState([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState('batches')
  const [showItemForm, setShowItemForm] = useState(false)
  const [showBatchForm, setShowBatchForm] = useState(false)
  const [itemForm, setItemForm] = useState({ name: '', producedInventoryItemId: '', defaultYieldQuantity: '1', yieldUnit: 'portion', ingredients: [] })
  const [batchForm, setBatchForm] = useState({ prepItemId: '', batchCode: '', plannedYieldQuantity: '1', actualYieldQuantity: '1', unit: 'portion', notes: '', idempotencyKey: crypto.randomUUID() })
  const [inventoryItems, setInventoryItems] = useState([])
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [saving, setSaving] = useState(false)
  const [postingId, setPostingId] = useState(null)

  useEffect(() => { loadData() }, [])

  async function loadData() {
    try {
      setLoading(true)
      setError('')
      const [pi, b, inv] = await Promise.allSettled([
        window.api.pos.getRestaurantPrepItems(),
        window.api.pos.getRestaurantPrepBatches(),
        window.api.inventory?.getItems ? window.api.inventory.getItems() : Promise.resolve([])
      ])
      setPrepItems(Array.isArray(pi.value) ? pi.value : [])
      setBatches(Array.isArray(b.value) ? b.value : [])
      setInventoryItems(Array.isArray(inv.value) ? inv.value : [])
      if ([pi, b, inv].some(result => result.status === 'rejected')) setError('Some production information could not be loaded.')
    } catch (err) {
      console.error('Failed to load prep data:', err)
      setError(err.message || 'Could not load prep and batch production.')
    } finally {
      setLoading(false)
    }
  }

  async function savePrepItem() {
    if (!itemForm.name.trim()) return
    const validIngredients = itemForm.ingredients.filter(item => item.inventoryItemId && Number(item.quantity) > 0)
    if (!itemForm.producedInventoryItemId || validIngredients.length === 0) {
      setError('Choose the produced stock item and add at least one stock ingredient with a positive quantity.')
      return
    }
    try {
      setSaving(true)
      setError('')
      setNotice('')
      const result = await window.api.pos.saveRestaurantPrepItem({
        name: itemForm.name.trim(),
        produced_inventory_item_id: itemForm.producedInventoryItemId,
        default_yield_quantity: Number(itemForm.defaultYieldQuantity) || 1,
        yield_unit: itemForm.yieldUnit || 'portion',
        ingredients: validIngredients.map(i => ({
          inventory_item_id: i.inventoryItemId,
          quantity: Number(i.quantity) || 0,
          unit: i.unit || null,
          waste_percent: Number(i.wastePercent) || 0
        }))
      })
      if (result?.success === false) throw new Error(result.error || 'Could not save prep item.')
      setShowItemForm(false)
      setItemForm({ name: '', producedInventoryItemId: '', defaultYieldQuantity: '1', yieldUnit: 'portion', ingredients: [] })
      setNotice('Prep item and ingredient specification saved.')
      await loadData()
    } catch (err) {
      console.error('Failed to save prep item:', err)
      setError(err.message || 'Could not save prep item.')
    } finally {
      setSaving(false)
    }
  }

  async function createBatch() {
    if (!batchForm.prepItemId || !batchForm.batchCode.trim()) return
    if (Number(batchForm.plannedYieldQuantity) <= 0 || Number(batchForm.actualYieldQuantity) <= 0) {
      setError('Planned and actual yield must both be greater than zero.')
      return
    }
    try {
      const prepItem = prepItems.find(p => p.id === batchForm.prepItemId)
      if (!prepItem?.produced_inventory_item_id) throw new Error('This prep item is not linked to a produced stock item.')
      setSaving(true)
      setError('')
      setNotice('')
      const result = await window.api.pos.createRestaurantPrepBatch({
        prep_item_id: batchForm.prepItemId,
        batch_code: batchForm.batchCode.trim(),
        produced_inventory_item_id: prepItem.produced_inventory_item_id,
        planned_yield_quantity: Number(batchForm.plannedYieldQuantity),
        actual_yield_quantity: Number(batchForm.actualYieldQuantity),
        unit: batchForm.unit || 'portion',
        notes: batchForm.notes.trim() || null,
        idempotency_key: batchForm.idempotencyKey
      })
      if (result?.success === false) throw new Error(result.error || 'Could not create batch.')
      setShowBatchForm(false)
      setBatchForm({ prepItemId: '', batchCode: '', plannedYieldQuantity: '1', actualYieldQuantity: '1', unit: 'portion', notes: '', idempotencyKey: crypto.randomUUID() })
      setNotice('Draft batch created. Review the actual yield before posting stock movements.')
      await loadData()
    } catch (err) {
      console.error('Failed to create batch:', err)
      setError(err.message || 'Could not create prep batch.')
    } finally {
      setSaving(false)
    }
  }

  async function postBatch(batchId) {
    if (!confirm('Post this batch? This will consume ingredients and increase produced stock.')) return
    try {
      setPostingId(batchId)
      setError('')
      setNotice('')
      const result = await window.api.pos.postRestaurantPrepBatch(batchId)
      if (result?.success === false) throw new Error(result.error || 'Could not post batch.')
      setNotice('Batch posted. Ingredient consumption and produced stock were recorded atomically.')
      await loadData()
    } catch (err) {
      console.error('Failed to post batch:', err)
      setError(err.message || 'Could not post batch.')
    } finally {
      setPostingId(null)
    }
  }

  function addIngredient() {
    setItemForm({ ...itemForm, ingredients: [...itemForm.ingredients, { inventoryItemId: '', quantity: '1', unit: '', wastePercent: '0' }] })
  }

  function updateIngredient(idx, field, value) {
    const updated = [...itemForm.ingredients]
    updated[idx] = { ...updated[idx], [field]: value }
    setItemForm({ ...itemForm, ingredients: updated })
  }

  function removeIngredient(idx) {
    setItemForm({ ...itemForm, ingredients: itemForm.ingredients.filter((_, i) => i !== idx) })
  }

  const statusColor = (s) => {
    switch (s) {
      case 'draft': return 'bg-gray-100 text-gray-600'
      case 'posted': return 'bg-emerald-100 text-emerald-700'
      case 'voided': return 'bg-red-100 text-red-600'
      default: return 'bg-gray-100 text-gray-600'
    }
  }

  return (
    <div className="restaurant-native-page max-w-6xl">
      <div className="restaurant-native-hero">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{barOnly ? 'Bar Prep & Batches' : 'Prep & Batch Production'}</h1>
          <p className="text-sm text-gray-500 mt-1">{barOnly ? 'Record cocktail mixes, garnishes and prepared portions with their actual ingredient use.' : 'Manage prep items, production batches, and ingredient consumption'}</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setShowItemForm(true)} className="bb-btn-outline text-sm flex items-center gap-1.5">
            <Plus size={14} /> New Prep Item
          </button>
          <button onClick={() => setShowBatchForm(true)} className="bb-btn-primary text-sm flex items-center gap-1.5">
            <Plus size={14} /> New Batch
          </button>
        </div>
      </div>

      {error && <div className="mb-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
      {notice && <div className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</div>}

      {/* Tabs */}
      <div className="restaurant-native-segmented mb-6 w-fit">
        {['items', 'batches'].map(t => (
          <button key={t} onClick={() => setTab(t)} className={`px-4 py-1.5 rounded-md text-xs font-medium transition ${tab === t ? 'bg-white text-gray-800 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
            {t === 'items' ? 'Prep Items' : 'Batches'}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="restaurant-native-loading">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#174c3a] border-t-transparent" />
        </div>
      ) : (
        <div className="space-y-4">
          {tab === 'items' ? (
            prepItems.length === 0 ? (
            <div className="restaurant-native-empty">
                <FlaskConical size={32} className="mx-auto mb-3 text-gray-300" />
                <p className="mb-2">No prep items yet</p>
                <button onClick={() => setShowItemForm(true)} className="bb-btn-primary text-sm">Create Prep Item</button>
              </div>
            ) : prepItems.map(item => (
              <div key={item.id} className="bb-card p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-medium">{item.name}</div>
                    <div className="text-xs text-gray-500">
                      Yield: {item.default_yield_quantity} {item.yield_unit}
                    </div>
                  </div>
                  <div className="text-sm text-gray-500">{item.active ? 'Active' : 'Inactive'}</div>
                </div>
              </div>
            ))
          ) : (
            batches.length === 0 ? (
            <div className="restaurant-native-empty">
                <FlaskConical size={32} className="mx-auto mb-3 text-gray-300" />
                <p className="mb-2">No batches yet</p>
                <button onClick={() => setShowBatchForm(true)} className="bb-btn-primary text-sm">Create Batch</button>
              </div>
            ) : batches.map(batch => (
              <div key={batch.id} className="bb-card p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-medium">{batch.batch_code}</span>
                      <span className={`text-xs font-medium px-2 py-0.5 rounded ${statusColor(batch.status)}`}>{batch.status}</span>
                    </div>
                    <div className="text-sm text-gray-500">
                      Planned: {batch.planned_yield_quantity} {batch.unit} | Actual: {batch.actual_yield_quantity} {batch.unit}
                    </div>
                    {batch.notes && <div className="text-xs text-gray-400 mt-1">{batch.notes}</div>}
                    <div className="text-xs text-gray-400 mt-0.5">
                      {batch.created_at ? new Date(batch.created_at).toLocaleString() : ''}
                    </div>
                  </div>
                  <div>
                    {batch.status === 'draft' && (
                      <button onClick={() => postBatch(batch.id)} disabled={postingId === batch.id} className="bb-btn-primary px-4 text-xs">
                        {postingId === batch.id ? 'Posting…' : 'Post Batch'}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* Prep Item Form Modal */}
      {showItemForm && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg p-6 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold">New Prep Item</h2>
              <button onClick={() => setShowItemForm(false)} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="text-xs font-medium text-gray-600">Name *</label>
                <input value={itemForm.name} onChange={e => setItemForm({ ...itemForm, name: e.target.value })} className="bb-input w-full mt-1" placeholder="e.g. Burger Sauce" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-gray-600">Default Yield</label>
                  <input type="number" min="0.01" step="0.01" value={itemForm.defaultYieldQuantity} onChange={e => setItemForm({ ...itemForm, defaultYieldQuantity: e.target.value })} className="bb-input w-full mt-1" />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-600">Yield Unit</label>
                  <select value={itemForm.yieldUnit} onChange={e => setItemForm({ ...itemForm, yieldUnit: e.target.value })} className="bb-input w-full mt-1">{['portion','each','g','kg','ml','l'].map(unit => <option key={unit}>{unit}</option>)}</select>
                </div>
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600">Produced Inventory Item *</label>
                <select value={itemForm.producedInventoryItemId} onChange={e => setItemForm({ ...itemForm, producedInventoryItemId: e.target.value })} className="bb-input w-full mt-1">
                  <option value="">Select item...</option>
                  {inventoryItems.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}
                </select>
              </div>
              <div className="border-t pt-3">
                <div className="flex items-center justify-between mb-2">
                  <label className="text-xs font-medium text-gray-600">Ingredients</label>
                  <button onClick={addIngredient} className="text-xs text-[#174c3a] hover:underline">+ Add</button>
                </div>
                {itemForm.ingredients.map((ing, i) => (
                  <div key={i} className="flex gap-2 mb-2">
                    <select value={ing.inventoryItemId} onChange={e => updateIngredient(i, 'inventoryItemId', e.target.value)} className="bb-input flex-1 text-sm">
                      <option value="">Ingredient...</option>
                      {inventoryItems.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}
                    </select>
                    <input type="number" min="0.01" step="0.01" value={ing.quantity} onChange={e => updateIngredient(i, 'quantity', e.target.value)} className="bb-input w-16 text-sm" placeholder="Qty" />
                    <select value={ing.unit} onChange={e => updateIngredient(i, 'unit', e.target.value)} className="bb-input w-20 text-sm"><option value="">Unit</option>{['each','g','kg','ml','l','portion'].map(unit => <option key={unit}>{unit}</option>)}</select>
                    <input type="number" min="0" max="100" value={ing.wastePercent} onChange={e => updateIngredient(i, 'wastePercent', e.target.value)} className="bb-input w-16 text-sm" placeholder="%" />
                    <button onClick={() => removeIngredient(i)} className="text-red-400 hover:text-red-600"><X size={14} /></button>
                  </div>
                ))}
              </div>
            </div>
            <div className="flex gap-3 mt-6">
              <button onClick={() => setShowItemForm(false)} className="bb-btn-outline flex-1">Cancel</button>
              <button onClick={savePrepItem} disabled={!itemForm.name.trim() || !itemForm.producedInventoryItemId || saving} className="bb-btn-primary flex-1">{saving ? 'Saving…' : 'Save Prep Item'}</button>
            </div>
          </div>
        </div>
      )}

      {/* Batch Form Modal */}
      {showBatchForm && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold">New Batch</h2>
              <button onClick={() => setShowBatchForm(false)} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="text-xs font-medium text-gray-600">Prep Item *</label>
                <select value={batchForm.prepItemId} onChange={e => setBatchForm({ ...batchForm, prepItemId: e.target.value })} className="bb-input w-full mt-1">
                  <option value="">Select prep item...</option>
                  {prepItems.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600">Batch Code *</label>
                <input value={batchForm.batchCode} onChange={e => setBatchForm({ ...batchForm, batchCode: e.target.value })} className="bb-input w-full mt-1" placeholder="e.g. SAUCE-001" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-gray-600">Planned Yield</label>
                  <input type="number" min="0.01" step="0.01" value={batchForm.plannedYieldQuantity} onChange={e => setBatchForm({ ...batchForm, plannedYieldQuantity: e.target.value })} className="bb-input w-full mt-1" />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-600">Actual Yield</label>
                  <input type="number" min="0.01" step="0.01" value={batchForm.actualYieldQuantity} onChange={e => setBatchForm({ ...batchForm, actualYieldQuantity: e.target.value })} className="bb-input w-full mt-1" />
                </div>
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600">Yield Unit</label>
                <select value={batchForm.unit} onChange={e => setBatchForm({ ...batchForm, unit: e.target.value })} className="bb-input w-full mt-1">{['portion','each','g','kg','ml','l'].map(unit => <option key={unit}>{unit}</option>)}</select>
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600">Notes</label>
                <textarea value={batchForm.notes} onChange={e => setBatchForm({ ...batchForm, notes: e.target.value })} className="bb-input w-full mt-1" rows={2} placeholder="Preparation notes..." />
              </div>
            </div>
            <div className="flex gap-3 mt-6">
              <button onClick={() => setShowBatchForm(false)} className="bb-btn-outline flex-1">Cancel</button>
              <button onClick={createBatch} disabled={!batchForm.prepItemId || !batchForm.batchCode.trim() || saving} className="bb-btn-primary flex-1">{saving ? 'Creating…' : 'Create Batch'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
