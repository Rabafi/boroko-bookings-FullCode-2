// @ts-check
import {useEffect,useRef,useState} from 'react'
import {loadCompleteBarList} from '../../../../shared/barLocalPagination.js'
import {estimateLocalInvoice} from '../../../../shared/barLocalInvoiceMath.js'

/** @typedef {{key:string,label:string,type?:string,source?:string,optional?:boolean,choices?:string[],initial?:string}} Field */
/** @typedef {{title:string,command:string,fields:Field[],lines?:Field[],approval?:boolean,edit?:{kind:string,idKey:string},versionFrom?:string}} FinanceForm */
/** @param {string} key @param {string} label @param {string} [type] @param {string} [source] @returns {Field} */
const field=(key,label,type='text',source='')=>({key,label,type,source})
/** @type {(key:string,label:string)=>Field} */
const account=(key,label)=>field(key,label,'select','accounts')
/** @type {(key:string,label:string)=>Field} */
const date=(key,label)=>field(key,label,'date')
/** @type {(key:string,label:string)=>Field} */
const amount=(key,label)=>field(key,label,'decimal')
/** @param {unknown} value */
const displayMoney=value=>{
 if(value===null||value===undefined||value==='')return '—'
 const match=/^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(String(value).trim())
 if(!match)return String(value)
 const integer=match[2].replace(/^0+(?=\d)/,'').replace(/\B(?=(\d{3})+(?!\d))/g,',')
 return `${match[1]}${integer}.${(match[3]??'').padEnd(2,'0')}`
}
const reason=field('reason','Reason')
const invoiceLine=[field('description','Description'),account('expense_account_code','Expense account'),{...amount('quantity','Quantity'),initial:'1'},amount('unit_price','Unit price'),{...amount('tax_rate','Tax multiplier (0.14 = 14%)'),initial:'0'}]
const journalLine=[account('account_code','Ledger account'),amount('debit','Debit'),amount('credit','Credit'),{...field('description','Line description'),optional:true}]
/** @type {FinanceForm[]} */
export const LOCAL_FINANCE_FORMS=[
 {title:'Supplier invoice',command:'accounting.ap.invoice.upsert',edit:{kind:'ap_invoices',idKey:'invoice_id'},fields:[field('supplier_id','Supplier','select','suppliers'),field('invoice_number','Invoice number'),date('invoice_date','Invoice date'),{...date('due_date','Due date'),optional:true},account('payable_account_code','Payable account'),{...account('tax_account_code','Tax account'),optional:true}],lines:invoiceLine},
 {title:'Approve supplier invoice',command:'accounting.ap.invoice.approve',approval:true,fields:[field('invoice_id','Supplier invoice','select','ap_invoices')]},
 {title:'Supplier payment',command:'accounting.ap.payment.post',approval:true,fields:[field('invoice_id','Approved invoice','select','ap_invoices'),amount('amount','Amount'),date('payment_date','Payment date'),account('payment_account_code','Payment account'),{key:'method',label:'Method',type:'select',choices:['bank','cash','card','mobile_money','other'],initial:'bank'},field('reference','Payment reference')]},
 {title:'Reverse supplier payment',command:'accounting.ap.payment.reverse',approval:true,fields:[field('payment_id','Payment','select','ap_payments'),date('reversal_date','Reversal date'),reason]},
 {title:'Bank account',command:'accounting.bank_account.upsert',edit:{kind:'bank_accounts',idKey:'bank_account_id'},fields:[field('name','Account name'),field('institution','Bank or institution'),{...field('account_number','Account reference'),optional:true},account('account_code','Asset ledger account'),{key:'active',label:'Active',type:'checkbox',initial:'true'}]},
 {title:'Bank statement lines',command:'accounting.bank_statement.import',fields:[field('bank_account_id','Bank account','select','bank_accounts')],lines:[field('external_ref','Statement reference'),date('statement_date','Statement date'),amount('amount','Amount'),{...field('description','Description'),optional:true}]},
 {title:'Reconcile statement line',command:'accounting.bank.reconcile',fields:[field('statement_line_id','Statement line','select','bank_statement_lines'),{...field('journal_entry_id','Matching journal','select','journal_entries'),optional:true},{...field('ap_payment_id','Matching supplier payment','select','ap_payments'),optional:true},date('reconciled_on','Reconciliation date'),{...field('note','Note'),optional:true}]},
 {title:'Tax code',command:'accounting.tax_code.upsert',edit:{kind:'tax_codes',idKey:'code'},fields:[field('code','Tax code'),field('name','Name'),amount('rate','Tax multiplier (0.14 = 14%)'),{key:'active',label:'Active',type:'checkbox',initial:'true'}]},
 {title:'Prepare tax draft',command:'accounting.tax_return.prepare',fields:[field('period','Accounting month','month')]},
 {title:'Create payroll draft',command:'accounting.payroll_run.create',fields:[date('period_start','Period starts'),date('period_end','Period ends'),date('pay_date','Pay date'),account('expense_account_code','Payroll expense account'),account('payable_account_code','Payroll payable account'),{...account('deductions_account_code','Deductions account'),optional:true}],lines:[field('employee_ref','Employee reference (no identity documents)'),amount('gross','Gross pay'),{...amount('deductions','Deductions'),initial:'0.00'}]},
 {title:'Prepare payroll',command:'accounting.payroll_run.prepare',versionFrom:'payroll_run_id',fields:[field('payroll_run_id','Payroll draft','select','payroll_runs')]},
 {title:'Finalise payroll',command:'accounting.payroll_run.finalise',versionFrom:'payroll_run_id',approval:true,fields:[field('payroll_run_id','Prepared payroll','select','payroll_runs')]},
 {title:'Budget',command:'accounting.budget.upsert',edit:{kind:'budgets',idKey:'budget_id'},fields:[field('name','Budget name'),date('period_start','Period starts'),date('period_end','Period ends'),{key:'active',label:'Active',type:'checkbox',initial:'true'}],lines:[account('account_code','Ledger account'),amount('amount','Budget amount'),{...field('description','Description'),optional:true}]},
 {title:'Ledger account',command:'accounting.account.upsert',edit:{kind:'accounts',idKey:'code'},fields:[field('code','Account code'),field('name','Account name'),{key:'type',label:'Account type',type:'select',choices:['asset','liability','equity','revenue','expense'],initial:'asset'},{key:'active',label:'Active',type:'checkbox',initial:'true'}]},
 {title:'Post journal entry',command:'accounting.journal.post',fields:[date('entry_date','Entry date'),field('memo','Journal memo'),field('source_type','Source type'),{...field('source_id','Source record UUID'),optional:true}],lines:journalLine},
 {title:'Close accounting period',command:'accounting.period.close',approval:true,fields:[field('period','Accounting month','month')]}
]

/** @param {unknown} value @returns {Record<string,unknown>} */
const record=value=>value&&typeof value==='object'&&!Array.isArray(value)?/** @type {Record<string,unknown>} */(value):{}
/** @param {Record<string,unknown>} row */
const label=row=>String(row.invoice_number??row.name??row.employee_ref??row.external_ref??row.period??row.period_start??row.reference??row.memo??row.description??row.code??'Record')+(row.total!==undefined?` · ${String(row.total)}`:'')+(row.status?` · ${String(row.status)}`:'')
/** @param {Field[]} fields */
const initial=fields=>Object.fromEntries(fields.map(item=>[item.key,item.initial??'']))
const KINDS=['ap_invoices','ap_payments','bank_accounts','bank_statement_lines','bank_reconciliations','tax_codes','tax_return_periods','payroll_runs','budgets','journal_entries','suppliers']

/**
 * @param {{query:Parameters<typeof loadCompleteBarList>[0],onRun:(command:string,payload:Record<string,unknown>,pin?:string)=>Promise<unknown>,blocked:boolean,refreshKey?:unknown}} props
 */
export default function BarLocalFinanceWorkspace({query,onRun,blocked,refreshKey}){
 const queryRef=useRef(query);queryRef.current=query
 const [formIndex,setFormIndex]=useState(0)
 const form=LOCAL_FINANCE_FORMS[formIndex]
 const lineFields=form.lines??[]
 const editKind=form.edit?.kind??''
 const [values,setValues]=useState(/** @type {Record<string,string>} */(initial(form.fields)))
 const [lines,setLines]=useState(/** @type {Array<Record<string,string>>} */(form.lines?[initial(form.lines)]:[]))
 const [resources,setResources]=useState(/** @type {Record<string,Array<Record<string,unknown>>>} */({}))
 const [editing,setEditing]=useState(/** @type {Record<string,unknown>|null} */(null))
 const [pin,setPin]=useState(''),[error,setError]=useState(''),[notice,setNotice]=useState('')
 const [loading,setLoading]=useState(true),[saving,setSaving]=useState(false),[revision,setRevision]=useState(0)
 const [trialFrom,setTrialFrom]=useState(''),[trialTo,setTrialTo]=useState(''),[trialRevision,setTrialRevision]=useState(0)
 const [trialRows,setTrialRows]=useState(/** @type {Array<Record<string,unknown>>} */([])),[trialLoading,setTrialLoading]=useState(true),[trialError,setTrialError]=useState('')
 const requestId=useRef(0)
 useEffect(()=>{
  const id=++requestId.current;let disposed=false
  setLoading(true);setError('')
  void(async()=>{
   try{
    const result=await Promise.all(KINDS.map(async kind=>[kind,await loadCompleteBarList((name,filters)=>queryRef.current(name,filters),'accounting.records',{kind})]))
    const accounts=await loadCompleteBarList((name,filters)=>queryRef.current(name,filters),'accounting.accounts.list',{include_inactive:true})
    if(disposed||id!==requestId.current)return
    setResources({...Object.fromEntries(result),accounts})
   }catch(cause){if(!disposed&&id===requestId.current){setResources({});setError(cause instanceof Error?cause.message:'Finance records could not be loaded.')}}
   finally{if(!disposed&&id===requestId.current)setLoading(false)}
  })()
  return()=>{disposed=true}
 },[refreshKey,revision])
 useEffect(()=>{
  let disposed=false
  setTrialLoading(true);setTrialError('');setTrialRows([])
  void(async()=>{
   try{
    if(trialFrom&&trialTo&&trialFrom>trialTo)throw new Error('The start date must be on or before the end date.')
    const filters={...(trialFrom?{from:trialFrom}:{}),...(trialTo?{to:trialTo}:{})}
    const rows=await loadCompleteBarList((name,queryFilters)=>queryRef.current(name,queryFilters),'accounting.trial_balance',filters)
    if(!disposed)setTrialRows(rows.map(record))
   }catch(cause){if(!disposed){setTrialRows([]);setTrialError(cause instanceof Error?cause.message:'Trial balance is unavailable. Refresh before relying on it.')}}
   finally{if(!disposed)setTrialLoading(false)}
  })()
  return()=>{disposed=true}
 },[refreshKey,revision,trialRevision,trialFrom,trialTo])
 const fenced=blocked||loading||saving||!resources.accounts
 /** @param {number} index */
 const reset=(index)=>{const next=LOCAL_FINANCE_FORMS[index];setFormIndex(index);setValues(initial(next.fields));setLines(next.lines?[initial(next.lines)]:[]);setEditing(null);setPin('');setError('');setNotice('')}
 /** @param {Field} input */
 const options=(input)=>{
  let rows=resources[input.source??'']??[]
  if(input.source==='accounts')return rows.filter(row=>row.active!==false)
  if(input.source==='ap_invoices')rows=rows.filter(row=>row.status===(form.command==='accounting.ap.invoice.approve'?'draft':'approved'))
  if(input.source==='ap_payments')rows=rows.filter(row=>row.status==='posted'&&!(resources.ap_payments??[]).some(other=>other.reverses_payment_id===row.id))
  if(input.source==='payroll_runs')rows=rows.filter(row=>row.status===(form.command==='accounting.payroll_run.prepare'?'draft':'prepared'))
  return rows
 }
 /** @param {Field[]} fields @param {Record<string,string>} source @returns {Record<string,unknown>} */
 const readFields=(fields,source)=>Object.fromEntries(fields.flatMap(input=>{
  const value=source[input.key]??''
  if(input.optional&&value==='')return []
  return [[input.key,input.type==='checkbox'?value==='true':value.trim()]]
 }))
 /** @param {string} id */
 const editRecord=async(id)=>{
  if(!id||!form.edit){reset(formIndex);return}
  setSaving(true);setError('')
  try{
   const rows=form.edit.kind==='accounts'
    ?(await loadCompleteBarList((name,filters)=>queryRef.current(name,filters),'accounting.accounts.list',{include_inactive:true})).filter(row=>String(record(row).code)===id)
    :await loadCompleteBarList((name,filters)=>queryRef.current(name,filters),'accounting.records',{kind:form.edit.kind,record_id:id})
   if(rows.length!==1)throw new Error('The selected record is no longer available. Refresh before editing.')
   const row=record(rows[0]);if(!Number.isSafeInteger(row.version))throw new Error('The record has no verified edit version. Refresh before continuing.');setEditing(row)
   setValues(Object.fromEntries(form.fields.map(input=>[input.key,String(row[input.key]??input.initial??'')])) )
   if(form.lines){if(!Array.isArray(row.lines))throw new Error('The complete saved lines could not be loaded. No edit was started.');setLines(row.lines.map(line=>Object.fromEntries(lineFields.map(input=>[input.key,String(record(line)[input.key]??input.initial??'')]))))}
  }catch(cause){setEditing(null);setResources({});setValues(initial(form.fields));setLines(form.lines?[initial(lineFields)]:[]);setError(cause instanceof Error?cause.message:'The saved record could not be opened.')}
  finally{setSaving(false)}
 }
 /** @param {import('react').FormEvent<HTMLFormElement>} event */
 const submit=async(event)=>{
  event.preventDefault();if(fenced)return
  setError('');setNotice('')
  try{
   const payload=readFields(form.fields,values)
   if(form.lines){if(!lines.length||lines.length>500)throw new Error('Enter between one and 500 lines.');payload.lines=lines.map(line=>readFields(lineFields,line))}
   if(form.command==='accounting.journal.post'){
    if(lines.length<2)throw new Error('A journal entry needs at least two lines.')
    /** @param {unknown} value */
    const cents=value=>{const match=/^(\d+)(?:\.(\d{1,2}))?$/.exec(String(value??'').trim());if(!match)throw new Error('Journal debit and credit amounts must be non-negative amounts with up to two decimals.');return BigInt(match[1])*100n+BigInt((match[2]??'').padEnd(2,'0')||'0')}
    let debit=0n,credit=0n
    for(const line of lines){const row=readFields(lineFields,line);const d=cents(row.debit),c=cents(row.credit);if((d===0n)===(c===0n))throw new Error('Each journal line must contain either a positive debit or a positive credit, not both.');debit+=d;credit+=c}
    if(debit!==credit)throw new Error('Journal debits and credits must balance exactly before posting.')
   }
   if(form.command==='accounting.ap.invoice.upsert')Object.assign(payload,estimateLocalInvoice(lines.map(line=>({quantity:line.quantity,unit_price:line.unit_price,tax_rate:line.tax_rate}))))
   if(editing&&form.edit){payload[form.edit.idKey]=editing[form.edit.idKey==='code'?'code':'id'];payload.expected_version=editing.version}
   if(form.versionFrom){const input=form.fields.find(item=>item.key===form.versionFrom);const selected=(resources[input?.source??'']??[]).find(row=>row.id===values[form.versionFrom??'']);if(!selected||!Number.isSafeInteger(selected.version))throw new Error('Reload the current payroll version before continuing.');payload.expected_version=selected.version}
   if(form.command==='accounting.bank.reconcile'&&Boolean(payload.journal_entry_id)===Boolean(payload.ap_payment_id))throw new Error('Choose exactly one matching journal or supplier payment.')
   if(form.approval&&!/^\d{4,12}$/.test(pin))throw new Error('A different authorised approver must enter a valid PIN.')
   if(!window.confirm(`${form.title}: ${form.command==='accounting.ap.invoice.upsert'?`estimated total ${String(payload.total)} (tax ${String(payload.tax_total)}); `:''}submit these details to the local authority?`))return
   setSaving(true)
   const result=record(await onRun(form.command,payload,form.approval?pin:''));setPin('')
   if(result.outcome!=='committed_local'){setError('No committed result was confirmed. Resolve the saved operation or review the service error before submitting again.');return}
   reset(formIndex);setNotice('Committed by the local authority. Records are being refreshed.');setRevision(value=>value+1)
  }catch(cause){setPin('');setError(cause instanceof Error?cause.message:'The local finance operation could not be completed.')}
  finally{setSaving(false)}
 }
 /** @param {Field} input @param {string} value @param {(value:string)=>void} onChange @param {string} key */
 const renderInput=(input,value,onChange,key)=> <label key={key} className="block text-xs">{input.label}{input.optional?' (optional)':''}{input.type==='select'?<select aria-label={input.label+(input.optional?" (optional)":"")} required={!input.optional} value={value??''} onChange={event=>onChange(event.target.value)} className="mt-1 w-full rounded bg-slate-800 p-2 text-sm"><option value="">Choose…</option>{input.choices?input.choices.map(choice=><option key={choice} value={choice}>{choice.replaceAll('_',' ')}</option>):options(input).map(row=><option key={String(row.id??row.code)} value={String(input.source==='accounts'?row.code:row.id)}>{label(row)}</option>)}</select>:input.type==='checkbox'?<input type="checkbox" checked={value==='true'} onChange={event=>onChange(String(event.target.checked))} className="ml-3"/>:<input readOnly={input.key==='code'&&Boolean(editing)&&form.edit?.idKey==='code'} required={!input.optional} maxLength={input.key==='description'?240:120} type={['date','month'].includes(input.type??'')?input.type:'text'} inputMode={input.type==='decimal'?'decimal':undefined} value={value??''} onChange={event=>onChange(event.target.value)} className="mt-1 w-full rounded bg-slate-800 p-2 text-sm"/>}</label>
 return <section className="mt-5 rounded-xl border border-slate-700 bg-slate-900 p-4" aria-label="Local finance operations">
  <h3 className="font-semibold">Supplier bills, banking, tax, payroll and budgets</h3>
  <p className="mt-2 text-xs text-amber-100">These records are local. Payroll finalisation does not pay staff or submit filings. Tax preparation creates a draft and does not file or pay tax. Bank reconciliation records evidence and does not contact a bank.</p>
  <section className="mt-4 rounded-lg border border-slate-700 p-3" aria-label="Local trial balance">
   <div className="flex flex-wrap items-end gap-3"><div><label className="block text-xs">From (inclusive)<input type="date" aria-label="Trial balance from" value={trialFrom} onChange={event=>setTrialFrom(event.target.value)} className="mt-1 block rounded bg-slate-800 p-2"/></label></div><div><label className="block text-xs">To (inclusive)<input type="date" aria-label="Trial balance to" value={trialTo} onChange={event=>setTrialTo(event.target.value)} className="mt-1 block rounded bg-slate-800 p-2"/></label></div><button type="button" disabled={blocked||trialLoading} onClick={()=>setTrialRevision(value=>value+1)} className="rounded border border-slate-600 px-3 py-2 text-xs disabled:opacity-40">{trialLoading?'Loading complete trial balance…':'Refresh trial balance'}</button></div>
   {trialError&&<p role="alert" className="mt-3 rounded border border-red-700 p-2 text-xs text-red-100">{trialError}</p>}
   <div className="mt-3 overflow-x-auto"><table className="w-full text-left text-xs"><thead><tr><th className="p-2">Account</th><th className="p-2">Type</th><th className="p-2">Debit</th><th className="p-2">Credit</th><th className="p-2">Balance</th></tr></thead><tbody>{trialRows.map(row=><tr key={String(row.account_code)} className="border-t border-slate-800"><td className="p-2">{String(row.account_code)} · {String(row.name)}</td><td className="p-2">{String(row.type)}</td><td className="p-2">{displayMoney(row.debit)}</td><td className="p-2">{displayMoney(row.credit)}</td><td className="p-2">{displayMoney(row.balance)}</td></tr>)}</tbody></table>{!trialLoading&&!trialError&&trialRows.length===0&&<p className="p-2 text-xs text-slate-400">No active ledger accounts were returned for this date range.</p>}</div>
  </section>
  {error&&<p role="alert" className="mt-3 rounded border border-red-700 p-3 text-sm text-red-100">{error}</p>}{notice&&<p role="status" className="mt-3 text-sm text-emerald-200">{notice}</p>}
  <button type="button" disabled={saving||loading} onClick={()=>setRevision(value=>value+1)} className="mt-3 rounded border border-slate-600 px-3 py-2 text-xs">{loading?'Loading complete local records…':'Refresh finance records'}</button>
  <label className="mt-4 block text-sm">Action<select aria-label="Action" value={formIndex} disabled={saving||blocked} onChange={event=>reset(Number(event.target.value))} className="ml-2 rounded bg-slate-800 p-2">{LOCAL_FINANCE_FORMS.map((item,index)=><option key={item.command} value={index}>{item.title}</option>)}</select></label>
  {form.edit&&<label className="mt-3 block text-xs">Create or edit<select aria-label="Create or edit" value={String(editing?.id??editing?.code??'')} disabled={fenced} onChange={event=>void editRecord(event.target.value)} className="ml-2 rounded bg-slate-800 p-2"><option value="">Create new</option>{(resources[editKind]??[]).filter(row=>editKind!=='ap_invoices'||row.status==='draft').map(row=><option key={String(row.id??row.code)} value={String(row.id??row.code)}>{label(row)}</option>)}</select></label>}
  <form onSubmit={submit} className="mt-4"><fieldset disabled={Boolean(fenced)}>
   <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{form.fields.map(input=>renderInput(input,values[input.key],value=>setValues(current=>({...current,[input.key]:value})),input.key))}</div>
   {form.lines&&<div className="mt-4 space-y-3">{lines.map((line,index)=><div key={index} className="rounded border border-slate-700 p-3"><p className="mb-2 text-xs">Line {index+1}</p><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{lineFields.map(input=>renderInput(input,line[input.key],value=>setLines(current=>current.map((row,rowIndex)=>rowIndex===index?{...row,[input.key]:value}:row)),`${index}-${input.key}`))}</div><button type="button" onClick={()=>setLines(current=>current.filter((_row,rowIndex)=>rowIndex!==index))} className="mt-2 text-xs text-amber-200">Remove line</button></div>)}<button type="button" disabled={lines.length>=500} onClick={()=>setLines(current=>[...current,initial(lineFields)])} className="rounded border border-slate-600 px-3 py-2 text-xs">Add line</button></div>}
   {form.approval&&<label className="mt-4 block text-xs">Different authorised approver PIN<input required type="password" autoComplete="off" inputMode="numeric" maxLength={12} value={pin} onChange={event=>setPin(event.target.value.replace(/\D/g,''))} className="ml-2 rounded bg-slate-800 p-2"/></label>}
   <button disabled={Boolean(fenced)} className="mt-4 rounded bg-amber-500 px-4 py-2 text-sm font-semibold text-slate-950 disabled:opacity-40">{saving?'Submitting…':form.title}</button>
  </fieldset></form>
 </section>
}
