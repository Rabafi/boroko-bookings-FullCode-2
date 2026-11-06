// @ts-check
import { loadCompleteBarList } from '../../../../../shared/barLocalPagination.js'
import { estimateBarCashSale, exceedsDiscountMaximum, isDiscountApprovalRequired, validateBarPromotionSnapshot } from '../../../../../shared/barLocalCashEstimate.js'
import { centsToMoney, evaluateTenders, moneyToCents } from './tenderMath.js'

/** @param {any[]} cart @param {any[]} menu @param {any} [promotion] @param {boolean} [requireChoices] */
export function estimateNativeHposTill(cart, menu, promotion = null, requireChoices = false) {
  return estimateBarCashSale(cart.map((line) => {
    const product = menu.find((row) => row.id === line.menu_item_id || row.product_id === line.menu_item_id)
    if (!product || product.tax_rate == null) throw new Error('The current product price and tax could not be verified. Refresh the Till.')
    return { quantity: Number(line.quantity), modifiers: (line.modifiers || []).map((option) => String(option.id || option.modifier_option_id)),
      product: { product_id: product.product_id || product.id, category: product.category, price: String(line.base_unit_price ?? line.unit_price),
        tax_rate: String(product.tax_rate), modifier_groups: (product.modifier_groups || []).map((group) => ({ ...group,
          min_selections: requireChoices ? group.min_selections : 0, required: requireChoices && group.required })) } }
  }), promotion?._barLocalPromotion || promotion)
}

/** Render only values from the committed service receipt; input basket totals
 * are deliberately absent from this projection. @param {any} receipt */
export function nativeHposReceipt(receipt) {
  receipt = receipt?.receipt || receipt
  if (!receipt?.sale_id || !receipt.receipt_number || !Array.isArray(receipt.lines) || !Array.isArray(receipt.tenders)
    || receipt.total == null || receipt.tax == null) throw new Error('The saved operation has no complete sale receipt. Resolve it in Sales before starting another sale.')
  return { success: true, id: receipt.sale_id, receipt_number: receipt.receipt_number, created_at: receipt.created_at,
    server_received_at: receipt.created_at, total: receipt.total, gross_total: receipt.subtotal,
    tax_total: receipt.tax, discount_total: receipt.discount, tip_total: receipt.tip,
    walk_in_name: 'Counter', _authority_mode: 'bar_local',
    items: receipt.lines.map((line) => ({ ...line, id: line.sale_line_id, item_name: line.name,
      subtotal: line.line_subtotal, net_subtotal: line.line_subtotal, gross_subtotal: line.line_subtotal })),
    payment_breakdown: receipt.tenders.map((row) => ({ ...row, method: row.method === 'customer_credit' ? 'account' : row.method })),
    change_due: receipt.change ?? centsToMoney(receipt.tenders.reduce((sum, row) => {
      const change = moneyToCents(row.change ?? '0')
      if (change === null || !Number.isSafeInteger(sum + change)) throw new Error('The saved receipt has an invalid change amount. Resolve it in Sales.')
      return sum + change
    }, 0)) }
}

/** Narrow compatibility for counter sales in the original Till. Open-tab
 * management remains on the local Open tabs route. @param {any} bridge @param {any} user @returns {any} */
export function createLocalHposTillApi(bridge, user) {
  let menu = []
  let promotions = []
  let discountPolicy = null
  const checked = (result) => {
    if (result?.complete !== true || result.unavailable?.length) throw new Error('The local Bar read is incomplete. Refresh before trading.')
    return result.data
  }
  const loadMenu = async () => {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const snapshot = await bridge.getCatalogueSnapshot()
      const native = await bridge.readHposMenu('menu')
      if (snapshot?.complete !== true || !Array.isArray(snapshot.products) || native?.complete !== true || !Array.isArray(native.rows)) {
        throw new Error('The local Till catalogue is incomplete. Refresh before trading.')
      }
      const proof = `${snapshot.snapshot_watermark}|${snapshot.scope?.business_id}|${snapshot.scope?.outlet_id}`
      if (native.snapshot !== proof) continue
      const byId = new Map(snapshot.products.map((row) => [row.product_id, row]))
      menu = native.rows.filter((row) => row.archived_at == null).map((row) => {
        const product = byId.get(row.id)
        if (!product) throw new Error('The local Till product snapshots do not match. Refresh before trading.')
        return { ...row, product_id: row.id, modifier_groups: product.modifier_groups || [], product_version: product.version }
      })
      return menu
    }
    throw new Error('The local menu changed while loading. Refresh the Till before trading.')
  }
  const loadPromotions = async () => {
    const result = await bridge.query('menu.promotions', {})
    const verified = validateBarPromotionSnapshot(result, result.scope?.business_id, result.scope?.outlet_id)
    discountPolicy = verified.discountPolicy
    promotions = verified.promotions.map((row) => ({ ...row, id: row.promotion_id, active: true,
      discount_value: row.discount_type === 'percent' ? row.percent : row.amount,
      minimum_spend: row.minimum_subtotal, applies_to_category: row.scope === 'category' ? row.category : 'All', _barLocalPromotion: row }))
    return promotions
  }
  const outcome = (result) => {
    if (result?.outcome === 'committed_local') return nativeHposReceipt(result.result || result.receipt)
    if (result?.outcome === 'unknown') throw new Error('The sale outcome is unknown. Retry the original saved operation before taking another payment.')
    return { success: false, code: result?.error?.code || 'LOCAL_COMMAND_REFUSED', error: result?.error?.message || 'The local Bar service refused this sale.' }
  }
  const getCurrentShift = async () => {
    const shift = checked(await bridge.query('shift.current', {}))
    return shift?.status === 'open' ? { ...shift, id: shift.shift_id } : null
  }
  return {
    outlets: { getAll: async () => (await bridge.readHposMenu('outlets')).rows },
    inventory: {
      getItems: async () => (await bridge.readHposMenu('stock')).rows,
      getLowStock: async () => (await bridge.readHposMenu('stock')).rows.filter((row) => Number(row.current_stock) <= Number(row.reorder_level))
    },
    pos: {
      getMenuItems: loadMenu,
      getCustomers: async () => loadCompleteBarList((name, filters) => bridge.query(name, filters), 'customers.list'),
      getPromotions: loadPromotions,
      getStaff: async () => [user],
      getTabs: async () => [], getRecipes: async () => [], getTablesWithStatus: async () => [],
      getHardwareSettings: async () => ({ auto_print_receipts: false, cash_drawer_open_on_cash: false, payment_terminal_enabled: false }),
      getUnconfirmedPosUsage: async () => ({ usage: {}, orderCount: 0, meshOrderCount: 0, meshDeliveryCount: 0 }),
      getCurrentShift,
      getActiveShifts: async () => { const shift = await getCurrentShift();return shift ? [shift] : [] },
      getMenuStockReadiness: async () => {
        const readiness = await bridge.refreshReadiness()
        if (readiness?.ready !== true) throw new Error(`The local Bar is not ready to trade. ${(readiness?.blockers || []).join(' ')}`)
        const rows = await loadMenu()
        return { success: true, rows: rows.map((row) => ({ menu_item_id: row.id,
          readiness: row.stock_method === 'non_stock' ? 'non_stock' : row.stock_method === 'recipe' ? 'recipe' : 'direct',
          on_hand: row.inventory_item_id ? row.stock_quantity : null, stock_unit: row.unit || 'each' })) }
      },
      getModifierGroups: async () => {
        if (!menu.length) await loadMenu()
        const groups = new Map()
        for (const product of menu) for (const group of product.modifier_groups || []) {
          const id = group.group_id || group.modifier_group_id
          if (!groups.has(id)) groups.set(id, { ...group, id, menu_item_ids: [], applies_to_categories: [],
            options: (group.options || []).map((option) => ({ ...option, id: option.option_id || option.modifier_option_id })) })
          groups.get(id).menu_item_ids.push(product.id)
        }
        return [...groups.values()]
      },
      getPendingPosSubmitAttempt: async () => {
        const open = await bridge.getOpenIntents()
        if (!Array.isArray(open)) throw new Error('Saved local operations could not be checked. Selling remains paused.')
        if (!open.length) return { success: true, resolved: false }
        const first = open[0]
        if (first.command !== 'sale.commit') return { success: false, error: `Resolve saved ${first.command} operation ${first.operation_id} in its local workflow before selling.` }
        return { success: true, resolved: false, submitIntentId: first.operation_id, orderId: first.operation_id, createdAtClient: first.created_at,
          payload: { id: first.operation_id, submit_intent_id: first.operation_id, __barLocalSaleRecovery: true, items: [] } }
      },
      openShift: async (request) => {
        const open = await bridge.getOpenIntents()
        if (!Array.isArray(open)) throw new Error('Saved local operations could not be checked. The shift was not opened.')
        const pending = open.find((intent) => intent.command === 'shift.open')
        let result
        if (pending) {
          // Reuse the journaled opening attempt and its original payload. A
          // changed float cannot be attached to an ambiguous operation ID.
          result = await bridge.retryOperation(pending.operation_id)
        } else {
          result = await bridge.command({ command: 'shift.open', operation_id: crypto.randomUUID(), payload: { opening_float: String(request.opening_float) } })
        }
        if (result?.outcome === 'unknown') throw new Error('The shift outcome is unknown. Retry this saved opening attempt before starting another shift.')
        return result?.outcome === 'committed_local' ? { success: true, shift: await getCurrentShift() }
          : { success: false, error: result?.error?.message || 'The local Bar refused to open this shift.' }
      },
      createOrder: async (request, approvalPin = '') => {
        const operationId = request.submit_intent_id || request.id
        if (!operationId) throw new Error('A stable sale operation ID is required.')
        if (request.__barLocalSaleRecovery === true) return outcome(await bridge.retryOperation(operationId))
        // Receipt recovery precedes all current-state/price checks. A committed
        // sale must replay after a price change or shift close.
        try {
          const saved = await bridge.getOperation(operationId)
          if (saved.status === 'committed') return nativeHposReceipt(saved.receipt || saved.result)
          if (saved.status === 'refused') return { success: false, code: saved.error?.code, error: saved.error?.message }
          return outcome(await bridge.retryOperation(operationId))
        } catch (cause) { if (cause?.code !== 'OPERATION_NOT_FOUND') throw cause }
        if (request.tab_id || request.resolve_tab) throw new Error('Use Open tabs to settle a local tab. This counter sale was not sent.')
        const readiness = await bridge.refreshReadiness()
        if (readiness?.ready !== true) throw new Error('The local Bar is not ready. Refresh System health before taking payment.')
        await loadMenu();await loadPromotions()
        for (const line of request.items || []) {
          const product = menu.find((row) => row.id === line.menu_item_id)
          if (!product || product.is_available !== true || moneyToCents(line.base_unit_price ?? line.unit_price) !== moneyToCents(product.price)) {
            return { success: false, code: 'catalog_refresh_required', error: 'The product price or availability changed. Refresh and rebuild this sale.' }
          }
        }
        const promotion = request.promotion_id ? promotions.find((row) => row.id === request.promotion_id) : null
        if (request.promotion_id && !promotion) return { success: false, error: 'The selected promotion is no longer active. Refresh before taking payment.' }
        const estimate = estimateNativeHposTill(request.items, menu, promotion, true)
        const tipCents = moneyToCents(request.tip_total ?? '0')
        if (tipCents === null) throw new Error('The tip must use whole cents.')
        const due = Number(estimate.totalCents) + tipCents
        if (!Number.isSafeInteger(due) || moneyToCents(request.total) !== due) return { success: false, code: 'catalog_refresh_required', error: 'The local amount due changed. Refresh the sale before taking payment.' }
        const rows = (request.payment_breakdown || []).map((row) => ({ ...row,
          method: row.method === 'account' ? 'customer_credit' : row.method,
          amount: String(row.amount), tendered: row.method === 'cash' ? String(request.cash_received ?? row.amount) : '',
          provider_status: ['card', 'mobile_money', 'bank_transfer', 'external'].includes(row.method) ? 'locally_asserted' : 'not_applicable',
          customer_id: row.customer_id || request.customer_id || '', voucher_code: row.voucher_code || '' }))
        const tenders = evaluateTenders({ totalCents: due, rows })
        if (tenders.error) throw new Error(tenders.error)
        if (!discountPolicy || exceedsDiscountMaximum(estimate.promotionDiscountCents, estimate.subtotalCents, discountPolicy.maximum_percent)) {
          return { success: false, error: 'This discount exceeds the local Bar policy. Review the promotion with a manager.' }
        }
        /** @type {Record<string, any>} */
        let payload = { shift_id: request.shift_id, items: request.items.map((line) => ({ product_id: line.menu_item_id,
          quantity: String(line.quantity), modifiers: (line.modifiers || []).map((option) => String(option.id || option.modifier_option_id)), notes: line.item_notes || null })),
          tenders: tenders.tenders, discount_amount: '0', tip_amount: centsToMoney(tipCents),
          customer_id: request.customer_id || null, promotion_code: promotion?.code || null }
        if (isDiscountApprovalRequired(estimate.promotionDiscountCents, estimate.subtotalCents, discountPolicy.approval_threshold_percent)) {
          if (!/^\d{4,12}$/.test(approvalPin)) return { success: false, code: 'APPROVAL_REQUIRED', error: 'A different authorised manager must approve this promotion with their PIN.' }
          const approval = await bridge.requestApprovalForCommand({ command: 'sale.commit', payload, operation_id: operationId, pin: approvalPin })
          if (!approval?.approval_id) throw new Error('Manager approval was not confirmed. No sale was submitted.')
          payload = { ...payload, approval_id: approval.approval_id }
        }
        return outcome(await bridge.command({ command: 'sale.commit', operation_id: operationId, payload }))
      },
      saveTab: async () => { throw new Error('Open and change local tabs from Open tabs.') }
    }
  }
}
