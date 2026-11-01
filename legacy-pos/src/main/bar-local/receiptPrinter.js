const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Re-read a sale through the authenticated local authority before sending it
 * to a printer. The renderer may identify a sale, but never supplies receipt
 * amounts or line content to the hardware adapter.
 * @param {{runtime: {query: (name: string, filters: Record<string, unknown>) => Promise<Record<string, unknown>>}, saleId: string, settings: Record<string, unknown>, printer: (request: Record<string, unknown>) => Promise<Record<string, unknown>>}} options
 */
export async function printVerifiedLocalBarReceipt({ runtime, saleId, settings, printer }) {
  if (typeof saleId !== 'string' || !UUID_RE.test(saleId)) {
    throw new Error('A valid local sale ID is required to print a receipt.');
  }
  const response = await runtime.query('sale.get', { sale_id: saleId });
  const receipt = response?.complete === true ? response.data : null;
  if (!receipt || receipt.sale_id !== saleId || !Number.isSafeInteger(Number(receipt.receipt_number))
    || Number(receipt.receipt_number) < 1 || !Number.isFinite(Number(receipt.total))
    || !Array.isArray(receipt.lines) || !Array.isArray(receipt.tenders)) {
    throw new Error('The local authority did not return a complete verified receipt. Printing was not attempted.');
  }

  return printer({
    order: {
      receipt_number: receipt.receipt_number,
      created_at: receipt.created_at,
      gross_total: receipt.total,
      total: receipt.total,
      discount_amount: receipt.discount,
      tax_amount: receipt.tax,
      tip_amount: receipt.tip,
      payment_method: receipt.tenders[0]?.method || 'cash',
      payment_breakdown: receipt.tenders.map((tender) => ({ method: tender.method, amount: tender.amount })),
      pos_order_items: receipt.lines.map((line) => ({
        item_name: line.name,
        quantity: line.quantity,
        unit_price: line.unit_price,
        line_total: line.line_total,
        modifiers: line.modifiers
      }))
    },
    business: { company_name: 'Tsa Bonno Local Bar', currency: 'BWP' },
    settings,
    openDrawer: false
  });
}
