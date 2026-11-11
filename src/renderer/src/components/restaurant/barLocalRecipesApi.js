// @ts-check

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
const PREFIX = 'restaurant:bar-local:recipe:'

async function completeList(bridge, name, scope, filters = {}) {
  const rows = []
  const cursors = new Set()
  let cursor = null
  let watermark = null
  for (let page = 0; page < 1000; page += 1) {
    const result = await bridge.query(name, { ...filters, limit: 200, ...(cursor ? { cursor } : {}) })
    if (result?.complete !== true || !Array.isArray(result.data) || !isRecord(result.scope)
      || result.scope.business_id !== scope.businessId || result.scope.outlet_id !== scope.outletId
      || result.scope.actor_staff_id !== scope.staffId || !Number.isSafeInteger(result.snapshot_watermark)) {
      throw new Error(`Local ${name} records are incomplete or belong to another Bar session.`)
    }
    if (watermark !== null && watermark !== result.snapshot_watermark) throw new Error('Bar records changed while the page was loading. Refresh before editing a recipe.')
    watermark = result.snapshot_watermark
    if (!result.data.every(isRecord)) throw new Error(`Local ${name} returned an invalid row. No partial list was accepted.`)
    rows.push(...result.data)
    if (result.pagination?.has_more === false) return { rows, watermark }
    const next = result.pagination?.next_cursor
    if (typeof next !== 'string' || !next || cursors.has(next) || result.data.length === 0) throw new Error(`Local ${name} pagination could not be verified; no partial list was accepted.`)
    cursors.add(next)
    cursor = next
  }
  throw new Error(`Local ${name} records exceed the safe page limit.`)
}

/** @param {any} bridge @param {{businessId:string, outletId:string, staffId:string}} scope */
export function createBarLocalRecipesApi(bridge, scope) {
  const { businessId, outletId, staffId } = scope || {}
  if (!bridge || !businessId || !outletId || !staffId) throw new Error('The signed-in Bar, outlet, or operator scope is unavailable.')
  const keyFor = (productId) => `${PREFIX}${businessId}:${outletId}:${staffId}:${productId}`
  const readIntent = (storage, productId) => {
    try {
      const value = JSON.parse(storage?.getItem(keyFor(productId)) || 'null')
      return isRecord(value) && value.command === 'catalogue.recipe.set' && UUID.test(String(value.operation_id || '')) && isRecord(value.payload)
        ? value : null
    } catch { throw new Error('Saved recipe recovery data could not be read. Stop and contact support before continuing.') }
  }
  const pendingAll = (storage) => {
    if (!storage || !Number.isSafeInteger(storage.length)) return []
    const prefix = `${PREFIX}${businessId}:${outletId}:${staffId}:`
    const rows = []
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index)
      if (typeof key !== 'string' || !key.startsWith(prefix)) continue
      const productId = key.slice(prefix.length)
      const intent = readIntent(storage, productId)
      if (intent) rows.push({ productId, operationId: intent.operation_id, payload: intent.payload })
    }
    return rows
  }
  const finish = (storage, key, result) => {
    if (result?.outcome === 'committed_local') { storage.removeItem(key); return result }
    if (result?.outcome === 'refused') { storage.removeItem(key); throw new Error(result.error?.message || 'The local Bar service refused this recipe change.') }
    throw new Error('The recipe result is uncertain. Retry the exact saved operation before editing another recipe.')
  }

  return {
    async load() {
      const [menu, stock, modifiers] = await Promise.all([
        completeList(bridge, 'menu.availability', scope, { include_inactive: true }),
        completeList(bridge, 'stock.list', scope),
        bridge.query('menu.modifiers', {})
      ])
      if (modifiers?.complete !== true || !isRecord(modifiers.scope) || modifiers.scope.business_id !== businessId
        || modifiers.scope.outlet_id !== outletId || modifiers.scope.actor_staff_id !== staffId
        || !Number.isSafeInteger(modifiers.snapshot_watermark) || modifiers.snapshot_watermark !== menu.watermark
        || modifiers.snapshot_watermark !== stock.watermark || !isRecord(modifiers.data)) {
        throw new Error('The local menu, stock, and recipe snapshots do not match. Refresh before using these costs.')
      }
      if (menu.rows.some((row) => !UUID.test(String(row.product_id || '')) || typeof row.name !== 'string')
        || stock.rows.some((row) => !UUID.test(String(row.product_id || '')) || typeof row.name !== 'string'
          || typeof row.track_stock !== 'boolean' || typeof row.active !== 'boolean')) {
        throw new Error('The local catalogue or stock snapshot contains an invalid product row. No partial list was accepted.')
      }
      const menuItems = menu.rows.map((row) => ({ id: String(row.product_id), name: String(row.name || ''), price: row.price, active: row.product_active !== false }))
      const inventoryItems = stock.rows.filter((row) => row.track_stock === true && row.active === true).map((row) => ({
        id: String(row.product_id), name: String(row.name || ''), unit: String(row.unit || 'unit'),
        current_stock: row.quantity, latest_unit_cost: row.unit_cost
      }))
      const menuMap = new Map(menuItems.map((row) => [row.id, row]))
      const stockMap = new Map(inventoryItems.map((row) => [row.id, row]))
      const products = Array.isArray(modifiers.data.products) ? modifiers.data.products : null
      if (!products) throw new Error('The local service did not return recipe products. Refresh before editing.')
      if (!products.every((product) => isRecord(product) && UUID.test(String(product.product_id || ''))
        && Number.isSafeInteger(Number(product.recipe_version)) && Number(product.recipe_version) >= 0
        && Array.isArray(product.recipe_lines))) throw new Error('The local recipe snapshot contains an invalid product or version. No partial list was accepted.')
      const recipes = products.filter((product) => Number(product.recipe_version) > 0).map((product) => {
        const item = menuMap.get(String(product.product_id))
        const lines = Array.isArray(product.recipe_lines) ? product.recipe_lines : null
        if (!item || !lines) throw new Error('The local recipe snapshot contains a product or line that is missing from the complete catalogue.')
        return {
          id: String(product.product_id), version: Number(product.recipe_version), menu_item_id: String(product.product_id),
          name: item.name, menu_item_name: item.name, serving_size: '1', selling_price: item.price,
          ingredients: lines.map((line) => {
            const stockItem = isRecord(line) ? stockMap.get(String(line.ingredient_product_id)) : null
            if (!stockItem || !isRecord(line) || !Number.isFinite(Number(line.quantity)) || Number(line.quantity) <= 0
              || !Number.isFinite(Number(line.unit_cost)) || Number(line.unit_cost) < 0) throw new Error('A local recipe line is not a valid active stock product with quantity and unit cost.')
            return { inventory_item_id: stockItem.id, ingredient_name: String(line.name || stockItem.name), quantity: String(line.quantity),
              unit: stockItem.unit, unit_cost: String(line.unit_cost), latest_unit_cost: stockItem.latest_unit_cost, waste_percent: 0 }
          })
        }
      })
      return { recipes, menuItems, inventoryItems, watermark: menu.watermark }
    },
    pending(storage, productId) { return readIntent(storage, productId) },
    pendingAll,
    async save(storage, payload) {
      if (!storage || typeof storage.getItem !== 'function' || typeof storage.setItem !== 'function' || typeof storage.removeItem !== 'function') throw new Error('Durable local recovery storage is unavailable. No recipe was changed.')
      const productId = String(payload?.product_id || '')
      if (!UUID.test(productId) || !Number.isSafeInteger(payload.expected_version) || payload.expected_version < 0 || !Array.isArray(payload.lines)) throw new Error('The local recipe command does not match its validated product version and ingredient lines.')
      for (const line of payload.lines) if (!isRecord(line) || !UUID.test(String(line.ingredient_product_id || ''))
        || !/^(?:0|[1-9]\d{0,11})(?:\.\d{1,6})?$/.test(String(line.quantity)) || Number(line.quantity) <= 0
        || !/^(?:0|[1-9]\d{0,11})(?:\.\d{1,2})?$/.test(String(line.unit_cost)) || Number(line.unit_cost) < 0) throw new Error('Each recipe ingredient needs a valid local stock product, positive quantity, and non-negative unit cost.')
      const key = keyFor(productId)
      let intent = readIntent(storage, productId)
      if (intent && JSON.stringify(intent.payload) !== JSON.stringify(payload)) throw new Error('A different recipe operation is unresolved. Restore its exact saved details and retry before making another edit.')
      const open = await bridge.getOpenIntents()
      if (!Array.isArray(open)) throw new Error('The local operation journal could not be checked. No recipe was changed.')
      if (intent && open.some((row) => row?.operation_id === intent.operation_id)) {
        if (typeof bridge.retryOperation !== 'function') throw new Error('Local operation retry is unavailable. Keep this recipe operation pending and contact support.')
        return finish(storage, key, await bridge.retryOperation(intent.operation_id))
      }
      if (!intent) {
        if (open.length) throw new Error('Resolve the existing local operation before changing a recipe.')
        const operation_id = globalThis.crypto?.randomUUID?.()
        if (!UUID.test(String(operation_id || ''))) throw new Error('A stable recipe operation ID could not be created. No recipe was changed.')
        intent = { command: 'catalogue.recipe.set', operation_id, payload }
        storage.setItem(key, JSON.stringify(intent))
      }
      try {
        return finish(storage, key, await bridge.command({ command: intent.command, operation_id: intent.operation_id, payload: intent.payload }))
      } catch (error) {
        if (readIntent(storage, productId)) throw new Error('The recipe result is uncertain. Retry the exact saved operation before editing another recipe.')
        throw error
      }
    },
    async retry(storage, productId) {
      const intent = readIntent(storage, productId)
      if (!intent) throw new Error('There is no saved recipe operation to retry.')
      const open = await bridge.getOpenIntents()
      if (!Array.isArray(open)) throw new Error('The local operation journal could not be checked. No recipe retry was sent.')
      try {
        if (open.some((row) => row?.operation_id === intent.operation_id)) return finish(storage, keyFor(productId), await bridge.retryOperation(intent.operation_id))
        return finish(storage, keyFor(productId), await bridge.command({ command: intent.command, operation_id: intent.operation_id, payload: intent.payload }))
      } catch (error) {
        if (readIntent(storage, productId)) throw new Error('The recipe result is uncertain. Retry the exact saved operation before editing another recipe.')
        throw error
      }
    }
  }
}
