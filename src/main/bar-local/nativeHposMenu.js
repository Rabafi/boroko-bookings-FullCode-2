// @ts-check

/** @typedef {{query(name: string, filters?: Record<string, unknown>): Promise<Record<string, any>>, command(request: Record<string, unknown>): Promise<Record<string, any>>, retryOperation(id: string): Promise<Record<string, any>>}} NativeMenuRuntime */

function records(value) { return Array.isArray(value) ? value.filter((row) => row && typeof row === 'object') : [] }

async function collectQuery(runtime, name, filters = {}) {
  const rows = []
  let cursor
  let proof
  for (let page = 0; page < 200; page += 1) {
    const result = await runtime.query(name, { ...filters, limit: 200, ...(cursor ? { cursor } : {}) })
    if (result?.complete !== true || result?.unavailable?.length) throw new Error('The local Bar read was incomplete. Refresh before changing products or stock.')
    const currentProof = `${result.snapshot_watermark}|${result.scope?.business_id}|${result.scope?.outlet_id}`
    if (proof !== undefined && proof !== currentProof) throw new Error('The Bar data changed during the read. Refresh the screen before continuing.')
    proof = currentProof
    rows.push(...records(result.data))
    if (result.pagination?.has_more !== true) return { rows, proof }
    const next = result.pagination?.next_cursor
    if (typeof next !== 'string' || !next || next === cursor) throw new Error('The local Bar returned an invalid page cursor. Refresh before continuing.')
    cursor = next
  }
  throw new Error('The local Bar product list is too large to verify in one read. Narrow the list before continuing.')
}

function menuRow(row) {
  const pack = Number(row.template_pack_size) || null
  return {
    id: String(row.product_id), sku: String(row.sku || ''), name: String(row.name || ''), category: String(row.category || ''), price: row.price,
    tax_rate: row.tax_rate,
    barcode: row.barcode || row.pack_barcode || null, inventory_item_id: row.inventory_item_id || null,
    depletion_qty: row.depletion_qty, stock_method: row.inventory_item_id ? 'direct' : row.has_recipe === true ? 'recipe' : 'non_stock',
    is_available: row.available === true, available: row.available === true,
    archived_at: row.product_active === true ? null : row.product_active === false ? 'archived' : null,
    track_stock: row.track_stock === true, availability_version: Number(row.availability_version) || 0,
    product_version: Number(row.product_version) || 1, updated_at: String(Number(row.product_version) || 1),
    stock_quantity: row.stock_quantity, stock_version: Number(row.stock_version) || 0,
    unit: row.unit || 'unit', reorder_level: row.reorder_level ?? 0,
    latest_unit_cost: row.unit_cost ?? 0, selling_price: row.selling_price ?? row.price,
    template_kind: pack ? 'bar_pack' : null, template_pack_size: pack,
    template_parent_product_id: row.template_parent_product_id || null, outlet_id: null
  }
}

/** @param {NativeMenuRuntime} runtime @param {'menu'|'stock'|'modifiers'|'outlets'} kind */
export async function readNativeHposMenu(runtime, kind) {
  if (kind === 'menu') {
    const result = await collectQuery(runtime, 'menu.availability', { include_inactive: true })
    return { rows: result.rows.map(menuRow), complete: true, snapshot: result.proof }
  }
  if (kind === 'stock') {
    const result = await collectQuery(runtime, 'stock.list')
    const rows = result.rows.filter((row) => row.track_stock === true).map((row) => ({
      id: String(row.product_id), name: String(row.name || ''), category: String(row.category || ''),
      barcode: row.barcode || null, unit: row.unit || 'unit', current_stock: row.quantity ?? 0,
      is_active: row.active === true, track_stock: true, reorder_level: row.reorder_level ?? 0,
      latest_unit_cost: row.unit_cost ?? 0, selling_price: row.selling_price ?? 0,
      product_version: Number(row.product_version) || 1, stock_version: Number(row.version) || 0,
      updated_at: String(Number(row.version) || 0), outlet_id: result.proof.split('|').at(-1) || null
    })).sort((a, b) => a.name.localeCompare(b.name))
    return { rows, complete: true, snapshot: result.proof }
  }
  if (kind === 'modifiers') {
    const [result, menu] = await Promise.all([
      runtime.query('menu.modifiers', {}), collectQuery(runtime, 'menu.availability', { include_inactive: true })
    ])
    if (result?.complete !== true || result?.unavailable?.length || !Array.isArray(menu?.rows)) throw new Error('Modifier and recipe settings could not be verified locally.')
    const modifierProof = `${result.snapshot_watermark}|${result.scope?.business_id}|${result.scope?.outlet_id}`
    if (modifierProof !== menu.proof) throw new Error('The local modifier and product snapshots changed during the read. Refresh before editing.')
    const data = result.data && typeof result.data === 'object' ? result.data : {}
    const config = {
      groups: records(data.groups),
      products: records(data.products).map((product) => ({
        ...product,
        stock_linked: menu.rows.some((row) => row.product_id === product.product_id && Boolean(row.inventory_item_id))
      })),
      promotions: records(data.promotions)
    }
    return {
      groups: records(data.groups).map((group) => ({ ...group, id: group.modifier_group_id, applies_to_categories: [],
        options: records(group.options).map((option) => ({ ...option, id: option.modifier_option_id })) })),
      recipes: config.products.filter((product) => product.stock_linked !== true).map((product) => ({ menu_item_id: product.product_id,
        ingredients: records(product.recipe_lines).map((line) => ({ ...line, product_id: line.ingredient_product_id })) })),
      config,
      snapshot: menu.proof,
      complete: true
    }
  }
  if (kind === 'outlets') {
    const result = await runtime.query('bootstrap', {})
    const data = result?.data && typeof result.data === 'object' ? result.data : {}
    const outlet = data.outlet && typeof data.outlet === 'object' ? data.outlet : null
    return { rows: outlet ? [{ ...outlet, is_active: true, type: 'beverage' }] : [], complete: true }
  }
  throw new TypeError('This local Bar native-menu read is not supported.')
}

function wizardResult(outcome) {
  if (outcome?.outcome === 'committed_local') {
    const result = outcome.result && typeof outcome.result === 'object' ? outcome.result : {}
    return { success: true, id: result.menu_item_id || result.product_id, menu_item_id: result.menu_item_id, inventory_item_id: result.inventory_item_id, publication: 'published', outcome: outcome.outcome }
  }
  const error = outcome?.error && typeof outcome.error === 'object' ? outcome.error : {}
  const unknown = outcome?.outcome === 'unknown'
  return {
    success: false,
    outcome: unknown ? 'unknown' : (typeof outcome?.outcome === 'string' ? outcome.outcome : 'refused'),
    operation_key: outcome?.operation_id || null,
    code: typeof error.code === 'string' ? error.code : (unknown ? 'LOCAL_OUTCOME_UNKNOWN' : 'LOCAL_COMMAND_REFUSED'),
    error: typeof error.message === 'string' ? error.message : (unknown ? 'The local result is unknown. Retry this same operation before making another change.' : 'The local service refused this product change. Nothing was committed.')
  }
}

/**
 * Narrow compatibility adapter for the original HposProductWizard. The old
 * renderer command never reaches its cloud IPC handler in local Bar mode.
 * @param {NativeMenuRuntime} runtime
 * @param {Record<string, unknown>} request
 */
export async function saveNativeHposBarProduct(runtime, request) {
  if (!request || typeof request !== 'object' || Array.isArray(request)) throw new TypeError('A Bar product save request is required.')
  const operationId = String(request.operation_key || '')
  if (!operationId) throw new TypeError('A stable Bar product operation key is required.')
  const payload = { ...request }
  delete payload.operation_key
  if (payload.local_stock_only === true) {
    delete payload.local_stock_only
    return wizardResult(await runtime.command({ command: 'catalogue.stock_item.save', operation_id: operationId, payload }))
  }
  if (payload.local_recipe_update === true) {
    delete payload.local_recipe_update
    const outcome = await runtime.command({ command: 'catalogue.upsert', operation_id: operationId, payload: {
      product_id: payload.menu_item_id, expected_version: Number(payload.expected_menu_version),
      sku: payload.sku, name: payload.name, category: payload.category, price: payload.price,
      tax_rate: payload.tax_rate, track_stock: payload.track_stock, active: payload.active
    } })
    return wizardResult(outcome)
  }
  payload.expected_menu_version = payload.expected_menu_version == null ? null : Number(payload.expected_menu_version)
  payload.expected_stock_version = payload.expected_stock_version == null ? null : Number(payload.expected_stock_version)
  const outcome = await runtime.command({ command: 'catalogue.bar_product.save', operation_id: operationId, payload })
  return wizardResult(outcome)
}

/** @param {NativeMenuRuntime} runtime @param {string} operationId */
export async function retryNativeHposBarProduct(runtime, operationId) {
  return wizardResult(await runtime.retryOperation(operationId))
}
