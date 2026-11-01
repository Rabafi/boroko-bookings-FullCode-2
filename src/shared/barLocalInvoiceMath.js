// @ts-check
/** @param {unknown} input @param {number} scale */
function units(input,scale){
 const value=String(input??'').trim()
 const match=/^(0|[1-9]\d{0,11})(?:\.(\d+))?$/.exec(value)
 if(!match||(match[2]?.length??0)>scale)throw new Error(`Enter a non-negative decimal with at most ${scale} decimal places.`)
 return BigInt(match[1])*10n**BigInt(scale)+BigInt((match[2]??'').padEnd(scale,'0')||'0')
}
/** @param {bigint} value */
function money(value){return `${value/100n}.${String(value%100n).padStart(2,'0')}`}
/**
 * Display/request estimates only; the database independently verifies each line.
 * @param {Array<{quantity:unknown,unit_price:unknown,tax_rate?:unknown}>} lines
 */
export function estimateLocalInvoice(lines){
 let subtotal=0n,tax=0n
 if(!lines.length)throw new Error('Add at least one invoice line.')
 for(const line of lines){
  const quantity=units(line.quantity,6),price=units(line.unit_price,2),rate=units(line.tax_rate??'0',4)
  if(quantity<=0n||rate>10000n)throw new Error('Quantity must be positive and tax rate must be between zero and one.')
  const base=(quantity*price+500000n)/1000000n
  subtotal+=base;tax+=(base*rate+5000n)/10000n
 }
 if(subtotal+tax>99999999999999n)throw new Error('Invoice total exceeds the supported local money range.')
 return {subtotal:money(subtotal),tax_total:money(tax),total:money(subtotal+tax)}
}
