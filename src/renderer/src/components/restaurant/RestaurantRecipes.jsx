import { useState, useEffect } from 'react'
import { Plus, Pencil, Trash2, X } from 'lucide-react'

export default function RestaurantRecipes() {
  const [recipes, setRecipes] = useState([])
  const [menuItems, setMenuItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editingRecipe, setEditingRecipe] = useState(null)
  const [form, setForm] = useState({ name: '', menu_item_id: '', serving_size: '', ingredients: [] })

  useEffect(() => { loadData() }, [])

  async function loadData() {
    try {
      setLoading(true)
      const [r, m] = await Promise.all([
        window.api.pos.getRecipes(),
        window.api.pos.getMenuItems()
      ])
      setRecipes(Array.isArray(r) ? r : [])
      setMenuItems(Array.isArray(m) ? m : [])
    } catch (err) {
      console.error('Failed to load recipes:', err)
    } finally {
      setLoading(false)
    }
  }

  function openNew() {
    setEditingRecipe(null)
    setForm({ name: '', menu_item_id: '', serving_size: '', ingredients: [{ inventory_item_id: '', quantity: '', unit: '', waste_percent: '' }] })
    setShowForm(true)
  }

  function openEdit(recipe) {
    setEditingRecipe(recipe)
    setForm({
      name: recipe.name || recipe.menu_item_name || '',
      menu_item_id: recipe.menu_item_id || '',
      serving_size: recipe.serving_size || '',
      ingredients: (recipe.ingredients || []).length > 0
        ? recipe.ingredients.map(i => ({
            inventory_item_id: i.inventory_item_id || '',
            quantity: i.quantity || '',
            unit: i.unit || '',
            waste_percent: i.wastage_pct || i.waste_percent || ''
          }))
        : [{ inventory_item_id: '', quantity: '', unit: '', waste_percent: '' }]
    })
    setShowForm(true)
  }

  function addIngredient() {
    setForm({ ...form, ingredients: [...form.ingredients, { inventory_item_id: '', quantity: '', unit: '', waste_percent: '' }] })
  }

  function updateIngredient(index, field, value) {
    const updated = [...form.ingredients]
    updated[index] = { ...updated[index], [field]: value }
    setForm({ ...form, ingredients: updated })
  }

  function removeIngredient(index) {
    if (form.ingredients.length <= 1) return
    setForm({ ...form, ingredients: form.ingredients.filter((_, i) => i !== index) })
  }

  async function saveRecipe() {
    if (!form.name.trim()) return
    const payload = {
      name: form.name.trim(),
      menu_item_id: form.menu_item_id || null,
      serving_size: form.serving_size || null,
      ingredients: form.ingredients
        .filter(i => i.quantity)
        .map((i, idx) => ({
          inventory_item_id: i.inventory_item_id || null,
          quantity: Number(i.quantity) || 0,
          unit: i.unit || null,
          waste_percent: Number(i.waste_percent) || 0,
          sort_order: idx
        }))
    }
    try {
      if (editingRecipe) {
        payload.id = editingRecipe.id
        payload.version = (editingRecipe.version || 1) + 1
      }
      await window.api.pos.saveRecipe(payload)
      setShowForm(false)
      setEditingRecipe(null)
      await loadData()
    } catch (err) {
      console.error('Failed to save recipe:', err)
    }
  }

  async function deleteRecipe(id) {
    if (!confirm('Delete this recipe?')) return
    try {
      await window.api.pos.deleteRecipe(id)
      await loadData()
    } catch (err) {
      console.error('Failed to delete recipe:', err)
    }
  }

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Recipes & Costing</h1>
          <p className="text-sm text-gray-500 mt-1">Create, edit, and cost recipes</p>
        </div>
        <div className="flex gap-2">
          <button onClick={openNew} className="bb-btn-primary text-sm flex items-center gap-1.5">
            <Plus size={14} /> New Recipe
          </button>
          <button onClick={loadData} className="bb-btn-outline text-sm">Refresh</button>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-64">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#174c3a] border-t-transparent" />
        </div>
      ) : recipes.length === 0 ? (
        <div className="bb-card p-12 text-center">
          <p className="text-gray-500 text-lg mb-2">No recipes configured</p>
          <p className="text-gray-400 text-sm">Click "New Recipe" to create your first recipe</p>
        </div>
      ) : (
        <div className="space-y-4">
          {recipes.map((recipe) => {
            const totalCost = (recipe.ingredients || []).reduce(
              (sum, ing) => sum + (ing.quantity || 0) * (ing.unit_cost || 0) * (1 + (ing.wastage_pct || ing.waste_percent || 0) / 100), 0
            )
            const sellingPrice = recipe.selling_price || 0
            const margin = sellingPrice > 0 ? ((sellingPrice - totalCost) / sellingPrice * 100).toFixed(1) : null

            return (
              <div key={recipe.id} className="bb-card p-5">
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <h3 className="font-semibold text-gray-900">{recipe.name || recipe.menu_item_name}</h3>
                    {recipe.version && <span className="text-xs text-gray-400">v{recipe.version}</span>}
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="flex gap-3 text-sm">
                      <div className="text-right">
                        <div className="text-gray-500 text-xs">Cost</div>
                        <div className="font-medium">${totalCost.toFixed(2)}</div>
                      </div>
                      {sellingPrice > 0 && (
                        <div className="text-right">
                          <div className="text-gray-500 text-xs">Selling</div>
                          <div className="font-medium">${sellingPrice.toFixed(2)}</div>
                        </div>
                      )}
                      {margin != null && (
                        <div className="text-right">
                          <div className="text-gray-500 text-xs">Margin</div>
                          <div className={`font-medium ${Number(margin) < 30 ? 'text-red-600' : Number(margin) < 60 ? 'text-amber-600' : 'text-emerald-600'}`}>
                            {margin}%
                          </div>
                        </div>
                      )}
                    </div>
                    <div className="flex gap-1">
                      <button onClick={() => openEdit(recipe)} className="text-gray-400 hover:text-blue-600 p-1"><Pencil size={14} /></button>
                      <button onClick={() => deleteRecipe(recipe.id)} className="text-gray-400 hover:text-red-600 p-1"><Trash2 size={14} /></button>
                    </div>
                  </div>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
                  {(recipe.ingredients || []).map((ing, i) => (
                    <div key={i} className="bg-gray-50 rounded-lg px-3 py-2 text-sm">
                      <div className="font-medium">{ing.name || ing.ingredient_name || 'Unknown'}</div>
                      <div className="text-gray-500 text-xs">
                        {ing.quantity} {ing.unit || 'units'} @ ${Number(ing.unit_cost || 0).toFixed(2)}
                        {(ing.wastage_pct || ing.waste_percent) > 0 && <span className="text-amber-500"> +{ing.wastage_pct || ing.waste_percent}% waste</span>}
                      </div>
                    </div>
                  ))}
                </div>
                {!recipe.menu_item_id && (
                  <div className="mt-3 text-xs text-amber-600 bg-amber-50 rounded px-3 py-1.5">
                    Not linked to a menu item
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Add/Edit form modal */}
      {showForm && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg p-6 max-h-[80vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold">{editingRecipe ? 'Edit Recipe' : 'New Recipe'}</h2>
              <button onClick={() => { setShowForm(false); setEditingRecipe(null) }} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="text-xs font-medium text-gray-600">Recipe Name *</label>
                <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} className="bb-input w-full mt-1" placeholder="e.g. Classic Burger" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-gray-600">Linked Menu Item</label>
                  <select value={form.menu_item_id} onChange={e => setForm({ ...form, menu_item_id: e.target.value })} className="bb-input w-full mt-1">
                    <option value="">None</option>
                    {menuItems.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-600">Serving Size</label>
                  <input value={form.serving_size} onChange={e => setForm({ ...form, serving_size: e.target.value })} className="bb-input w-full mt-1" placeholder="e.g. 1 plate" />
                </div>
              </div>
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-xs font-medium text-gray-600">Ingredients</label>
                  <button onClick={addIngredient} className="text-xs text-blue-600 hover:underline flex items-center gap-1"><Plus size={12} /> Add</button>
                </div>
                <div className="space-y-2">
                  {form.ingredients.map((ing, i) => (
                    <div key={i} className="flex gap-2 items-start">
                      <input value={ing.quantity} onChange={e => updateIngredient(i, 'quantity', e.target.value)} type="number" step="0.01" className="bb-input w-20" placeholder="Qty" />
                      <input value={ing.unit} onChange={e => updateIngredient(i, 'unit', e.target.value)} className="bb-input w-20" placeholder="Unit" />
                      <input value={ing.waste_percent} onChange={e => updateIngredient(i, 'waste_percent', e.target.value)} type="number" className="bb-input w-16" placeholder="Waste%" />
                      {form.ingredients.length > 1 && (
                        <button onClick={() => removeIngredient(i)} className="text-gray-400 hover:text-red-600 mt-2"><Trash2 size={14} /></button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <div className="flex gap-3 mt-6">
              <button onClick={() => { setShowForm(false); setEditingRecipe(null) }} className="bb-btn-outline flex-1">Cancel</button>
              <button onClick={saveRecipe} disabled={!form.name.trim()} className="bb-btn-primary flex-1">{editingRecipe ? 'Save Changes' : 'Create Recipe'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
