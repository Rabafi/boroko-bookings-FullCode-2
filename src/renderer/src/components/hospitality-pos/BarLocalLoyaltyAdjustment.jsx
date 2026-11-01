// @ts-check
import {useState} from 'react'
/** @param {{customers:Array<Record<string,unknown>>,blocked:boolean,onApproved:(command:string,payload:Record<string,unknown>,pin:string)=>Promise<unknown>,onCommitted:()=>Promise<unknown>}} props */
export default function BarLocalLoyaltyAdjustment({customers,blocked,onApproved,onCommitted}){
 const [customerId,setCustomerId]=useState(''),[points,setPoints]=useState(''),[reason,setReason]=useState(''),[pin,setPin]=useState('')
 const [saving,setSaving]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('')
 /** @param {import('react').FormEvent<HTMLFormElement>} event */
 const submit=async event=>{
  event.preventDefault();if(blocked||saving)return
  setError('');setNotice('')
  const customer=customers.find(row=>String(row.customer_id)===customerId)
  if(!customer||!(/^-?[1-9]\d{0,11}$/).test(points.trim())||!reason.trim()||!/^\d{4,12}$/.test(pin)){
   setError('Select a customer, enter non-zero whole points, a reason and a different authorised approver PIN.');return
  }
  if(!window.confirm(`Adjust ${String(customer.name)} by ${points.trim()} points? This creates an audited correction and does not change a sale or tender.`))return
  setSaving(true)
  try{
   const result=await onApproved('loyalty.points.adjust',{customer_id:customerId,points:points.trim(),reason:reason.trim()},pin)
   if(result&&typeof result==='object'&&'outcome'in result&&result.outcome==='committed_local'){
    setPoints('');setReason('');setNotice('Points correction committed by the local authority.')
    try{await onCommitted()}catch{setError('The correction committed, but the balance could not be refreshed. Refresh its authoritative balance before using it; do not submit this correction again.')}
   }
  }catch(cause){setError(cause instanceof Error?cause.message:'The points correction could not be confirmed.')}
  finally{setPin('');setSaving(false)}
 }
 return <form onSubmit={submit} aria-label="Approved loyalty correction" className="mt-5 rounded-xl border border-slate-700 bg-slate-900 p-4">
  <h3 className="font-semibold">Correct loyalty points</h3><p className="mt-1 text-xs text-slate-400">Finance permission and a different approver are required. Use negative whole points to reduce a balance. The service validates the resulting balance.</p>
  {error&&<p role="alert" className="mt-2 text-sm text-red-200">{error}</p>}{notice&&<p role="status" className="mt-2 text-sm text-emerald-200">{notice}</p>}
  <fieldset disabled={blocked||saving} className="mt-3 grid gap-3 sm:grid-cols-2">
   <label className="text-xs">Customer<select required aria-label="Correction customer" value={customerId} onChange={event=>setCustomerId(event.target.value)} className="mt-1 w-full rounded bg-slate-800 p-2"><option value="">Choose customer…</option>{customers.map(row=><option key={String(row.customer_id)} value={String(row.customer_id)}>{String(row.name)}</option>)}</select></label>
   <label className="text-xs">Whole points (+ or −)<input required inputMode="numeric" maxLength={13} value={points} onChange={event=>setPoints(event.target.value)} className="mt-1 w-full rounded bg-slate-800 p-2"/></label>
   <label className="text-xs">Correction reason<input required maxLength={500} value={reason} onChange={event=>setReason(event.target.value)} className="mt-1 w-full rounded bg-slate-800 p-2"/></label>
   <label className="text-xs">Different authorised approver PIN<input required type="password" inputMode="numeric" autoComplete="off" maxLength={12} value={pin} onChange={event=>setPin(event.target.value.replace(/\D/g,''))} className="mt-1 w-full rounded bg-slate-800 p-2"/></label>
   <button disabled={blocked||saving} className="rounded bg-amber-500 px-4 py-2 text-sm font-semibold text-slate-950 disabled:opacity-40">Approve points correction</button>
  </fieldset>
 </form>
}
