import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { BookOpen, Link2, RefreshCw, RotateCcw, Send } from 'lucide-react'
import { useAccess, useAuth, useSettings } from '../../app-context'
import { createManualJournalIntent, journalIntentStorageKey, loadManualJournalIntent, normalizeManualJournalPayload, reconcileManualJournalStatus, restoreManualJournalForm, saveManualJournalIntent } from './journalIntent'
import { normalizeTrialBalanceResponse } from './trialBalanceResponse'
import { canAccessCapability } from '../../../../shared/accessControl'
import { AccountingButton, AccountingExportButton, AccountingLoading, AccountingNotice, AccountingPage, AccountingPanel, EmptyState, accountingInvoke, firstOfMonth, inputClass, labelClass, money, runIdempotent, today, unwrap } from './RestaurantAccountingUi'

const emptyJournal = () => ({ entryDate: today(), description: '', referenceNumber: '', lines: [{ accountId:'',debit:'',credit:'',memo:'' },{ accountId:'',debit:'',credit:'',memo:'' }] })

// Malformed server responses (null data, missing arrays) must render as empty
// ledger state, never crash the page into the recovery screen.
const normalizeWorkspace = (value) => {
  const source = value && typeof value === 'object' ? value : {}
  return {
    ...source,
    entries: Array.isArray(source.entries)
      ? source.entries.map((entry) => ({
        ...(entry && typeof entry === 'object' ? entry : {}),
        lines: Array.isArray(entry?.lines) ? entry.lines : [],
      }))
      : [],
    trial_balance: Array.isArray(source.trial_balance) ? source.trial_balance : [],
  }
}
const normalizeRows = (value) => (Array.isArray(value) ? value : [])

export default function RestaurantGeneralLedger() {
  const { user } = useAuth()
  const { settings } = useSettings()
  const lodgeId = String(settings?.lodge_id || user?.lodge_id || '').trim()
  const actorId = String(user?.id || user?.user_id || '').trim()
  const journalIntentKey = journalIntentStorageKey(lodgeId, actorId)
  const journalSubmitLock = useRef(false)
  const access=useAccess(), canManage=canAccessCapability(access,'accounting.manage')
  const ledgerLoadRevision=useRef(0)
  const [trialBalance,setTrialBalance]=useState(null)
  const [accounts,setAccounts]=useState([]),[workspace,setWorkspace]=useState(normalizeWorkspace()),[mappings,setMappings]=useState([])
  const [filters,setFilters]=useState({startDate:firstOfMonth(),endDate:today(),accountId:''}),[journal,setJournal]=useState(emptyJournal())
  const [mapping,setMapping]=useState({mappingType:'category',sourceKey:'',accountId:''}),[orderId,setOrderId]=useState(''),[draftId,setDraftId]=useState('')
  const [loading,setLoading]=useState(true),[busy,setBusy]=useState(''),[error,setError]=useState(''),[notice,setNotice]=useState('')
  const [journalIntent,setJournalIntent]=useState(null),[journalRecoveryBlocked,setJournalRecoveryBlocked]=useState(false),[journalIntentScopeReadyFor,setJournalIntentScopeReadyFor]=useState('')
  const pendingJournalIntent = journalIntent?.scopeKey === journalIntentKey ? journalIntent : null
  const journalIntentScopeReady = journalIntentScopeReadyFor === journalIntentKey

  const load=useCallback(async()=>{const revision=++ledgerLoadRevision.current;setLoading(true);setError('');setTrialBalance(null);try{const [a,w,m,t]=await Promise.all([accountingInvoke('getAccounts'),accountingInvoke('getLedgerPage',{...filters,cursor:null,pageSize:100}),accountingInvoke('getPosMappings'),accountingInvoke('getLedger',filters)]);if(revision!==ledgerLoadRevision.current)return;setAccounts(normalizeRows(unwrap(a,[])));setWorkspace(normalizeWorkspace(unwrap(w,{})));setMappings(normalizeRows(unwrap(m,[])));setTrialBalance(normalizeTrialBalanceResponse(t))}catch(e){if(revision===ledgerLoadRevision.current)setError(e.message)}finally{if(revision===ledgerLoadRevision.current)setLoading(false)}},[filters,lodgeId,actorId])
  const loadMore=async()=>{if(!workspace.next_cursor)return;const revision=ledgerLoadRevision.current;setBusy('page');setError('');try{const next=normalizeWorkspace(unwrap(await accountingInvoke('getLedgerPage',{...filters,cursor:workspace.next_cursor,pageSize:100}),{}));if(revision!==ledgerLoadRevision.current)return;setWorkspace({...next,entries:[...workspace.entries,...next.entries]})}catch(e){setError(e.message)}finally{setBusy('')}}
  useEffect(()=>{load();return()=>{ledgerLoadRevision.current+=1}},[load])
  useEffect(()=>{
    setJournalIntentScopeReadyFor('')
    setDraftId('')
    setJournalRecoveryBlocked(false)
    if(!journalIntentKey){setJournalIntent(null);setJournalIntentScopeReadyFor(journalIntentKey);return}
    try{
      const restored=loadManualJournalIntent(window.localStorage,journalIntentKey,journalIntentKey)
      setJournalIntent(restored)
      if(restored)setJournal(restoreManualJournalForm(restored))
      setJournalIntentScopeReadyFor(journalIntentKey)
    }catch(e){setJournalRecoveryBlocked(true);setJournalIntentScopeReadyFor(journalIntentKey);setError(e.message)}
  },[journalIntentKey])
  const totals=useMemo(()=>(trialBalance||[]).reduce((v,row)=>({debit:v.debit+Number(row.debit||0),credit:v.credit+Number(row.credit||0)}),{debit:0,credit:0}),[trialBalance])
  const journalTotals=journal.lines.reduce((v,row)=>({debit:v.debit+Number(row.debit||0),credit:v.credit+Number(row.credit||0)}),{debit:0,credit:0})
  const setLine=(index,key,value)=>setJournal({...journal,lines:journal.lines.map((line,i)=>i===index?{...line,[key]:value}:line)})
  const addLine=()=>setJournal({...journal,lines:[...journal.lines,{accountId:'',debit:'',credit:'',memo:''}]})

  const submitJournalIntent=async(intent,lockHeld=false)=>{
    if(journalSubmitLock.current&&!lockHeld)return
    journalSubmitLock.current=true
    setBusy('journal');setError('');setNotice('')
    try{
      const response=unwrap(await accountingInvoke('createAndSubmitManualJournal',{operationId:intent.operationId,payload:intent.payload}),{})
      const result=response?.data||response
      const id=result?.id
      const status=result?.status
      if(!id||!['submitted','approved','posted'].includes(status))throw new Error('The server returned no confirmed manual journal status. Check server status before starting another journal.')
      setDraftId(id)
      window.localStorage.removeItem(journalIntentKey)
      setJournalIntent(null)
      setJournal(emptyJournal())
      setNotice(status==='submitted'?`Journal submitted for independent approval. Draft ${id}`:`This journal already reached ${status}. Draft ${id}`)
      await load()
    }catch(e){
      const uncertain={...intent,state:'unknown'}
      try{saveManualJournalIntent(window.localStorage,journalIntentKey,uncertain);setJournalIntent(uncertain)}catch(storageError){setError(`${e.message} The pending journal recovery record could not be updated: ${storageError.message}`);return}
      setError(`${e.message} Use Check server status before creating another journal.`)
    }finally{journalSubmitLock.current=false;setBusy('')}
  }
  const postJournal=async(e)=>{
    e.preventDefault()
    if(journalSubmitLock.current)return
    journalSubmitLock.current=true
    if(pendingJournalIntent){journalSubmitLock.current=false;setError('A manual journal is awaiting recovery. Check its server status before editing or starting another.');return}
    if(!journalIntentScopeReady){journalSubmitLock.current=false;setError('The active profile recovery check is still running. Try again in a moment.');return}
    if(journalRecoveryBlocked){journalSubmitLock.current=false;setError('A saved manual journal recovery record must be resolved before another submission.');return}
    if(!journalIntentKey){journalSubmitLock.current=false;setError('The active lodge and signed-in actor could not be confirmed; the journal was not submitted.');return}
    try{
      const payload=normalizeManualJournalPayload(journal)
      const operationId=window.crypto?.randomUUID?.()
      if(!operationId)throw new Error('This device cannot create a UUID recovery key; the journal was not submitted.')
      const intent=createManualJournalIntent({scopeKey:journalIntentKey,payload,operationId})
      saveManualJournalIntent(window.localStorage,journalIntentKey,intent)
      setJournalIntent(intent)
      await submitJournalIntent(intent,true)
    }catch(e2){setError(e2.message);journalSubmitLock.current=false;setBusy('')}
  }
  const checkJournalStatus=async()=>{
    if(!pendingJournalIntent||journalSubmitLock.current)return
    journalSubmitLock.current=true;setBusy('journal-status');setError('')
    try{
      const response=unwrap(await accountingInvoke('getManualJournalSubmissionStatus',pendingJournalIntent.operationId),{})
      const result=response?.data||response
      const recovery=reconcileManualJournalStatus(pendingJournalIntent,result)
      if(recovery.draftId)setDraftId(recovery.draftId)
      if(recovery.terminal){
        window.localStorage.removeItem(journalIntentKey);setJournalIntent(null);setJournalRecoveryBlocked(false)
        if(recovery.status!=='rejected')setJournal(emptyJournal())
        setNotice(recovery.status==='rejected'?`The server confirms journal ${recovery.draftId} was rejected. Correct or replace the saved entry before submitting with a new operation key.`:`The server confirms journal ${recovery.draftId} is ${recovery.status}. No duplicate submission was created.`)
      }else{
        saveManualJournalIntent(window.localStorage,journalIntentKey,recovery.intent);setJournalIntent(recovery.intent)
        setNotice(recovery.draftId?`The original draft ${recovery.draftId} is ${recovery.status||'in progress'}. Retry the same saved submission to continue it.`:'No committed journal is visible yet. The original request may still arrive. Keep this recovery record and retry only the saved submission with its original operation key.')
      }
    }catch(e){setError(`Submission status could not be confirmed. Keep the saved entry and retry status check: ${e.message}`)}
    finally{journalSubmitLock.current=false;setBusy('')}
  }

  const submitLegacyDraft=async()=>{if(!draftId.trim())return;setBusy('draft');setError('');try{const result=unwrap(await accountingInvoke('submitLegacyJournal',draftId.trim()),{});setNotice(`Legacy manual journal ${result?.id||draftId.trim()} submitted for independent approval.`)}catch(e){setError(e.message)}finally{setBusy('')}}
  const approveDraft=async()=>{setBusy('draft');setError('');try{await accountingInvoke('approveManualJournal',draftId.trim());setNotice('Manual journal approved. A separate posting action is now required.')}catch(e){setError(e.message)}finally{setBusy('')}}
  const postDraft=async()=>{setBusy('draft');setError('');try{await accountingInvoke('postManualJournal',draftId.trim());setNotice('Manual journal posted atomically and is now immutable.');await load()}catch(e){setError(e.message)}finally{setBusy('')}}
  const reverse=async(entry)=>{const reason=window.prompt('Reason for reversal (required):');if(!reason)return;setBusy(entry.id);setError('');try{await runIdempotent(`reversal:${entry.id}`,operationKey=>accountingInvoke('reverseJournal',{entryId:entry.id,reason,operationKey}));setNotice('Reversal journal posted. The original remains in the audit trail.');await load()}catch(e){setError(e.message)}finally{setBusy('')}}
  const saveMapping=async(e)=>{e.preventDefault();setBusy('mapping');setError('');try{await accountingInvoke('setPosMapping',mapping);setMapping({...mapping,sourceKey:'',accountId:''});setNotice('POS mapping saved. Future order postings use this account.');await load()}catch(e2){setError(e2.message)}finally{setBusy('')}}
  const postOrder=async(e)=>{e.preventDefault();setBusy('order');setError('');try{const result=await accountingInvoke('postPosOrder',orderId.trim());setNotice(unwrap(result,{})?.replayed===true?'This POS order was already posted; no duplicate journal was created.':'POS order posted as one retry-safe journal.');setOrderId('');await load()}catch(e2){setError(e2.message)}finally{setBusy('')}}

  return <AccountingPage title="General ledger" description="Review immutable journals, submit balanced manual entries for independent approval, reverse mistakes, and post individual POS orders using explicit revenue, tender, tax, discount, and tip mappings." actions={<><AccountingExportButton fileName="general-ledger" exportOperation="exportLedgerReport" exportArgs={[filters]} onError={setError}/><AccountingButton tone="secondary" onClick={load}><RefreshCw size={15}/>Refresh</AccountingButton></>}>
    <AccountingNotice>Posted journals cannot be edited or deleted. Corrections create dated reversal journals, preserving the original evidence.</AccountingNotice>
    {error&&<AccountingNotice type="error">{error}</AccountingNotice>}{notice&&<AccountingNotice type="success">{notice}</AccountingNotice>}
    <AccountingPanel title="Ledger filters" className="mb-4"><div className="grid gap-3 md:grid-cols-4"><label className={labelClass}>From<input type="date" className={inputClass} value={filters.startDate} onChange={e=>setFilters({...filters,startDate:e.target.value})}/></label><label className={labelClass}>To<input type="date" className={inputClass} value={filters.endDate} onChange={e=>setFilters({...filters,endDate:e.target.value})}/></label><label className={labelClass}>Account<select className={inputClass} value={filters.accountId} onChange={e=>setFilters({...filters,accountId:e.target.value})}><option value="">All accounts</option>{accounts.map(a=><option key={a.id} value={a.id}>{a.code} — {a.name}</option>)}</select></label></div></AccountingPanel>
    {loading?<AccountingLoading/>:<div className="space-y-4">
      <AccountingPanel title="Trial balance" description={trialBalance===null?'Trial balance unavailable. Refresh to verify the server totals.':`Debits ${money(totals.debit)} · Credits ${money(totals.credit)}`}>
        {trialBalance===null?<EmptyState title="Trial balance could not be verified"/>:trialBalance.length===0?<EmptyState title="No posted ledger activity in this period"/>:<div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="border-b text-left text-xs text-slate-500"><th className="py-2">Account</th><th className="text-right">Debit</th><th className="text-right">Credit</th><th className="text-right">Natural balance</th></tr></thead><tbody>{trialBalance.map(r=><tr key={r.account_id} className="border-b border-slate-100"><td className="py-2"><b>{r.code}</b> — {r.name}</td><td className="text-right">{money(r.debit)}</td><td className="text-right">{money(r.credit)}</td><td className="text-right font-bold">{money(r.balance)}</td></tr>)}</tbody></table></div>}
      </AccountingPanel>
      <AccountingPanel title="Posted journals" description={`${workspace.returned_count||workspace.entries.length} of ${workspace.total_count||workspace.entries.length} rows · ${workspace.complete===false?'More pages available':'Complete screen population'}`}>
        {workspace.entries.length===0?<EmptyState title="No journals found"/>:<div className="space-y-3">{workspace.entries.map(e=><article key={e.id} className="rounded-xl border border-slate-200 p-3"><div className="flex flex-wrap justify-between gap-2"><div><b>{e.entry_date} · {e.description}</b><p className="text-xs text-slate-500">{e.source_type} · {e.reference_number||'No reference'} · Key {e.posting_key}</p></div>{canManage&&!e.reversal_of&&<AccountingButton tone="secondary" busy={busy===e.id} onClick={()=>reverse(e)}><RotateCcw size={14}/>Reverse</AccountingButton>}</div><div className="mt-3 grid gap-1">{e.lines.map(line=><div key={line.id} className="grid grid-cols-[1fr_auto_auto] gap-4 text-xs"><span>{line.account_code} — {line.account_name}</span><span>D {money(line.debit)}</span><span>C {money(line.credit)}</span></div>)}</div></article>)}</div>}
        {workspace.has_more&&<AccountingButton tone="secondary" busy={busy==='page'} onClick={loadMore}>Load next ledger page</AccountingButton>}
      </AccountingPanel>
      {canManage&&<div className="grid gap-4 xl:grid-cols-2">
        <AccountingPanel title="Submit manual journal" description="Submission creates a draft and requires evidence; an independent authorized user must approve and post it."><form className="space-y-3" onSubmit={postJournal}><fieldset disabled={Boolean(pendingJournalIntent)||!journalIntentScopeReady} className="space-y-3"><div className="grid gap-3 sm:grid-cols-2"><label className={labelClass}>Date<input required type="date" className={inputClass} value={journal.entryDate} onChange={e=>setJournal({...journal,entryDate:e.target.value})}/></label><label className={labelClass}>Reference<input className={inputClass} value={journal.referenceNumber} onChange={e=>setJournal({...journal,referenceNumber:e.target.value})}/></label></div><label className={labelClass}>Description<input required className={inputClass} value={journal.description} onChange={e=>setJournal({...journal,description:e.target.value})}/></label><label className={labelClass}>Evidence / attachment reference<input required className={inputClass} placeholder="Receipt, approval, or document reference" value={journal.evidenceRef||''} onChange={e=>setJournal({...journal,evidenceRef:e.target.value})}/></label>{journal.lines.map((line,i)=><div key={i} className="grid gap-2 rounded-xl bg-slate-50 p-2 sm:grid-cols-[1fr_100px_100px]"><select required className={inputClass} value={line.accountId} onChange={e=>setLine(i,'accountId',e.target.value)}><option value="">Account</option>{accounts.filter(a=>a.is_active).map(a=><option key={a.id} value={a.id}>{a.code} — {a.name}</option>)}</select><input aria-label="Debit" placeholder="Debit" type="number" min="0" step="0.01" className={inputClass} value={line.debit} onChange={e=>setLine(i,'debit',e.target.value)}/><input aria-label="Credit" placeholder="Credit" type="number" min="0" step="0.01" className={inputClass} value={line.credit} onChange={e=>setLine(i,'credit',e.target.value)}/></div>)}<div className="flex flex-wrap items-center gap-3"><AccountingButton tone="secondary" disabled={Boolean(pendingJournalIntent)} onClick={addLine}>Add line</AccountingButton><span className={`text-xs font-bold ${journalTotals.debit===journalTotals.credit&&journalTotals.debit>0?'text-emerald-700':'text-rose-700'}`}>D {money(journalTotals.debit)} · C {money(journalTotals.credit)}</span><AccountingButton busy={busy==='journal'} disabled={Boolean(pendingJournalIntent)||journalTotals.debit!==journalTotals.credit||journalTotals.debit<=0||!journalIntentKey||journalRecoveryBlocked||!journalIntentScopeReady} type="submit"><BookOpen size={15}/>Submit journal</AccountingButton></div></fieldset></form></AccountingPanel>
        <div className="space-y-4">{pendingJournalIntent&&<AccountingPanel title="Resolve pending journal submission" description="The original normalized payload and operation UUID stay locked until the server confirms the outcome."><p className="text-sm text-slate-700">{pendingJournalIntent.payload?.description||"Manual journal"} · Operation {pendingJournalIntent.operationId} · {pendingJournalIntent.state||"status unknown"}</p><div className="mt-3 flex flex-wrap gap-2"><AccountingButton disabled={busy!==""} busy={busy==="journal-status"} onClick={checkJournalStatus}>Check server status</AccountingButton><AccountingButton disabled={busy!==""} busy={busy==="journal"} onClick={()=>submitJournalIntent(pendingJournalIntent)}>Retry original submission</AccountingButton></div></AccountingPanel>}<AccountingPanel title="Approve or post a submitted draft" description="Use the draft ID after an independent maker-checker review."><div className="flex gap-2"><input className={inputClass} placeholder="Manual journal draft UUID" value={draftId} onChange={e=>setDraftId(e.target.value)}/><AccountingButton busy={busy==='draft'} onClick={submitLegacyDraft}>Submit legacy draft</AccountingButton><AccountingButton busy={busy==='draft'} onClick={approveDraft}>Approve</AccountingButton><AccountingButton busy={busy==='draft'} onClick={postDraft}>Post</AccountingButton></div></AccountingPanel><AccountingPanel title="POS GL mapping"><form className="grid gap-3" onSubmit={saveMapping}><label className={labelClass}>Mapping type<select className={inputClass} value={mapping.mappingType} onChange={e=>setMapping({...mapping,mappingType:e.target.value})}>{['category','tender','discount','tax','tips'].map(x=><option key={x}>{x}</option>)}</select></label><label className={labelClass}>Source key<input required className={inputClass} placeholder="e.g. food, cash, vat" value={mapping.sourceKey} onChange={e=>setMapping({...mapping,sourceKey:e.target.value})}/></label><label className={labelClass}>GL account<select required className={inputClass} value={mapping.accountId} onChange={e=>setMapping({...mapping,accountId:e.target.value})}><option value="">Select</option>{accounts.filter(a=>a.is_active).map(a=><option key={a.id} value={a.id}>{a.code} — {a.name}</option>)}</select></label><AccountingButton busy={busy==='mapping'} type="submit"><Link2 size={15}/>Save mapping</AccountingButton></form><p className="mt-3 text-xs text-slate-500">{mappings.length} mappings configured.</p></AccountingPanel><AccountingPanel title="Post one POS order" description="Uses the order UUID as the permanent source identity. Retries cannot duplicate it."><form className="flex gap-2" onSubmit={postOrder}><input required className={inputClass} placeholder="POS order UUID" value={orderId} onChange={e=>setOrderId(e.target.value)}/><AccountingButton busy={busy==='order'} type="submit"><Send size={15}/>Post</AccountingButton></form></AccountingPanel></div>
      </div>}
    </div>}
  </AccountingPage>
}
