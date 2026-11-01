// @ts-check
import {useEffect,useRef,useState} from 'react'
import {loadCompleteBarList} from '../../../../shared/barLocalPagination.js'
/** @param {{query:Parameters<typeof loadCompleteBarList>[0],shift:Record<string,unknown>|null,blocked:boolean,refreshKey?:unknown,onApproved:(command:string,payload:Record<string,unknown>,pin:string)=>Promise<unknown>}} props */
export default function BarLocalDrawerHandover({query,shift,blocked,refreshKey,onApproved}){
 const queryRef=useRef(query);queryRef.current=query
 const [rows,setRows]=useState(/** @type {Array<Record<string,unknown>>} */([]))
 const [source,setSource]=useState(''),[amount,setAmount]=useState(''),[reason,setReason]=useState(''),[pin,setPin]=useState('')
 const [confirmed,setConfirmed]=useState(false),[loading,setLoading]=useState(true),[verified,setVerified]=useState(false)
 const [saving,setSaving]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[revision,setRevision]=useState(0)
 useEffect(()=>{
  let disposed=false;setLoading(true);setVerified(false);setSource('');setConfirmed(false)
  void loadCompleteBarList((name,filters)=>queryRef.current(name,filters),'drawer.open_shifts').then(result=>{
   if(!disposed){setRows(result);setVerified(true);setError('')}
  }).catch(cause=>{if(!disposed){setRows([]);setError(cause instanceof Error?cause.message:'Open drawers could not be verified.')}})
   .finally(()=>{if(!disposed)setLoading(false)})
  return()=>{disposed=true}
 },[refreshKey,revision,shift?.shift_id])
 const fenced=blocked||loading||saving||!verified||!shift?.shift_id
 /** @param {import('react').FormEvent<HTMLFormElement>} event */
 const submit=async event=>{
  event.preventDefault();if(fenced)return
  setError('');setNotice('')
  if(!rows.some(row=>String(row.shift_id)===source)||!confirmed||!reason.trim()||!/^\d{4,12}$/.test(pin)
   ||!/^(0|[1-9]\d{0,11})(?:\.\d{1,2})?$/.test(amount)||BigInt(amount.replace('.',''))<=0n){
   setError('Select an outgoing drawer, enter a positive cash amount and reason, confirm receipt, and ask that operator to enter their PIN.');return
  }
  if(!window.confirm(`Transfer ${amount} from the selected outgoing drawer into your drawer? Confirm only after both operators count the cash.`))return
  setSaving(true)
  try{
   const result=await onApproved('drawer.movement',{shift_id:shift?.shift_id,source_shift_id:source,type:'handover',amount,reason:reason.trim(),receiver_confirmed:true},pin)
   if(result&&typeof result==='object'&&'outcome'in result&&result.outcome==='committed_local'){
    setAmount('');setReason('');setConfirmed(false);setNotice('The authority confirmed both drawer entries.');setRevision(value=>value+1)
   }else setError('The handover is not confirmed. Check the saved operation or refusal above before trying again.')
  }catch(cause){setError(cause instanceof Error?cause.message:'The handover could not be confirmed.')}
  finally{setPin('');setSaving(false)}
 }
 return <form onSubmit={submit} aria-label="Cash handover" className="mt-4 border-t border-slate-700 pt-4">
  <h3 className="font-semibold">Receive cash from another till</h3>
  <p className="mt-2 text-xs text-slate-400">Both operators must be present with open drawers in this outlet. The outgoing operator approves with their own distinct PIN; you confirm receipt. The service records both entries atomically and refuses amounts above the outgoing balance.</p>
  {error&&<p role="alert" className="mt-2 text-sm text-red-200">{error}</p>}{notice&&<p role="status">{notice}</p>}
  <button type="button" disabled={saving||loading||blocked} onClick={()=>setRevision(value=>value+1)} className="mt-2 text-sm underline">Refresh outgoing drawers</button>
  <fieldset disabled={Boolean(fenced)} className="mt-3 grid gap-3 sm:grid-cols-2">
   <label>Outgoing operator<select aria-label="Outgoing operator" required value={source} onChange={event=>{setSource(event.target.value);setConfirmed(false);setPin('')}} className="block w-full rounded bg-slate-800 p-2"><option value="">Choose an open drawer…</option>{rows.map(row=><option key={String(row.shift_id)} value={String(row.shift_id)}>{String(row.display_name)} · opened {String(row.opened_at)}</option>)}</select></label>
   <label>Cash received<input aria-label="Cash received" required inputMode="decimal" value={amount} onChange={event=>{setAmount(event.target.value);setConfirmed(false)}} className="block w-full rounded bg-slate-800 p-2"/></label>
   <label>Handover reason<input aria-label="Handover reason" required maxLength={500} value={reason} onChange={event=>setReason(event.target.value)} className="block w-full rounded bg-slate-800 p-2"/></label>
   <label>Outgoing operator PIN<input aria-label="Outgoing operator PIN" required type="password" autoComplete="off" inputMode="numeric" maxLength={12} value={pin} onChange={event=>setPin(event.target.value.replace(/\D/g,''))} className="block w-full rounded bg-slate-800 p-2"/></label>
   <label className="sm:col-span-2"><input type="checkbox" required checked={confirmed} onChange={event=>setConfirmed(event.target.checked)}/> I have counted and received this cash.</label>
   <button disabled={!confirmed||!source||Boolean(fenced)} className="rounded bg-emerald-700 p-2 font-semibold disabled:opacity-40">{saving?'Submitting…':'Approve and record handover'}</button>
  </fieldset>
 </form>
}
