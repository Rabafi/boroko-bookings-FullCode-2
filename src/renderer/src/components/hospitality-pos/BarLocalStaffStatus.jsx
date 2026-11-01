// @ts-check
import {useState} from 'react'
/**
 * @param {{staffRows:Array<Record<string,unknown>>,actor:Record<string,unknown>,blocked:boolean,onApproved:(command:string,payload:Record<string,unknown>,pin:string)=>Promise<unknown>}} props
 */
export default function BarLocalStaffStatus({staffRows,actor,blocked,onApproved}){
 const [targetId,setTargetId]=useState(''),[reason,setReason]=useState(''),[pin,setPin]=useState('')
 const [saving,setSaving]=useState(false),[error,setError]=useState('')
 const eligible=staffRows.filter(row=>String(row.staff_id)!==String(actor.staff_id??actor.id)
  &&(actor.role==='owner'||row.role==='cashier'))
 const selected=eligible.find(row=>String(row.staff_id)===targetId)
 const nextStatus=selected?.status==='active'?'suspended':'active'
 /** @param {import('react').FormEvent<HTMLFormElement>} event */
 const submit=async event=>{
  event.preventDefault();if(blocked||saving||!selected)return
  setError('')
  if(!reason.trim()||!/^\d{4,12}$/.test(pin)){setError('Enter a reason and a different authorised approver PIN.');return}
  if(!window.confirm(`${nextStatus==='suspended'?'Suspend':'Reactivate'} ${String(selected.display_name)}? Active sessions will be revoked. Resolve any in-flight operations first.`))return
  setSaving(true)
  try{
   const result=await onApproved('staff.status',{staff_id:targetId,status:nextStatus,reason:reason.trim()},pin)
   if(result&&typeof result==='object'&&'outcome'in result&&result.outcome==='committed_local'){setTargetId('');setReason('')}
  }catch(cause){setError(cause instanceof Error?cause.message:'Staff status could not be changed.')}
  finally{setPin('');setSaving(false)}
 }
 return <form onSubmit={submit} className="mt-4 border-t border-slate-700 pt-4" aria-label="Staff access status">
  <h3 className="font-medium">Suspend or reactivate staff</h3>
  <p className="mt-1 text-xs text-slate-400">A different authorised approver is required. You cannot change your own access. The service protects owner access and revokes the selected staff member’s sessions.</p>
  {error&&<p role="alert" className="mt-2 text-sm text-red-200">{error}</p>}
  <fieldset disabled={blocked||saving} className="mt-3 grid gap-3 sm:grid-cols-2">
   <label className="text-xs">Staff member<select aria-label="Staff member" required value={targetId} onChange={event=>setTargetId(event.target.value)} className="mt-1 w-full rounded bg-slate-800 p-2"><option value="">Choose staff…</option>{eligible.map(row=><option key={String(row.staff_id)} value={String(row.staff_id)}>{String(row.display_name)} · {String(row.role)} · {String(row.status)}</option>)}</select></label>
   <label className="text-xs">Reason<input required maxLength={500} value={reason} onChange={event=>setReason(event.target.value)} className="mt-1 w-full rounded bg-slate-800 p-2"/></label>
   <label className="text-xs">Different authorised approver PIN<input required type="password" autoComplete="off" inputMode="numeric" maxLength={12} value={pin} onChange={event=>setPin(event.target.value.replace(/\D/g,''))} className="mt-1 w-full rounded bg-slate-800 p-2"/></label>
   <button disabled={!selected||blocked||saving} className="rounded bg-amber-500 px-4 py-2 text-sm font-semibold text-slate-950 disabled:opacity-40">{saving?'Submitting…':nextStatus==='suspended'?'Suspend selected staff':'Reactivate selected staff'}</button>
  </fieldset>
 </form>
}
