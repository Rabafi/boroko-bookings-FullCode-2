import { useMemo, useState } from 'react'

/** @param {{config: Record<string, unknown>|null, busy: boolean, blocked: boolean, onCommand: (command: string, payload: Record<string, unknown>) => Promise<unknown>}} props */
export default function BarLocalModifierManager({ config, busy, blocked, onCommand }) {
  const groups = useMemo(() => Array.isArray(config?.groups) ? config.groups : [], [config])
  const products = useMemo(() => Array.isArray(config?.products) ? config.products : [], [config])
  const promotions = useMemo(() => Array.isArray(config?.promotions) ? config.promotions : [], [config])
  const [groupDraft, setGroupDraft] = useState({ groupId: '', expectedVersion: 0, code: '', name: '', required: false, max: '1', active: true })
  const [optionDraft, setOptionDraft] = useState({ groupId: '', optionId: '', expectedVersion: 0, code: '', name: '', price: '0.00', active: true })
  const [productId, setProductId] = useState('')
  const [selectedGroups, setSelectedGroups] = useState([])
  const [recipeProductId, setRecipeProductId] = useState('')
  const [recipeLines, setRecipeLines] = useState([])
  const [promotionDraft, setPromotionDraft] = useState({ promotionId: '', expectedVersion: 0, code: '', name: '', discountType: 'percent', percent: '10', amount: '0.00', minimum: '0.00', scope: 'all', productId: '', category: '', active: true, startsOn: '', endsOn: '' })

  async function saveGroup(event) {
    event.preventDefault()
    const result = await onCommand('catalogue.modifier_group.upsert', {
      ...(groupDraft.groupId ? { modifier_group_id: groupDraft.groupId, expected_version: groupDraft.expectedVersion } : {}),
      code: groupDraft.code.trim().toUpperCase(), name: groupDraft.name.trim(),
      required: groupDraft.required, min_selections: groupDraft.required ? 1 : 0,
      max_selections: Number(groupDraft.max), active: groupDraft.active
    })
    if (result && typeof result === 'object' && 'outcome' in result && result.outcome === 'committed_local') setGroupDraft({ groupId: '', expectedVersion: 0, code: '', name: '', required: false, max: '1', active: true })
  }

  async function saveOption(event) {
    event.preventDefault()
    const result = await onCommand('catalogue.modifier_option.upsert', {
      ...(optionDraft.optionId ? { modifier_option_id: optionDraft.optionId, expected_version: optionDraft.expectedVersion } : {}),
      modifier_group_id: optionDraft.groupId, code: optionDraft.code.trim().toUpperCase(),
      name: optionDraft.name.trim(), price_delta: optionDraft.price.trim(), active: optionDraft.active
    })
    if (result && typeof result === 'object' && 'outcome' in result && result.outcome === 'committed_local') setOptionDraft((draft) => ({ ...draft, optionId: '', expectedVersion: 0, code: '', name: '', price: '0.00', active: true }))
  }

  async function saveAssignment(event) {
    event.preventDefault()
    const product = products.find((row) => row.product_id === productId)
    if (!product) throw new Error('Select a product from the current local catalogue.')
    await onCommand('catalogue.product_modifier.set', {
      product_id: productId,
      ...(Number.isSafeInteger(product.version) && product.version > 0 ? { expected_version: product.version } : {}),
      groups: selectedGroups.map((id, sort_order) => ({ modifier_group_id: id, sort_order }))
    })
  }

  function chooseProduct(id) {
    setProductId(id)
    const product = products.find((row) => row.product_id === id)
    setSelectedGroups(Array.isArray(product?.groups) ? product.groups.map((row) => row.modifier_group_id) : [])
  }

  function toggleGroup(id, checked) {
    setSelectedGroups((current) => checked
      ? [...current.filter((value) => value !== id), id]
      : current.filter((value) => value !== id))
  }

  function chooseRecipeProduct(id) {
    setRecipeProductId(id)
    const product = products.find((row) => row.product_id === id)
    setRecipeLines(Array.isArray(product?.recipe_lines) ? product.recipe_lines.map((line) => ({
      ingredient_product_id: String(line.ingredient_product_id), quantity: String(line.quantity), unit_cost: String(line.unit_cost)
    })) : [])
  }

  async function saveRecipe(event) {
    event.preventDefault()
    const product = products.find((row) => row.product_id === recipeProductId)
    if (!product) throw new Error('Select a product from the current local catalogue.')
    await onCommand('catalogue.recipe.set', {
      product_id: recipeProductId,
      expected_version: Number.isSafeInteger(product.recipe_version) ? product.recipe_version : 0,
      lines: recipeLines.map((line) => ({
        ingredient_product_id: line.ingredient_product_id,
        quantity: line.quantity.trim(), unit_cost: line.unit_cost.trim()
      }))
    })
  }

  async function savePromotion(event) {
    event.preventDefault()
    const result = await onCommand('promotion.upsert', {
      ...(promotionDraft.promotionId ? { promotion_id: promotionDraft.promotionId, expected_version: promotionDraft.expectedVersion } : {}),
      code: promotionDraft.code.trim().toUpperCase(), name: promotionDraft.name.trim(),
      discount_type: promotionDraft.discountType,
      percent: promotionDraft.discountType === 'percent' ? promotionDraft.percent.trim() : '0.00',
      amount: promotionDraft.discountType === 'amount' ? promotionDraft.amount.trim() : '0.00',
      minimum_subtotal: promotionDraft.minimum.trim(), scope: promotionDraft.scope,
      ...(promotionDraft.scope === 'product' ? { product_id: promotionDraft.productId } : {}),
      ...(promotionDraft.scope === 'category' ? { category: promotionDraft.category.trim() } : {}),
      active: promotionDraft.active,
      starts_on: promotionDraft.startsOn || undefined, ends_on: promotionDraft.endsOn || undefined
    })
    if (result && typeof result === 'object' && 'outcome' in result && result.outcome === 'committed_local') {
      setPromotionDraft({ promotionId: '', expectedVersion: 0, code: '', name: '', discountType: 'percent', percent: '10', amount: '0.00', minimum: '0.00', scope: 'all', productId: '', category: '', active: true, startsOn: '', endsOn: '' })
    }
  }

  function editPromotion(id) {
    const promotion = promotions.find((row) => row.promotion_id === id)
    if (!promotion) return
    setPromotionDraft({ promotionId: id, expectedVersion: promotion.version, code: promotion.code, name: promotion.name, discountType: promotion.discount_type, percent: String(promotion.percent), amount: String(promotion.amount), minimum: String(promotion.minimum_subtotal), scope: promotion.scope, productId: String(promotion.product_id || ''), category: String(promotion.category || ''), active: promotion.active === true, startsOn: String(promotion.starts_on || ''), endsOn: String(promotion.ends_on || '') })
  }

  function editGroup(id) {
    const group = groups.find((row) => row.modifier_group_id === id)
    if (!group) return
    setGroupDraft({ groupId: id, expectedVersion: group.version, code: group.code, name: group.name, required: group.required === true, max: String(group.max_selections), active: group.active === true })
  }

  function editOption(groupId, id) {
    const group = groups.find((row) => row.modifier_group_id === groupId)
    const option = Array.isArray(group?.options) ? group.options.find((row) => row.modifier_option_id === id) : null
    if (!group || !option) return
    setOptionDraft({ groupId, optionId: id, expectedVersion: option.version, code: option.code, name: option.name, price: String(option.price_delta), active: option.active === true })
  }

  return <div className="mt-4 grid gap-4 xl:grid-cols-3">
    <form onSubmit={saveGroup} className="rounded border border-slate-700 p-3">
      <h4 className="text-sm font-semibold">{groupDraft.groupId ? 'Edit modifier group' : 'Create modifier group'}</h4>
      {groups.length > 0 && <label className="mt-2 block text-xs">Existing group<select value={groupDraft.groupId} onChange={(event) => event.target.value ? editGroup(event.target.value) : setGroupDraft({ groupId: '', expectedVersion: 0, code: '', name: '', required: false, max: '1', active: true })} className="mt-1 w-full rounded bg-slate-800 p-2"><option value="">Create a new group</option>{groups.map((group) => <option key={group.modifier_group_id} value={group.modifier_group_id}>{group.name} · {group.active ? 'active' : 'inactive'}</option>)}</select></label>}
      <label className="mt-2 block text-xs">Code<input required maxLength={32} pattern="[A-Za-z0-9_-]+" value={groupDraft.code} onChange={(event) => setGroupDraft((draft) => ({ ...draft, code: event.target.value }))} className="mt-1 w-full rounded bg-slate-800 p-2" /></label>
      <label className="mt-2 block text-xs">Name<input required maxLength={120} value={groupDraft.name} onChange={(event) => setGroupDraft((draft) => ({ ...draft, name: event.target.value }))} className="mt-1 w-full rounded bg-slate-800 p-2" /></label>
      <label className="mt-2 block text-xs">Maximum selections<input required type="number" min="1" max="50" value={groupDraft.max} onChange={(event) => setGroupDraft((draft) => ({ ...draft, max: event.target.value }))} className="mt-1 w-full rounded bg-slate-800 p-2" /></label>
      <label className="mt-2 flex items-center gap-2 text-xs"><input type="checkbox" checked={groupDraft.required} onChange={(event) => setGroupDraft((draft) => ({ ...draft, required: event.target.checked }))} />At least one selection is required</label>
      {groupDraft.groupId && <label className="mt-2 flex items-center gap-2 text-xs"><input type="checkbox" checked={groupDraft.active} onChange={(event) => setGroupDraft((draft) => ({ ...draft, active: event.target.checked }))} />Available for new sales</label>}
      <button disabled={busy || blocked} className="mt-3 rounded bg-amber-500 px-3 py-2 text-xs font-semibold text-slate-950 disabled:opacity-50">Save group</button>
    </form>

    <form onSubmit={saveOption} className="rounded border border-slate-700 p-3">
      <h4 className="text-sm font-semibold">{optionDraft.optionId ? 'Edit option' : 'Add option'}</h4>
      <label className="mt-2 block text-xs">Group<select required value={optionDraft.groupId} onChange={(event) => setOptionDraft((draft) => ({ ...draft, groupId: event.target.value, optionId: '', expectedVersion: 0, code: '', name: '', price: '0.00', active: true }))} className="mt-1 w-full rounded bg-slate-800 p-2"><option value="">Choose a group</option>{groups.map((group) => <option key={group.modifier_group_id} value={group.modifier_group_id}>{group.name} · {group.code}</option>)}</select></label>
      {optionDraft.groupId && <label className="mt-2 block text-xs">Existing option<select value={optionDraft.optionId} onChange={(event) => event.target.value ? editOption(optionDraft.groupId, event.target.value) : setOptionDraft((draft) => ({ ...draft, optionId: '', expectedVersion: 0, code: '', name: '', price: '0.00', active: true }))} className="mt-1 w-full rounded bg-slate-800 p-2"><option value="">Create a new option</option>{(groups.find((group) => group.modifier_group_id === optionDraft.groupId)?.options || []).map((option) => <option key={option.modifier_option_id} value={option.modifier_option_id}>{option.name} · {option.active ? 'active' : 'inactive'}</option>)}</select></label>}
      <label className="mt-2 block text-xs">Code<input required maxLength={32} pattern="[A-Za-z0-9_-]+" value={optionDraft.code} onChange={(event) => setOptionDraft((draft) => ({ ...draft, code: event.target.value }))} className="mt-1 w-full rounded bg-slate-800 p-2" /></label>
      <label className="mt-2 block text-xs">Name<input required maxLength={120} value={optionDraft.name} onChange={(event) => setOptionDraft((draft) => ({ ...draft, name: event.target.value }))} className="mt-1 w-full rounded bg-slate-800 p-2" /></label>
      <label className="mt-2 block text-xs">Price change<input required inputMode="decimal" pattern="\d+(\.\d{1,2})?" value={optionDraft.price} onChange={(event) => setOptionDraft((draft) => ({ ...draft, price: event.target.value }))} className="mt-1 w-full rounded bg-slate-800 p-2" /></label>
      {optionDraft.optionId && <label className="mt-2 flex items-center gap-2 text-xs"><input type="checkbox" checked={optionDraft.active} onChange={(event) => setOptionDraft((draft) => ({ ...draft, active: event.target.checked }))} />Available for new sales</label>}
      <button disabled={busy || blocked || groups.length === 0} className="mt-3 rounded bg-amber-500 px-3 py-2 text-xs font-semibold text-slate-950 disabled:opacity-50">Save option</button>
    </form>

    <form onSubmit={saveAssignment} className="rounded border border-slate-700 p-3">
      <h4 className="text-sm font-semibold">Assign groups to product</h4>
      <label className="mt-2 block text-xs">Product<select required value={productId} onChange={(event) => chooseProduct(event.target.value)} className="mt-1 w-full rounded bg-slate-800 p-2"><option value="">Choose a product</option>{products.map((product) => <option key={product.product_id} value={product.product_id}>{product.name} · {product.sku}</option>)}</select></label>
      <fieldset className="mt-3 space-y-1"><legend className="text-xs">Groups, in display order</legend>{groups.map((group) => <label key={group.modifier_group_id} className="flex items-center gap-2 text-xs"><input type="checkbox" disabled={!productId || (group.active !== true && !selectedGroups.includes(group.modifier_group_id))} checked={selectedGroups.includes(group.modifier_group_id)} onChange={(event) => toggleGroup(group.modifier_group_id, event.target.checked)} />{group.name}{group.active !== true ? ' · inactive (remove only)' : ''}</label>)}</fieldset>
      <button disabled={busy || blocked || !productId} className="mt-3 rounded bg-amber-500 px-3 py-2 text-xs font-semibold text-slate-950 disabled:opacity-50">Save assignments</button>
      <p className="mt-2 text-xs text-slate-400">Changes use the service’s version guard and are revalidated when a sale or tab is committed.</p>
    </form>
    <form onSubmit={saveRecipe} className="rounded border border-slate-700 p-3 xl:col-span-3">
      <h4 className="text-sm font-semibold">Recipe and ingredient costs</h4>
      <p className="mt-1 text-xs text-slate-400">Ingredients are products in this business. Quantities and unit costs feed stock deduction and local cost reporting; saving replaces the full recipe.</p>
      <label className="mt-2 block text-xs">Menu product<select required value={recipeProductId} onChange={(event) => chooseRecipeProduct(event.target.value)} className="mt-1 w-full rounded bg-slate-800 p-2"><option value="">Choose a recipe product</option>{products.map((product) => <option key={product.product_id} value={product.product_id}>{product.name} · {product.sku}{product.recipe_version > 0 ? ' · recipe saved' : ''}</option>)}</select></label>
      {recipeProductId && <div className="mt-3 space-y-2">{recipeLines.map((line, index) => <div key={`${recipeProductId}-${index}`} className="grid gap-2 sm:grid-cols-[2fr_1fr_1fr_auto]">
        <label className="text-xs">Ingredient<select required value={line.ingredient_product_id} onChange={(event) => setRecipeLines((current) => current.map((item, row) => row === index ? { ...item, ingredient_product_id: event.target.value } : item))} className="mt-1 w-full rounded bg-slate-800 p-2"><option value="">Choose ingredient</option>{products.filter((product) => product.product_id !== recipeProductId).map((product) => <option key={product.product_id} value={product.product_id}>{product.name} · {product.sku}</option>)}</select></label>
        <label className="text-xs">Quantity<input required type="number" min="0.000001" step="0.000001" value={line.quantity} onChange={(event) => setRecipeLines((current) => current.map((item, row) => row === index ? { ...item, quantity: event.target.value } : item))} className="mt-1 w-full rounded bg-slate-800 p-2" /></label>
        <label className="text-xs">Unit cost<input required inputMode="decimal" pattern="\d+(\.\d{1,2})?" value={line.unit_cost} onChange={(event) => setRecipeLines((current) => current.map((item, row) => row === index ? { ...item, unit_cost: event.target.value } : item))} className="mt-1 w-full rounded bg-slate-800 p-2" /></label>
        <button type="button" disabled={busy || blocked} onClick={() => setRecipeLines((current) => current.filter((_, row) => row !== index))} className="self-end rounded border border-slate-600 px-3 py-2 text-xs">Remove</button>
      </div>)}
      <div className="mt-3 flex gap-2"><button type="button" disabled={busy || blocked || products.length < 2} onClick={() => setRecipeLines((current) => [...current, { ingredient_product_id: '', quantity: '1', unit_cost: '0.00' }])} className="rounded border border-slate-600 px-3 py-2 text-xs disabled:opacity-50">Add ingredient</button><button disabled={busy || blocked} className="rounded bg-amber-500 px-3 py-2 text-xs font-semibold text-slate-950 disabled:opacity-50">Save recipe</button></div>
      {products.find((product) => product.product_id === recipeProductId)?.recipe_version > 0 && <button type="button" disabled={busy || blocked} onClick={() => setRecipeLines([])} className="mt-2 rounded border border-red-800 px-3 py-2 text-xs">Remove all ingredients, then save to remove this recipe</button>}
      </div>}
    </form>
    <form onSubmit={savePromotion} className="rounded border border-slate-700 p-3 xl:col-span-3">
      <h4 className="text-sm font-semibold">Promotions</h4>
      <p className="mt-1 text-xs text-slate-400">Codes are business-wide. The service rechecks dates, minimum subtotal, scope, discount limits and approval policy at commit time.</p>
      {promotions.length > 0 && <label className="mt-2 block text-xs">Edit promotion<select value={promotionDraft.promotionId} onChange={(event) => event.target.value ? editPromotion(event.target.value) : setPromotionDraft({ promotionId: '', expectedVersion: 0, code: '', name: '', discountType: 'percent', percent: '10', amount: '0.00', minimum: '0.00', scope: 'all', productId: '', category: '', active: true, startsOn: '', endsOn: '' })} className="mt-1 w-full rounded bg-slate-800 p-2"><option value="">Create a promotion</option>{promotions.map((promotion) => <option key={promotion.promotion_id} value={promotion.promotion_id}>{promotion.code} · {promotion.name}{promotion.active ? '' : ' · inactive'}</option>)}</select></label>}
      <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <label className="text-xs">Code<input required maxLength={32} pattern="[A-Za-z0-9_-]+" value={promotionDraft.code} onChange={(event) => setPromotionDraft((draft) => ({ ...draft, code: event.target.value }))} className="mt-1 w-full rounded bg-slate-800 p-2" /></label>
        <label className="text-xs">Name<input required maxLength={160} value={promotionDraft.name} onChange={(event) => setPromotionDraft((draft) => ({ ...draft, name: event.target.value }))} className="mt-1 w-full rounded bg-slate-800 p-2" /></label>
        <label className="text-xs">Discount<select value={promotionDraft.discountType} onChange={(event) => setPromotionDraft((draft) => ({ ...draft, discountType: event.target.value }))} className="mt-1 w-full rounded bg-slate-800 p-2"><option value="percent">Percent</option><option value="amount">Fixed amount</option></select></label>
        {promotionDraft.discountType === 'percent' ? <label className="text-xs">Percent<input required type="number" min="0.0001" max="100" step="0.0001" value={promotionDraft.percent} onChange={(event) => setPromotionDraft((draft) => ({ ...draft, percent: event.target.value }))} className="mt-1 w-full rounded bg-slate-800 p-2" /></label> : <label className="text-xs">Amount<input required inputMode="decimal" pattern="\d+(\.\d{1,2})?" value={promotionDraft.amount} onChange={(event) => setPromotionDraft((draft) => ({ ...draft, amount: event.target.value }))} className="mt-1 w-full rounded bg-slate-800 p-2" /></label>}
        <label className="text-xs">Minimum subtotal<input required inputMode="decimal" pattern="\d+(\.\d{1,2})?" value={promotionDraft.minimum} onChange={(event) => setPromotionDraft((draft) => ({ ...draft, minimum: event.target.value }))} className="mt-1 w-full rounded bg-slate-800 p-2" /></label>
        <label className="text-xs">Applies to<select value={promotionDraft.scope} onChange={(event) => setPromotionDraft((draft) => ({ ...draft, scope: event.target.value, productId: '', category: '' }))} className="mt-1 w-full rounded bg-slate-800 p-2"><option value="all">All products</option><option value="product">One product</option><option value="category">Category</option></select></label>
        {promotionDraft.scope === 'product' && <label className="text-xs">Product<select required value={promotionDraft.productId} onChange={(event) => setPromotionDraft((draft) => ({ ...draft, productId: event.target.value }))} className="mt-1 w-full rounded bg-slate-800 p-2"><option value="">Choose product</option>{products.map((product) => <option key={product.product_id} value={product.product_id}>{product.name} · {product.sku}</option>)}</select></label>}
        {promotionDraft.scope === 'category' && <label className="text-xs">Category<input required maxLength={120} value={promotionDraft.category} onChange={(event) => setPromotionDraft((draft) => ({ ...draft, category: event.target.value }))} className="mt-1 w-full rounded bg-slate-800 p-2" /></label>}
        <label className="text-xs">Starts<input type="date" value={promotionDraft.startsOn} onChange={(event) => setPromotionDraft((draft) => ({ ...draft, startsOn: event.target.value }))} className="mt-1 w-full rounded bg-slate-800 p-2" /></label>
        <label className="text-xs">Ends<input type="date" value={promotionDraft.endsOn} onChange={(event) => setPromotionDraft((draft) => ({ ...draft, endsOn: event.target.value }))} className="mt-1 w-full rounded bg-slate-800 p-2" /></label>
      </div>
      {promotionDraft.promotionId && <label className="mt-2 flex items-center gap-2 text-xs"><input type="checkbox" checked={promotionDraft.active} onChange={(event) => setPromotionDraft((draft) => ({ ...draft, active: event.target.checked }))} />Available to use</label>}
      <button disabled={busy || blocked} className="mt-3 rounded bg-amber-500 px-3 py-2 text-xs font-semibold text-slate-950 disabled:opacity-50">Save promotion</button>
    </form>
    <p className="text-xs text-slate-400 xl:col-span-3">Option price changes are local-currency amounts. The local Bar authority validates group limits and reprices sales atomically.</p>
  </div>
}
