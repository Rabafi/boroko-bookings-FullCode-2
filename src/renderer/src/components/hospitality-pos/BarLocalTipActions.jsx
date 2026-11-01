// @ts-check
import {useEffect,useRef,useState} from 'react'
import {loadCompleteBarList} from '../../../../shared/barLocalPagination.js'
/** @param {{query:Parameters<typeof loadCompleteBarList>[0],staffRows:Array<Record<string,unknown>>,shift:Record<string,unknown>|null,blocked:boolean,canReadSales:boolean,onRun:(command:string,payload:Record<string,unknown>,pin?:string)=>Promise<unknown>,refreshKey?:unknown}} props */
export default function BarLocalTipActions({query,staffRows,shift,blocked,canReadSales,onRun,refreshKey}){
 const queryRef=useRef(query);queryRef.current=query
 const [mode,setMode]=useState('allocate'),[staffId,setStaffId]=useState(''),[saleId,setSaleId]=useState(''),[payoutId,setPayoutId]=useState('')
 const [recoveryShiftId,setRecoveryShiftId]=useState(''),[recoveryShifts,setRecoveryShifts]=useState(/** @type {Array<Record<string,unknown>>} */([])),[recoveryWarning,setRecoveryWarning]=useState('')
 const [amount,setAmount]=useState(''),[reason,setReason]=useState(''),[pin,setPin]=useState('')
 const [points,setPoints]=useState('')
 const [payouts,setPayouts]=useState(/** @type {Array<Record<string,unknown>>} */([]))
 const [sales,setSales]=useState(/** @type {Array<Record<string,unknown>>} */([]))
 const [loading,setLoading]=useState(true),[saving,setSaving]=useState(false),[revision,setRevision]=useState(0)
 const [error,setError]=useState(''),[salesWarning,setSalesWarning]=useState(''),[notice,setNotice]=useState('')
 const [verified,setVerified]=useState(false)
 useEffect(()=>{
  let disposed=false;setLoading(true);setVerified(false);setError('');setSalesWarning('')
  void(async()=>{
   try{
    const rows=await loadCompleteBarList((name,filters)=>queryRef.current(name,filters),'workforce.tip_payouts',{})
    if(disposed)return
    setPayouts(rows);setVerified(true)
    try {
     const drawers=await loadCompleteBarList((name,filters)=>queryRef.current(name,filters),'drawer.open_shifts',{})
     if(!disposed)setRecoveryShifts(drawers)
    } catch(cause) {
     if(!disposed){setRecoveryShifts([]);setRecoveryWarning(cause instanceof Error?cause.message:'Open recovery drawers could not be verified.')}
    }
    if(canReadSales){
     try{const recent=await queryRef.current('sales.list',{limit:50});if(recent.complete!==true||!Array.isArray(recent.data))throw new Error('Recent sales are incomplete.');if(!disposed)setSales(recent.data)}
     catch{if(!disposed){setSales([]);setSalesWarning('Recent sales could not be verified. Allocation is paused; existing payouts can still be reviewed.')}}
    }else{setSales([]);setSalesWarning('Sales reporting permission is required to select a sale for allocation.')}
   }catch(cause){if(!disposed){setPayouts([]);setError(cause instanceof Error?cause.message:'Tip payouts could not be verified.')}}
   finally{if(!disposed)setLoading(false)}
  })()
  return()=>{disposed=true}
 },[refreshKey,revision,canReadSales])
 const fenced=blocked||loading||saving||!verified
 /** @param {import('react').FormEvent<HTMLFormElement>} event */
 const submit=async event=>{
  event.preventDefault();if(fenced)return
  setError('');setNotice('')
  /** @type {Record<string,unknown>} */
  let payload={}
  let command=''
  if(mode==='reverse'){
   const payout=payouts.find(row=>String(row.id)===payoutId&&row.status==='paid')
   if(!payout||!reason.trim()) {setError('Select a paid payout and enter a reversal reason.');return}
   if(payout.shift_status!=='open'&&!recoveryShiftId){setError('The original drawer is closed. Select a different open manager drawer to record this correction.');return}
   if(recoveryShiftId&&!recoveryShifts.some(row=>String(row.shift_id)===recoveryShiftId)){setError('The selected recovery drawer is no longer verified. Refresh tip records and choose an open manager drawer.');return}
   command='workforce.tip.payout.reverse';payload={payout_id:payoutId,reason:reason.trim(),...(recoveryShiftId?{recovery_shift_id:recoveryShiftId}:{})}
  }else{
   if(!staffRows.some(row=>String(row.staff_id??row.id)===staffId&&row.status==='active')){setError('Select an active staff member.');return}
   if(!/^(0|[1-9]\d{0,11})(?:\.\d{1,2})?$/.test(amount)||BigInt(amount.replace('.',''))<=0n){setError('Enter a positive amount with at most two decimal places.');return}
   if(mode==='allocate'){
    if(!sales.some(row=>String(row.sale_id)===saleId)){setError('Select a verified recent sale.');return}
    if(points&&(!/^(0|[1-9]\d{0,7})(?:\.\d{1,4})?$/.test(points)||BigInt(points.replace('.',''))<=0n)){setError('Optional allocation points must be positive with at most four decimal places.');return}
    command='workforce.tip.allocate';payload={staff_id:staffId,sale_id:saleId,amount,...(points?{points}:{})}
   }else{
    if(!shift?.shift_id||!reason.trim()){setError('Open a shift and enter a payout reason.');return}
    command='workforce.tip.payout';payload={staff_id:staffId,shift_id:shift.shift_id,amount,reason:reason.trim()}
   }
  }
  if(mode!=='allocate'&&!/^\d{4,12}$/.test(pin)){setError('A different authorised approver must enter a valid PIN.');return}
  if(!window.confirm(mode==='allocate'?`Allocate ${amount} of the selected sale tip to this staff member?`:`${mode==='reverse'?'Reverse the selected payout':'Pay out '+amount+' from this open drawer'}? The local authority will verify cash and tip balances.`))return
  setSaving(true)
  try{
   const result=await onRun(command,payload,mode==='allocate'?'':pin)
   if(result&&typeof result==='object'&&'outcome'in result&&result.outcome==='committed_local'){
    setAmount('');setPoints('');setReason('');setPayoutId('');setRecoveryShiftId('');setNotice('Tip operation committed by the local authority.');setRevision(value=>value+1)
   }
  }catch(cause){setError(cause instanceof Error?cause.message:'The tip operation could not be confirmed.')}
  finally{setPin('');setSaving(false)}
 }
 return <section aria-label="Tip allocation and payouts" className="mt-5 rounded-xl border border-slate-700 bg-slate-900 p-4">
  <h3 className="font-semibold">Tip allocations, payouts and reversals</h3><p className="mt-1 text-xs text-slate-400">The service checks the retained sale tip and staff balance, including when all items were returned. Payouts require an open drawer and a different approver. If the original payout drawer is closed, a reversal needs a different open manager drawer; the correction remains linked to the original payout.</p>
  {error&&<p role="alert" className="mt-2 text-sm text-red-200">{error}</p>}{notice&&<p role="status" className="mt-2 text-sm text-emerald-200">{notice}</p>}{salesWarning&&<p className="mt-2 text-xs text-amber-200">{salesWarning}</p>}{recoveryWarning&&mode==='reverse'&&<p role="alert" className="mt-2 text-xs text-amber-200">Recovery drawer list unavailable: {recoveryWarning}. Closed-shift corrections are paused.</p>}
  <button type="button" disabled={loading||saving} onClick={()=>setRevision(value=>value+1)} className="mt-3 rounded border border-slate-600 px-3 py-2 text-xs">{loading?'Checking tip records…':'Refresh tip records'}</button>
  <form onSubmit={submit} className="mt-3"><fieldset disabled={fenced} className="grid gap-3 sm:grid-cols-2">
   <label className="text-xs">Action<select aria-label="Tip action" value={mode} onChange={event=>{setMode(event.target.value);setPin('');setRecoveryShiftId('');setError('')}} className="mt-1 w-full rounded bg-slate-800 p-2"><option value="allocate">Allocate a sale tip</option><option value="payout">Pay out tips</option><option value="reverse">Reverse a payout</option></select></label>
   {mode==='reverse'?<><label className="text-xs">Paid payout<select required aria-label="Paid tip payout" value={payoutId} onChange={event=>setPayoutId(event.target.value)} className="mt-1 w-full rounded bg-slate-800 p-2"><option value="">Choose payout…</option>{payouts.filter(row=>row.status==='paid').map(row=><option key={String(row.id)} value={String(row.id)}>{String(row.display_name)} · {String(row.amount)} · {String(row.paid_at)} · original drawer {String(row.shift_status)}</option>)}</select></label><label className="text-xs">Recovery drawer (only needed when original is closed)<select aria-label="Tip reversal recovery drawer" value={recoveryShiftId} onChange={event=>setRecoveryShiftId(event.target.value)} className="mt-1 w-full rounded bg-slate-800 p-2"><option value="">Use original drawer if it is still open</option>{recoveryShifts.map(row=><option key={String(row.shift_id)} value={String(row.shift_id)}>{String(row.display_name)} · opened {String(row.opened_at)}</option>)}</select></label></>:<>
    <label className="text-xs">Staff member<select required aria-label="Tip staff member" value={staffId} onChange={event=>setStaffId(event.target.value)} className="mt-1 w-full rounded bg-slate-800 p-2"><option value="">Choose staff…</option>{staffRows.filter(row=>row.status==='active').map(row=><option key={String(row.staff_id??row.id)} value={String(row.staff_id??row.id)}>{String(row.display_name)}</option>)}</select></label>
    <label className="text-xs">Amount<input required inputMode="decimal" value={amount} onChange={event=>setAmount(event.target.value.trim())} className="mt-1 w-full rounded bg-slate-800 p-2"/></label>
   </>}
   {mode==='allocate'&&<label className="text-xs">Recent sale (latest 50)<select required aria-label="Tip source sale" value={saleId} onChange={event=>setSaleId(event.target.value)} className="mt-1 w-full rounded bg-slate-800 p-2"><option value="">Choose receipt…</option>{sales.filter(row=>!row.original_sale_id&&(row.status==='completed'||row.status==='returned')&&Number(row.tip)>0).map(row=><option key={String(row.sale_id)} value={String(row.sale_id)}>Receipt {String(row.receipt_number)} · tip {String(row.tip)}{row.status==='returned'?' · items returned':''}</option>)}</select></label>}
   {mode==='allocate'&&<label className="text-xs">Allocation points (optional)<input inputMode="decimal" maxLength={13} value={points} onChange={event=>setPoints(event.target.value.trim())} className="mt-1 w-full rounded bg-slate-800 p-2"/></label>}
   {mode!=='allocate'&&<><label className="text-xs">Reason<input required maxLength={500} value={reason} onChange={event=>setReason(event.target.value)} className="mt-1 w-full rounded bg-slate-800 p-2"/></label><label className="text-xs">Different authorised approver PIN<input required type="password" inputMode="numeric" autoComplete="off" maxLength={12} value={pin} onChange={event=>setPin(event.target.value.replace(/\D/g,''))} className="mt-1 w-full rounded bg-slate-800 p-2"/></label></>}
   <button disabled={fenced||Boolean(mode==='allocate'&&salesWarning)} className="rounded bg-amber-500 px-4 py-2 text-sm font-semibold text-slate-950 disabled:opacity-40">{saving?'Submitting…':mode==='allocate'?'Allocate tip':mode==='payout'?'Approve tip payout':'Approve payout reversal'}</button>
  </fieldset></form>
  <ul className="mt-4 max-h-52 space-y-1 overflow-auto text-xs">{payouts.map(row=><li key={String(row.id)}>{String(row.display_name)} · {String(row.amount)} · {String(row.status)} · {String(row.paid_at)}</li>)}</ul>
 </section>
}
