// @ts-check

import { BarLocalAdapterError, requireInteger, requireString, requireUuid } from './authority.js'
import { hashCanonical } from './intents.js'

const DECIMAL_RE = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/

/**
 * @typedef {Object} CatalogueModifierOption
 * @property {string} option_id
 * @property {string} group_id
 * @property {string} code
 * @property {string} name
 * @property {string} price_delta
 * @property {boolean} active
 * @property {number} sort_order
 * @property {number} version
 */

/**
 * @typedef {Object} CatalogueModifierGroup
 * @property {string} group_id
 * @property {string} code
 * @property {string} name
 * @property {boolean|null} required
 * @property {number|null} min_selections
 * @property {number|null} max_selections
 * @property {boolean} active
 * @property {number} version
 * @property {CatalogueModifierOption[]|null} options
 * @property {string[]} option_ids
 */

/**
 * @typedef {Object} CatalogueProduct
 * @property {string} product_id
 * @property {string} sku
 * @property {string} name
 * @property {string|null} category
 * @property {string} price
 * @property {string} tax_rate
 * @property {boolean} track_stock
 * @property {boolean} active
 * @property {boolean} available
 * @property {number} version
 * @property {CatalogueModifierGroup[]|null} modifier_groups
 * @property {string[]} modifier_group_ids
 */

/**
 * @typedef {Object} CatalogueQueryPage
 * @property {CatalogueProduct[]} data
 * @property {{ next_cursor: string|null, has_more: boolean }} pagination
 * @property {number} snapshot_watermark
 * @property {Record<string, unknown>} scope
 * @property {string} as_of
 * @property {boolean} complete
 * @property {string[]} unavailable
 */

/**
 * @typedef {Object} CatalogueSnapshot
 * @property {CatalogueProduct[]} products
 * @property {string[]} product_ids
 * @property {Record<string, CatalogueProduct>} by_id
 * @property {string[]} available_product_ids
 * @property {string[]} unavailable_product_ids
 * @property {string[]} inactive_product_ids
 * @property {string[]} deleted_product_ids
 * @property {CatalogueModifierGroup[]} modifier_groups
 * @property {string[]} modifier_group_ids
 * @property {Record<string, CatalogueModifierGroup>} modifier_groups_by_id
 * @property {CatalogueModifierOption[]} modifier_options
 * @property {string[]} modifier_option_ids
 * @property {Record<string, CatalogueModifierOption>} modifier_options_by_id
 * @property {boolean} empty
 * @property {boolean} complete
 * @property {number} snapshot_watermark
 * @property {number|null} catalogue_version
 * @property {number} page_count
 * @property {string} as_of
 * @property {Record<string, unknown>} scope
 * @property {string} hash
 */

/**
 * @param {unknown} value
 * @param {string} field
 * @returns {string}
 */
function decimalString(value, field) {
  if (typeof value !== 'string' || !DECIMAL_RE.test(value)) {
    throw new BarLocalAdapterError('CATALOGUE_INCOMPLETE', `${field} is not a decimal string.`)
  }
  return value
}

/**
 * @param {unknown} value
 * @param {string} field
 * @returns {boolean}
 */
function booleanValue(value, field) {
  if (typeof value !== 'boolean') {
    throw new BarLocalAdapterError('CATALOGUE_INCOMPLETE', `${field} is not a boolean.`)
  }
  return value
}

/**
 * Modifier amounts may arrive as either a decimal string or a JSON number
 * because the server serialises numeric columns through jsonb.
 * @param {unknown} value
 * @param {string} field
 * @returns {string}
 */
function modifierDecimal(value, field) {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return decimalString(value, field)
}

/**
 * @param {unknown} value
 * @param {string} field
 * @param {number} fallback
 * @returns {number}
 */
function optionalIntegerValue(value, field, fallback) {
  if (value === undefined || value === null) return fallback
  return requireInteger(value, field, { min: 0 })
}

/**
 * @param {unknown} value
 * @param {string} field
 * @returns {number|null}
 */
function nullableIntegerValue(value, field) {
  if (value === undefined || value === null) return null
  return requireInteger(value, field, { min: 0 })
}

/**
 * @param {Record<string, unknown>} record
 * @param {string[]} keys
 * @returns {unknown}
 */
function firstPresent(record, keys) {
  for (const key of keys) {
    if (record[key] !== undefined) return record[key]
  }
  return undefined
}

/**
 * @param {unknown} row
 * @param {string} field
 * @param {string} groupId
 * @returns {CatalogueModifierOption}
 */
function normalizeModifierOption(row, field, groupId) {
  if (row === null || typeof row !== 'object' || Array.isArray(row)) {
    throw new BarLocalAdapterError('CATALOGUE_INCOMPLETE', `${field} is not a modifier option object.`)
  }
  const record = /** @type {Record<string, unknown>} */ (row)
  const optionId = requireUuid(firstPresent(record, ['modifier_option_id', 'option_id', 'id']), `${field}.option_id`)
  const declaredGroupId = firstPresent(record, ['modifier_group_id', 'group_id'])
  if (declaredGroupId !== undefined && declaredGroupId !== null) {
    if (requireUuid(declaredGroupId, `${field}.group_id`) !== groupId) {
      throw new BarLocalAdapterError('CATALOGUE_INCOMPLETE', `${field} belongs to a different modifier group.`)
    }
  }
  return {
    option_id: optionId,
    group_id: groupId,
    code: requireString(record.code, `${field}.code`, { max: 32 }),
    name: requireString(record.name, `${field}.name`, { max: 120 }),
    price_delta: modifierDecimal(record.price_delta ?? '0', `${field}.price_delta`),
    active: record.active === undefined ? true : booleanValue(record.active, `${field}.active`),
    sort_order: optionalIntegerValue(record.sort_order, `${field}.sort_order`, 0),
    version: optionalIntegerValue(record.version, `${field}.version`, 0)
  }
}

/**
 * @param {unknown} row
 * @param {string} field
 * @returns {CatalogueModifierGroup}
 */
function normalizeModifierGroup(row, field) {
  if (row === null || typeof row !== 'object' || Array.isArray(row)) {
    throw new BarLocalAdapterError('CATALOGUE_INCOMPLETE', `${field} is not a modifier group object.`)
  }
  const record = /** @type {Record<string, unknown>} */ (row)
  const groupId = requireUuid(firstPresent(record, ['modifier_group_id', 'group_id', 'id']), `${field}.group_id`)
  const required = record.required === undefined || record.required === null
    ? null
    : booleanValue(record.required, `${field}.required`)
  const minSelections = nullableIntegerValue(record.min_selections, `${field}.min_selections`)
  const maxSelections = nullableIntegerValue(record.max_selections, `${field}.max_selections`)
  if (minSelections !== null && maxSelections !== null && minSelections > maxSelections) {
    throw new BarLocalAdapterError('CATALOGUE_INCOMPLETE', `${field} has inconsistent selection bounds.`)
  }
  const rawOptions = firstPresent(record, ['options', 'modifier_options', 'modifiers'])
  let options = null
  if (rawOptions !== undefined && rawOptions !== null) {
    if (!Array.isArray(rawOptions)) {
      throw new BarLocalAdapterError('CATALOGUE_INCOMPLETE', `${field}.options is not an array.`)
    }
    const seen = new Set()
    options = rawOptions.map((option, index) => {
      const normalized = normalizeModifierOption(option, `${field}.options[${index}]`, groupId)
      if (seen.has(normalized.option_id)) {
        throw new BarLocalAdapterError('CATALOGUE_DUPLICATE_MODIFIER_OPTION', `${field} contains the same modifier option more than once.`)
      }
      seen.add(normalized.option_id)
      return normalized
    })
  }
  return {
    group_id: groupId,
    code: requireString(record.code, `${field}.code`, { max: 32 }),
    name: requireString(record.name, `${field}.name`, { max: 120 }),
    required,
    min_selections: minSelections,
    max_selections: maxSelections,
    active: record.active === undefined ? true : booleanValue(record.active, `${field}.active`),
    version: optionalIntegerValue(record.version, `${field}.version`, 0),
    options,
    option_ids: options === null ? [] : options.map((option) => option.option_id)
  }
}

/**
 * @param {Record<string, unknown>} record
 * @param {string} field
 * @returns {CatalogueModifierGroup[]|null}
 */
function normalizeProductModifierGroups(record, field) {
  const rawGroups = firstPresent(record, ['modifier_groups', 'modifierGroups', 'modifiers'])
  if (rawGroups === undefined || rawGroups === null) return null
  if (!Array.isArray(rawGroups)) {
    throw new BarLocalAdapterError('CATALOGUE_INCOMPLETE', `${field}.modifier_groups is not an array.`)
  }
  const seen = new Set()
  return rawGroups.map((group, index) => {
    const normalized = normalizeModifierGroup(group, `${field}.modifier_groups[${index}]`)
    if (seen.has(normalized.group_id)) {
      throw new BarLocalAdapterError('CATALOGUE_DUPLICATE_MODIFIER_GROUP', `${field} links the same modifier group more than once.`)
    }
    seen.add(normalized.group_id)
    return normalized
  })
}

/**
 * @param {unknown} row
 * @param {string} field
 * @returns {CatalogueProduct}
 */
function normalizeProduct(row, field) {
  if (row === null || typeof row !== 'object' || Array.isArray(row)) {
    throw new BarLocalAdapterError('CATALOGUE_INCOMPLETE', `${field} is not a product object.`)
  }
  const record = /** @type {Record<string, unknown>} */ (row)
  const category = record.category === undefined || record.category === null
    ? null
    : requireString(record.category, `${field}.category`, { max: 80 })
  const active = record.active === undefined ? true : booleanValue(record.active, `${field}.active`)
  const modifierGroups = normalizeProductModifierGroups(record, field)
  return {
    product_id: requireUuid(record.product_id, `${field}.product_id`),
    sku: requireString(record.sku, `${field}.sku`, { max: 80 }),
    name: requireString(record.name, `${field}.name`, { max: 200 }),
    category,
    price: decimalString(record.price, `${field}.price`),
    tax_rate: decimalString(String(record.tax_rate ?? '0'), `${field}.tax_rate`),
    track_stock: record.track_stock === undefined ? false : booleanValue(record.track_stock, `${field}.track_stock`),
    active,
    available: record.available === undefined ? active : booleanValue(record.available, `${field}.available`),
    version: record.version === undefined ? 0 : requireInteger(record.version, `${field}.version`, { min: 0 }),
    modifier_groups: modifierGroups,
    modifier_group_ids: modifierGroups === null ? [] : modifierGroups.map((group) => group.group_id)
  }
}

/**
 * Validates a single query response before pages are combined.
 * @param {unknown} result
 * @param {number} pageIndex
 * @returns {CatalogueQueryPage}
 */
function normalizePage(result, pageIndex) {
  const field = `catalogue page ${pageIndex + 1}`
  if (result === null || typeof result !== 'object' || Array.isArray(result)) {
    throw new BarLocalAdapterError('CATALOGUE_INCOMPLETE', `${field} is not an object.`)
  }
  const record = /** @type {Record<string, unknown>} */ (result)
  if (!Array.isArray(record.data)) {
    throw new BarLocalAdapterError('CATALOGUE_INCOMPLETE', `${field} did not return a product list.`)
  }
  const pagination = record.pagination
  if (pagination === null || typeof pagination !== 'object' || Array.isArray(pagination)) {
    throw new BarLocalAdapterError('CATALOGUE_INCOMPLETE', `${field} is missing pagination metadata.`)
  }
  const paginationRecord = /** @type {Record<string, unknown>} */ (pagination)
  const nextCursor = paginationRecord.next_cursor === undefined || paginationRecord.next_cursor === null
    ? null
    : requireString(paginationRecord.next_cursor, `${field}.pagination.next_cursor`, { max: 500 })
  const hasMore = booleanValue(paginationRecord.has_more, `${field}.pagination.has_more`)
  if (hasMore && nextCursor === null) {
    throw new BarLocalAdapterError('CATALOGUE_PAGINATION_INVALID', `${field} claims more products without a cursor.`)
  }
  if (record.complete !== true) {
    throw new BarLocalAdapterError('CATALOGUE_INCOMPLETE', `${field} is not a complete snapshot page.`)
  }
  const unavailable = Array.isArray(record.unavailable)
    ? record.unavailable.map((value, index) => requireString(value, `${field}.unavailable[${index}]`, { max: 500 }))
    : null
  if (unavailable === null || unavailable.length > 0) {
    throw new BarLocalAdapterError('CATALOGUE_INCOMPLETE', `${field} reports unavailable sections.`, {
      details: { unavailable: unavailable ?? ['unavailable_metadata_missing'] }
    })
  }
  return {
    data: record.data.map((row, index) => normalizeProduct(row, `${field}.data[${index}]`)),
    pagination: { next_cursor: nextCursor, has_more: hasMore },
    snapshot_watermark: requireInteger(record.snapshot_watermark, `${field}.snapshot_watermark`, { min: 0 }),
    scope: /** @type {Record<string, unknown>} */ (record.scope ?? {}),
    as_of: requireString(record.as_of, `${field}.as_of`, { max: 40 }),
    complete: true,
    unavailable: []
  }
}

/**
 * @param {Record<string, unknown>} scope
 * @returns {string}
 */
function scopeFingerprint(scope) {
  return [scope.business_id, scope.outlet_id, scope.actor_staff_id, scope.role, scope.device_id].join('|')
}

/**
 * Atomically combines validated pages into one snapshot. Pages with different
 * watermarks or scopes are rejected instead of being silently merged.
 * @param {CatalogueQueryPage[]} pages
 * @param {{ previous_snapshot?: CatalogueSnapshot|null, catalogue_version?: number|null }} [options]
 * @returns {CatalogueSnapshot}
 */
export function buildCatalogueSnapshot(pages, options = {}) {
  if (!Array.isArray(pages) || pages.length === 0) {
    throw new BarLocalAdapterError('CATALOGUE_INCOMPLETE', 'A catalogue snapshot needs at least one page.')
  }
  const first = pages[0]
  const expectedScope = scopeFingerprint(first.scope)
  /** @type {CatalogueProduct[]} */
  const products = []
  const seen = new Set()
  for (const [pageIndex, page] of pages.entries()) {
    if (page.snapshot_watermark !== first.snapshot_watermark) {
      throw new BarLocalAdapterError('CATALOGUE_SNAPSHOT_CHANGED', 'The catalogue changed while pages were being loaded; reload the menu.')
    }
    if (scopeFingerprint(page.scope) !== expectedScope) {
      throw new BarLocalAdapterError('CATALOGUE_SNAPSHOT_CHANGED', 'Catalogue pages were returned for a different scope; reload the menu.')
    }
    const lastPage = pageIndex === pages.length - 1
    if (lastPage && page.pagination.has_more) {
      throw new BarLocalAdapterError('CATALOGUE_PAGINATION_INVALID', 'The final catalogue page still claims more products.')
    }
    if (!lastPage && !page.pagination.has_more) {
      throw new BarLocalAdapterError('CATALOGUE_PAGINATION_INVALID', 'Catalogue pagination ended before the final page.')
    }
    for (const product of page.data) {
      if (seen.has(product.product_id)) {
        throw new BarLocalAdapterError('CATALOGUE_DUPLICATE_PRODUCT', 'A product was returned on more than one catalogue page.')
      }
      seen.add(product.product_id)
      products.push(product)
    }
  }
  const previous = options.previous_snapshot ?? null
  const previousIds = previous ? previous.products.filter((product) => product.active).map((product) => product.product_id) : []
  const deleted = previousIds.filter((productId) => !seen.has(productId))
  /** @type {Record<string, CatalogueProduct>} */
  const byId = {}
  for (const product of products) byId[product.product_id] = product
  /** @type {Record<string, CatalogueModifierGroup>} */
  const modifierGroupsById = {}
  /** @type {Record<string, CatalogueModifierOption>} */
  const modifierOptionsById = {}
  /** @type {CatalogueModifierGroup[]} */
  const modifierGroups = []
  /** @type {CatalogueModifierOption[]} */
  const modifierOptions = []
  for (const product of products) {
    if (product.modifier_groups === null || product.modifier_groups === undefined) continue
    for (const group of product.modifier_groups) {
      const groupMetadata = {
        group_id: group.group_id,
        code: group.code,
        name: group.name,
        required: group.required,
        min_selections: group.min_selections,
        max_selections: group.max_selections,
        active: group.active,
        version: group.version
      }
      const existingGroup = modifierGroupsById[group.group_id]
      if (existingGroup) {
        if (hashCanonical(groupMetadata) !== hashCanonical({
          group_id: existingGroup.group_id,
          code: existingGroup.code,
          name: existingGroup.name,
          required: existingGroup.required,
          min_selections: existingGroup.min_selections,
          max_selections: existingGroup.max_selections,
          active: existingGroup.active,
          version: existingGroup.version
        })) {
          throw new BarLocalAdapterError('CATALOGUE_SNAPSHOT_CHANGED', 'A modifier group was returned with conflicting data; reload the menu.')
        }
      } else {
        modifierGroupsById[group.group_id] = group
        modifierGroups.push(group)
      }
      if (
        existingGroup
        && (existingGroup.options === null || existingGroup.options === undefined)
        && group.options !== null
        && group.options !== undefined
      ) {
        const groupIndex = modifierGroups.findIndex((entry) => entry.group_id === group.group_id)
        if (groupIndex >= 0) modifierGroups[groupIndex] = group
        modifierGroupsById[group.group_id] = group
      }
      if (group.options === null || group.options === undefined) continue
      for (const option of group.options) {
        const existingOption = modifierOptionsById[option.option_id]
        if (existingOption) {
          if (hashCanonical(existingOption) !== hashCanonical(option)) {
            throw new BarLocalAdapterError('CATALOGUE_SNAPSHOT_CHANGED', 'A modifier option was returned with conflicting data; reload the menu.')
          }
        } else {
          modifierOptionsById[option.option_id] = option
          modifierOptions.push(option)
        }
      }
    }
  }
  const snapshot = {
    products,
    product_ids: products.map((product) => product.product_id),
    by_id: byId,
    available_product_ids: products.filter((product) => product.active && product.available).map((product) => product.product_id),
    unavailable_product_ids: products.filter((product) => product.active && !product.available).map((product) => product.product_id),
    inactive_product_ids: products.filter((product) => !product.active).map((product) => product.product_id),
    deleted_product_ids: deleted,
    modifier_groups: modifierGroups,
    modifier_group_ids: modifierGroups.map((group) => group.group_id),
    modifier_groups_by_id: modifierGroupsById,
    modifier_options: modifierOptions,
    modifier_option_ids: modifierOptions.map((option) => option.option_id),
    modifier_options_by_id: modifierOptionsById,
    empty: products.length === 0,
    complete: true,
    snapshot_watermark: first.snapshot_watermark,
    catalogue_version: options.catalogue_version ?? null,
    page_count: pages.length,
    as_of: first.as_of,
    scope: first.scope,
    hash: hashCanonical({
      snapshot_watermark: first.snapshot_watermark,
      catalogue_version: options.catalogue_version ?? null,
      products: products.map((product) => ({
        product_id: product.product_id,
        sku: product.sku,
        price: product.price,
        tax_rate: product.tax_rate,
        active: product.active,
        available: product.available,
        version: product.version,
        ...(product.modifier_groups === null || product.modifier_groups === undefined
          ? {}
          : {
              modifier_groups: product.modifier_groups.map((group) => ({
                group_id: group.group_id,
                code: group.code,
                name: group.name,
                required: group.required,
                min_selections: group.min_selections,
                max_selections: group.max_selections,
                active: group.active,
                version: group.version,
                options: group.options === null || group.options === undefined
                  ? null
                  : group.options.map((option) => ({
                      option_id: option.option_id,
                      code: option.code,
                      name: option.name,
                      price_delta: option.price_delta,
                      active: option.active,
                      sort_order: option.sort_order,
                      version: option.version
                    }))
              }))
            })
      }))
    })
  }
  return Object.freeze(snapshot)
}

/**
 * Loads every page through the allowlisted query interface and assembles one
 * snapshot. An empty menu is valid; truncation, gaps and mixed versions are not.
 * @param {(queryName: string, filters: Record<string, unknown>) => Promise<unknown>} queryFn
 * @param {{
 *   filters?: Record<string, unknown>,
 *   query_name?: string,
 *   page_size?: number,
 *   max_pages?: number,
 *   previous_snapshot?: CatalogueSnapshot|null,
 *   catalogue_version?: number|null
 * }} [options]
 * @returns {Promise<CatalogueSnapshot>}
 */
export async function loadCatalogueSnapshot(queryFn, options = {}) {
  const queryName = options.query_name ?? 'menu.availability'
  const pageSize = requireInteger(options.page_size ?? 200, 'page_size', { min: 1, max: 1000 })
  const maxPages = requireInteger(options.max_pages ?? 1000, 'max_pages', { min: 1, max: 10000 })
  const filters = options.filters ?? {}
  /** @type {CatalogueQueryPage[]} */
  const pages = []
  let cursor = null
  for (let pageIndex = 0; pageIndex < maxPages; pageIndex += 1) {
    const pageFilters = { ...filters, limit: pageSize }
    if (cursor !== null) pageFilters.cursor = cursor
    const result = await queryFn(queryName, pageFilters)
    const page = normalizePage(result, pageIndex)
    pages.push(page)
    if (!page.pagination.has_more) {
      return buildCatalogueSnapshot(pages, {
        previous_snapshot: options.previous_snapshot ?? null,
        catalogue_version: options.catalogue_version ?? null
      })
    }
    const nextCursor = page.pagination.next_cursor
    if (nextCursor === null || nextCursor === cursor || page.data.length === 0) {
      throw new BarLocalAdapterError('CATALOGUE_PAGINATION_INVALID', 'Catalogue pagination did not advance; reload the menu.')
    }
    cursor = nextCursor
  }
  throw new BarLocalAdapterError('CATALOGUE_LIMIT_EXCEEDED', 'The catalogue exceeded the configured page budget; use a full export instead.')
}

/**
 * @param {unknown} value
 * @returns {number|null}
 */
function moneyNumber(value) {
  if (typeof value === 'string' && DECIMAL_RE.test(value)) return Number(value)
  if (typeof value === 'number' && Number.isFinite(value)) return value
  return null
}

/**
 * @param {unknown} value
 * @param {string} field
 * @returns {string[]}
 */
function selectedModifierIds(value, field) {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value)) {
    throw new BarLocalAdapterError('VALIDATION_FAILED', `${field} must be an array of modifier option identifiers.`)
  }
  return value.map((entry, index) => {
    if (typeof entry === 'string') return requireUuid(entry, `${field}[${index}]`)
    if (entry !== null && typeof entry === 'object' && !Array.isArray(entry)) {
      const record = /** @type {Record<string, unknown>} */ (entry)
      return requireUuid(
        firstPresent(record, ['option_id', 'modifier_option_id', 'id']),
        `${field}[${index}].option_id`
      )
    }
    throw new BarLocalAdapterError('VALIDATION_FAILED', `${field}[${index}] is not a modifier option identifier.`)
  })
}

/**
 * Validates modifier selections against the product's exposed modifier groups.
 * Products whose snapshot omits modifier data keep their previous behaviour.
 * @param {Record<string, unknown>} item
 * @param {CatalogueProduct} product
 * @param {CatalogueSnapshot} snapshot
 * @param {number} index
 * @param {string[]} reasons
 * @param {Array<Record<string, unknown>>} items
 */
function checkItemModifiers(item, product, snapshot, index, reasons, items) {
  if (product.modifier_groups === null || product.modifier_groups === undefined) return
  const selectedIds = selectedModifierIds(item.modifiers, `cart.items[${index}].modifiers`)
  const linkedGroupIds = new Set(product.modifier_group_ids)
  const allGroupsExposeOptions = product.modifier_groups.every(
    (group) => group.options !== null && group.options !== undefined
  )
  /** @type {Map<string, number>} */
  const selectedCounts = new Map()
  const seenOptions = new Set()
  for (const optionId of selectedIds) {
    if (seenOptions.has(optionId)) {
      reasons.push('modifier_duplicate')
      items.push({ product_id: product.product_id, reason: 'modifier_duplicate', option_id: optionId })
      continue
    }
    seenOptions.add(optionId)
    const option = snapshot.modifier_options_by_id[optionId]
    if (!option) {
      if (allGroupsExposeOptions) {
        reasons.push('modifier_unknown')
        items.push({ product_id: product.product_id, reason: 'modifier_unknown', option_id: optionId })
      }
      continue
    }
    if (!linkedGroupIds.has(option.group_id)) {
      reasons.push('modifier_not_for_product')
      items.push({ product_id: product.product_id, reason: 'modifier_not_for_product', option_id: optionId })
      continue
    }
    const group = snapshot.modifier_groups_by_id[option.group_id]
    if (!option.active || group === undefined || !group.active) {
      reasons.push('modifier_unavailable')
      items.push({ product_id: product.product_id, reason: 'modifier_unavailable', option_id: optionId })
      continue
    }
    selectedCounts.set(option.group_id, (selectedCounts.get(option.group_id) ?? 0) + 1)
  }
  for (const group of product.modifier_groups) {
    if (group.options === null || group.options === undefined || !group.active) continue
    const selected = selectedCounts.get(group.group_id) ?? 0
    const minimum = group.required === true
      ? Math.max(1, group.min_selections ?? 0)
      : group.min_selections ?? 0
    if (minimum > 0 && selected < minimum) {
      const reason = selected === 0 && group.required === true ? 'modifier_required' : 'modifier_min_selections'
      reasons.push(reason)
      items.push({
        product_id: product.product_id,
        reason,
        group_id: group.group_id,
        selected,
        min_selections: minimum
      })
    }
    if (group.max_selections !== null && selected > group.max_selections) {
      reasons.push('modifier_max_selections')
      items.push({
        product_id: product.product_id,
        reason: 'modifier_max_selections',
        group_id: group.group_id,
        selected,
        max_selections: group.max_selections
      })
    }
  }
}

/**
 * Detects whether an already-built cart or tab is stale against a snapshot.
 * Detection never silently reprices; it tells the operator to reconfirm.
 * @param {unknown} cart
 * @param {CatalogueSnapshot} snapshot
 * @returns {{
 *   stale: boolean,
 *   requires_repricing: boolean,
 *   catalogue_version: number|null,
 *   cart_catalogue_version: number|null,
 *   reasons: string[],
 *   items: Array<Record<string, unknown>>
 * }}
 */
export function checkCartAgainstSnapshot(cart, snapshot) {
  if (cart === null || typeof cart !== 'object' || Array.isArray(cart)) {
    throw new BarLocalAdapterError('VALIDATION_FAILED', 'The cart must be an object.')
  }
  const record = /** @type {Record<string, unknown>} */ (cart)
  if (!Array.isArray(record.items)) {
    throw new BarLocalAdapterError('VALIDATION_FAILED', 'The cart must contain an items array.')
  }
  const cartVersion = record.catalogue_version === undefined || record.catalogue_version === null
    ? null
    : requireInteger(record.catalogue_version, 'cart.catalogue_version', { min: 0 })
  /** @type {string[]} */
  const reasons = []
  let requiresRepricing = false
  if (
    cartVersion !== null
    && snapshot.catalogue_version !== null
    && cartVersion !== snapshot.catalogue_version
  ) {
    reasons.push('catalogue_version_changed')
    requiresRepricing = true
  }
  /** @type {Array<Record<string, unknown>>} */
  const items = []
  for (const [index, rawItem] of record.items.entries()) {
    if (rawItem === null || typeof rawItem !== 'object' || Array.isArray(rawItem)) {
      throw new BarLocalAdapterError('VALIDATION_FAILED', `cart.items[${index}] must be an object.`)
    }
    const item = /** @type {Record<string, unknown>} */ (rawItem)
    const productId = requireUuid(item.product_id, `cart.items[${index}].product_id`)
    const current = snapshot.by_id[productId]
    if (!current) {
      reasons.push('product_deleted')
      items.push({ product_id: productId, reason: 'product_deleted' })
      continue
    }
    if (!current.active) {
      reasons.push('product_inactive')
      items.push({ product_id: productId, reason: 'product_inactive' })
      continue
    }
    if (!current.available) {
      reasons.push('product_unavailable')
      items.push({ product_id: productId, reason: 'product_unavailable' })
      continue
    }
    if (item.version !== undefined && item.version !== null) {
      const expectedVersion = requireInteger(item.version, `cart.items[${index}].version`, { min: 0 })
      if (expectedVersion !== current.version) {
        reasons.push('product_version_changed')
        items.push({
          product_id: productId,
          reason: 'product_version_changed',
          expected_version: expectedVersion,
          current_version: current.version
        })
      }
    }
    if (item.unit_price !== undefined && item.unit_price !== null) {
      const expectedPrice = moneyNumber(item.unit_price)
      const currentPrice = moneyNumber(current.price)
      if (expectedPrice === null) {
        throw new BarLocalAdapterError('VALIDATION_FAILED', `cart.items[${index}].unit_price is not a decimal amount.`)
      }
      if (currentPrice === null || expectedPrice !== currentPrice) {
        reasons.push('price_changed')
        requiresRepricing = true
        items.push({
          product_id: productId,
          reason: 'price_changed',
          expected_price: item.unit_price,
          current_price: current.price
        })
      }
    }
    checkItemModifiers(item, current, snapshot, index, reasons, items)
  }
  const uniqueReasons = Array.from(new Set(reasons))
  return {
    stale: uniqueReasons.length > 0,
    requires_repricing: requiresRepricing,
    catalogue_version: snapshot.catalogue_version,
    cart_catalogue_version: cartVersion,
    reasons: uniqueReasons,
    items
  }
}
