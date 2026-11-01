import test from 'node:test'
import assert from 'node:assert/strict'
import {estimateLocalInvoice} from '../../src/shared/barLocalInvoiceMath.js'
test('invoice estimates round quantity multiplication and tax per line with exact decimal arithmetic',()=>{
 assert.deepEqual(estimateLocalInvoice([{quantity:'0.333333',unit_price:'9.99',tax_rate:'0.14'}]),{subtotal:'3.33',tax_total:'0.47',total:'3.80'})
 assert.deepEqual(estimateLocalInvoice([{quantity:'1',unit_price:'0.05',tax_rate:'0.10'},{quantity:'1',unit_price:'0.05',tax_rate:'0.10'}]),{subtotal:'0.10',tax_total:'0.02',total:'0.12'})
 assert.deepEqual(estimateLocalInvoice([{quantity:'1',unit_price:'999999999999.99',tax_rate:'0'}]),{subtotal:'999999999999.99',tax_total:'0.00',total:'999999999999.99'})
})
test('invoice estimates reject invalid precision, overflow, zero quantity and out-of-range tax',()=>{
 for(const row of [{quantity:'0',unit_price:'1'},{quantity:'1',unit_price:'0.001'},{quantity:'1',unit_price:'1',tax_rate:'1.0001'},{quantity:'1e3',unit_price:'1'},{quantity:'999999999999',unit_price:'999999999999'}])assert.throws(()=>estimateLocalInvoice([row]))
 assert.throws(()=>estimateLocalInvoice([]))
})
