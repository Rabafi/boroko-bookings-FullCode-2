import test from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {mkdtempSync,rmSync} from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {createApiHarness} from './api-harness.mjs'
import {TEST_SETUP_SECRET} from './harness.mjs'
import {hashPin} from '../dist/pin.js'
import {createModernBarLocalAdapter} from '../../../src/main/bar-local/index.js'
import {LegacyBarLocalClient} from '../../../legacy-pos/src/main/bar-local/client.js'
import {IntentJournal} from '../../../legacy-pos/src/main/bar-local/intents.js'

test('actual Modern and Legacy PIN-only approvals bind the other authenticated operator and reject revoked or ambiguous identities',async t=>{
 const h=await createApiHarness(t)
 const dir=mkdtempSync(path.join(os.tmpdir(),'bar-approval-identity-'));t.after(()=>rmSync(dir,{recursive:true,force:true}))
 const setup=await h.request('/v1/setup/owner',{body:{setup_secret:TEST_SETUP_SECRET,business_name:'Approval identity fixture',outlet_name:'Main',owner_name:'Owner',pin:'1234',device_name:'Synthetic till'}})
 assert.equal(setup.status,201,JSON.stringify(setup.body));const s={...setup.body,device_token:setup.stagedDeviceToken}
 const insertManager=async(name,pin)=>{
  const verifier=hashPin(pin,100000)
  return (await h.migrator.query(`INSERT INTO bar_local.staff(business_id,display_name,role,capabilities,pin_hash,pin_salt,pin_iterations)
   VALUES($1,$2,'manager',ARRAY['pos.view','pos.manage','pos.void','pos.cashup'],$3,$4,$5) RETURNING id`,[s.business_id,name,verifier.pin_hash,verifier.pin_salt,verifier.pin_iterations])).rows[0].id
 }
 const manager=await insertManager('Distinct approver','5678')
 const adapter=createModernBarLocalAdapter({authority_config:{authority_mode:'bar_local',product:'hospitality-pos',business_id:s.business_id,outlet_ids:[s.outlet_id],active_outlet_id:s.outlet_id,authority_id:s.authority_id,authority_epoch:s.authority_epoch,commissioning_id:'isolated',base_url:h.baseUrl},journal_options:{filePath:path.join(dir,'modern.jsonl')},device_credential:{device_id:s.device_id,device_token:s.device_token}})
 t.after(()=>adapter.close());const modern=adapter.requireClient()
 await modern.login({staff_id:s.owner_staff_id,pin:'1234'})
 const product=await modern.command({command:'catalogue.upsert',payload:{sku:'APPROVAL-ITEM',name:'Synthetic item',price:'10.00',tax_rate:'0',track_stock:false}})
 await modern.healthReady()
 const shift=await modern.command({command:'shift.open',payload:{opening_float:'0.00'}})
 const salePayload={shift_id:shift.result.shift_id,items:[{product_id:product.result.product_id,quantity:'1'}],tenders:[{method:'cash',amount:'10.00',tendered:'10.00'}]}
 const sale=await modern.command({command:'sale.commit',payload:salePayload})
 const payload={sale_id:sale.result.sale_id,reason:'Synthetic approved correction'}
 const operationId=randomUUID()
 const proof=await modern.requestApprovalForCommand({command:'sale.void',payload,pin:'5678',operation_id:operationId})
 const identity=(await h.migrator.query('SELECT approved_by,operation_hash FROM bar_local.approvals WHERE id=$1',[proof.approval_id])).rows[0]
 assert.equal(identity.approved_by,manager)
 assert.equal(proof.operation_hash,identity.operation_hash)
 assert.equal(modern.session.staff.staff_id,s.owner_staff_id,'approval must not replace the cashier session')
 assert.equal((await h.migrator.query('SELECT count(*)::int AS n FROM bar_local.sessions WHERE staff_id=$1 AND revoked_at IS NULL',[manager])).rows[0].n,0,'temporary approver credential must be revoked')
 const corrected=await modern.command({command:'sale.void',payload:{...payload,approval_id:proof.approval_id},operation_id:operationId})
 assert.equal(corrected.outcome,'committed_local')
 const cashAfterVoid=await modern.query('cashup.summary',{shift_id:shift.result.shift_id})
 assert.equal(Number(cashAfterVoid.data.expected_cash),0,'a cash sale and its void must cancel in the drawer')
 assert.equal(Number(cashAfterVoid.data.cash_sales),0,'the summary includes both original and signed reversal tenders')
 const legacy=new LegacyBarLocalClient({scope:{authority_id:s.authority_id,authority_epoch:s.authority_epoch,business_id:s.business_id,outlet_id:s.outlet_id,device_id:s.device_id,deviceToken:s.device_token},baseUrl:h.baseUrl,journal:new IntentJournal({filePath:path.join(dir,'legacy.jsonl')})})
 t.after(()=>legacy.transport.close());await legacy.login(s.owner_staff_id,'1234')
 await legacy.login(manager,'5678')
 const outgoing=await legacy.command('shift.open',{opening_float:'100.00'})
 await legacy.login(s.owner_staff_id,'1234')
 const handover={shift_id:shift.result.shift_id,source_shift_id:outgoing.result.shift_id,type:'handover',amount:'30.00',reason:'Counted handover through actual clients',receiver_confirmed:true}
 const handoverId=randomUUID()
 const handoverProof=await modern.requestApprovalForCommand({command:'drawer.movement',payload:handover,pin:'5678',operation_id:handoverId})
 const received=await modern.command({command:'drawer.movement',payload:{...handover,approval_id:handoverProof.approval_id},operation_id:handoverId})
 assert.equal(received.outcome,'committed_local');assert.equal(received.result.source_expected_cash,'70.00');assert.equal(received.result.receiver_expected_cash,'30.00')
 await legacy.login(manager,'5678')
 const returnCash={shift_id:outgoing.result.shift_id,source_shift_id:shift.result.shift_id,type:'handover',amount:'10.00',reason:'Legacy receiving counted cash',receiver_confirmed:true}
 const returnId=randomUUID(),returnProof=await legacy.requestApproval('drawer.movement',returnCash,'1234',{operationId:returnId})
 const legacyReceived=await legacy.command('drawer.movement',{...returnCash,approval_id:returnProof.approval_id},{operationId:returnId})
 assert.equal(legacyReceived.outcome,'committed_local');assert.equal(legacyReceived.result.source_expected_cash,'20.00');assert.equal(legacyReceived.result.receiver_expected_cash,'80.00')
 await legacy.login(s.owner_staff_id,'1234')
 const second=await legacy.command('sale.commit',salePayload)
 const legacyPayload={sale_id:second.result.sale_id,reason:'Legacy approved correction'},legacyId=randomUUID()
 const legacyProof=await legacy.requestApproval('sale.void',legacyPayload,'5678',{operationId:legacyId})
 assert.equal((await h.migrator.query('SELECT approved_by FROM bar_local.approvals WHERE id=$1',[legacyProof.approval_id])).rows[0].approved_by,manager)
 assert.equal((await legacy.command('sale.void',{...legacyPayload,approval_id:legacyProof.approval_id},{operationId:legacyId})).outcome,'committed_local')
 const partialSale=await legacy.command('sale.commit',salePayload)
 const detail=await legacy.query('sale.get',{sale_id:partialSale.result.sale_id})
 const returnPayload={sale_id:partialSale.result.sale_id,lines:[{sale_line_id:detail.data.lines[0].sale_line_id??detail.data.lines[0].id,quantity:'0.25'}],disposition:'restock',reason:'Partial refund drawer conservation'}
 const partialId=randomUUID(),partialProof=await legacy.requestApproval('sale.return',returnPayload,'5678',{operationId:partialId})
 const partial=await legacy.command('sale.return',{...returnPayload,approval_id:partialProof.approval_id},{operationId:partialId})
 assert.equal(partial.outcome,'committed_local',JSON.stringify(partial))
 assert.equal(Number((await modern.query('cashup.summary',{shift_id:shift.result.shift_id})).data.expected_cash),27.5)
 const remainder={sale_id:partialSale.result.sale_id,reason:'Void remaining amount after partial return'}
 const remainderId=randomUUID(),remainderProof=await legacy.requestApproval('sale.void',remainder,'5678',{operationId:remainderId})
 assert.equal((await legacy.command('sale.void',{...remainder,approval_id:remainderProof.approval_id},{operationId:remainderId})).outcome,'committed_local')
 const cashAfterPartialVoid=(await modern.query('cashup.summary',{shift_id:shift.result.shift_id})).data
 assert.equal(Number(cashAfterPartialVoid.expected_cash),20);assert.equal(Number(cashAfterPartialVoid.cash_sales),0)
 const cashReport=(await modern.query('reports.cashup',{})).data
 assert.equal(Number(cashReport.totals.expected_cash),100,'the two drawers retain only the original float after sales, refunds and handovers')
 const third=await legacy.command('sale.commit',salePayload)
 const revokedPayload={sale_id:third.result.sale_id,reason:'Must not consume stale approval'},revokedId=randomUUID()
 const revokedProof=await legacy.requestApproval('sale.void',revokedPayload,'5678',{operationId:revokedId})
 await h.migrator.query("UPDATE bar_local.staff SET status='suspended' WHERE id=$1",[manager])
 const denied=await legacy.command('sale.void',{...revokedPayload,approval_id:revokedProof.approval_id},{operationId:revokedId})
 assert.equal(denied.outcome,'refused');assert.equal(denied.error.code,'APPROVAL_INVALID')
 assert.equal((await h.migrator.query('SELECT status FROM bar_local.sales WHERE id=$1',[third.result.sale_id])).rows[0].status,'completed')
 assert.equal((await h.migrator.query('SELECT consumed_at FROM bar_local.approvals WHERE id=$1',[revokedProof.approval_id])).rows[0].consumed_at,null)
 await insertManager('Ambiguous approver one','8888');await insertManager('Ambiguous approver two','8888')
 const before=(await h.migrator.query('SELECT count(*)::int AS n FROM bar_local.approvals')).rows[0].n
 await assert.rejects(modern.requestApprovalForCommand({command:'sale.void',payload:revokedPayload,pin:'8888'}),error=>error.code==='AUTH_INVALID')
 assert.equal((await h.migrator.query('SELECT count(*)::int AS n FROM bar_local.approvals')).rows[0].n,before)
})
