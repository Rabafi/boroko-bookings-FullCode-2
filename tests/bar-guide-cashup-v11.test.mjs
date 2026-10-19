import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { test } from 'node:test'
import { buildBarGuideProgressScratch } from './helpers/build-bar-guide-progress-scratch-v11.mjs'

const root=process.cwd()
const draft=path.join(root,'docs/audits/2026-10-09/bar-v10-continuation/draft-v11-semantic-review-01')
const regression=path.join(root,'tests/bar-guide-cashup-v11-regression.py')
function run(mode,pdfDir){
 const result=spawnSync('python',[regression,'--mode',mode,'--pdf-dir',pdfDir],{cwd:root,encoding:'utf8',timeout:240000,maxBuffer:4*1024*1024})
 assert.equal(result.error,undefined,result.error?.message)
 assert.equal(result.status,0,mode+' '+pdfDir+': '+result.stdout+'\n'+result.stderr)
 return JSON.parse(result.stdout)
}

test('cash-up distinctions are red on exact v10 and pass in isolated scratch and candidate PDFs',()=>{
 const v10=path.join(root,'docs/bar-manual/build/remediation-candidate-2026-10-09-v10/pdf')
 const red=run('red',v10)
 assert.equal(red.outcome,'EXPECTED_RED_EXACT_V10')
 assert.ok(red.missing_semantics.some(x=>x.includes('your own account workflow')))
 assert.ok(red.missing_semantics.some(x=>x.includes('operator identity')))
 const scratch=buildBarGuideProgressScratch()
 const scratchResult=run('green',path.join(scratch,'pdf'))
 assert.equal(scratchResult.outcome,'PASS_ACTUAL_PDF_AND_CURRENT_SOURCE')
 assert.equal(scratchResult.cashup_tasks['BAR-DOC-053'].first, scratchResult.cashup_tasks['BAR-DOC-053'].bookmark_page)
 const finalResult=run('green',path.join(draft,'pdf'))
 assert.equal(finalResult.outcome,'PASS_ACTUAL_PDF_AND_CURRENT_SOURCE')
 assert.equal(finalResult.manual_pages,scratchResult.manual_pages,'scratch and candidate manual should have the same pagination')
 assert.equal(finalResult.quick_pages,scratchResult.quick_pages,'scratch and candidate Quick Start should have the same pagination')
 assert.deepEqual(finalResult.cashup_tasks,scratchResult.cashup_tasks,'scratch and candidate PDFs should expose the same cash-up task text, ranges and bookmarks')
 assert.deepEqual(finalResult.source_sha256,scratchResult.source_sha256,'scratch and candidate source checks should be identical')
 const modifierTemp=fs.mkdtempSync(path.join(root,'tmp','bar-guide-cashup-modifier-v12-'))
 const modifierSource=fs.readFileSync(path.join(draft,'evidence/build_modifier_bindings_v11.py'),'utf8')
 const v12Rel='docs/audits/2026-10-12/bar-v11-continuation/draft-v12-receipt-recovery-01'
 const outputStem=`${v12Rel}/evidence/modifier-bindings-source-revalidation-${process.pid}`
 const replacements=[
  ["D=ROOT/'docs/audits/2026-10-09/bar-v10-continuation/draft-v11-semantic-review-01'",`D=ROOT/'${v12Rel}'`],
  ["CENSUS=ROOT/'docs/audits/2026-10-09/bar-v10-continuation/discovery/scratch-census-v11a/ui-control-census-v9.csv'","LEGACY_CENSUS=ROOT/'docs/audits/2026-10-09/bar-v10-continuation/discovery/scratch-census-v11a/ui-control-census-v9.csv'\nCENSUS=ROOT/'docs/audits/2026-10-12/bar-v11-continuation/evidence/fresh-census-v12/ui-control-census-v9.csv'"],
  ["OUT=D/'evidence/modifier-control-bindings-v11.csv'",`OUT=ROOT/'${outputStem}.csv'`],
  ["SUMMARY=D/'evidence/modifier-control-bindings-v11.json'",`SUMMARY=ROOT/'${outputStem}.json'`],
 ]
 let isolatedModifierSource=modifierSource
 for(const [before,after] of replacements){assert.equal(isolatedModifierSource.split(before).length-1,1,'expected one frozen builder target: '+before);isolatedModifierSource=isolatedModifierSource.replace(before,after)}
 const rawNeedle="raw={r['action_id']:r for r in read_csv(CENSUS)}"
 const rawReplacement=String.raw`legacy_raw={r['action_id']:r for r in read_csv(LEGACY_CENSUS)}
current_rows=read_csv(CENSUS)
raw={r['action_id']:r for r in current_rows}`
 assert.equal(isolatedModifierSource.split(rawNeedle).length-1,1,'expected one historic census raw-map anchor')
 isolatedModifierSource=isolatedModifierSource.replace(rawNeedle,rawReplacement)
 const oldIdAssert="assert set(MAP)<=set(raw),f'Controls missing from census: {sorted(set(MAP)-set(raw))}'"
 assert.equal(isolatedModifierSource.split(oldIdAssert).length-1,1,'expected one historic census-ID assertion')
 isolatedModifierSource=isolatedModifierSource.replace(oldIdAssert,'# Historic IDs are rebound after exact source anchors are available.')
 const loopNeedle="for aid,(action,role,event,effect,gates,cancel,ref,termspec) in MAP.items():"
 const rebindSource=String.raw`def rebind_norm(value): return re.sub(r'\s+',' ',str(value or '')).strip().casefold()
HISTORIC_BY_CURRENT={}
rebound_map={}
rebound_anchors={}
for historic_id,value in MAP.items():
 old=legacy_raw[historic_id]
 event=old.get('event_props','')
 candidates=[r for r in current_rows if r['source_file']==old['source_file'] and rebind_norm(r['control_label'])==rebind_norm(old['control_label']) and event and event in r.get('event_props','')]
 assert len(candidates)==1,f'Historic control must uniquely rebind by source, exact label and handler: {historic_id}: {len(candidates)}'
 current_id=candidates[0]['action_id']
 assert current_id not in rebound_map,f'Current control cannot absorb two historic bindings: {current_id}'
 HISTORIC_BY_CURRENT[current_id]=historic_id
 rebound_map[current_id]=value
 rebound_anchors[current_id]=ANCHORS[historic_id]
MAP=rebound_map
ANCHORS=rebound_anchors
assert set(MAP)<=set(raw),f'Controls missing from current census: {sorted(set(MAP)-set(raw))}'`
 assert.equal(isolatedModifierSource.split(loopNeedle).length-1,1,'expected one modifier binding loop anchor')
 isolatedModifierSource=isolatedModifierSource.replace(loopNeedle,rebindSource+'\n'+loopNeedle)
 const rawBindingNeedle="'raw_binding_id':aid,'control_label':r['control_label'],"
 const rawBindingReplacement="'raw_binding_id':aid,'historic_raw_binding_id':HISTORIC_BY_CURRENT[aid],'control_label':r['control_label'],"
 assert.equal(isolatedModifierSource.split(rawBindingNeedle).length-1,1,'expected one modifier evidence row anchor')
 isolatedModifierSource=isolatedModifierSource.replace(rawBindingNeedle,rawBindingReplacement)
 const summaryNeedle="summary={'controls_bound':len(rows),"
 const summaryReplacement="summary={'controls_bound':len(rows),'rebind_method':'exact source file + normalized visible label + historic event-props substring','historic_to_current_action_ids':{v:k for k,v in HISTORIC_BY_CURRENT.items()},"
 assert.equal(isolatedModifierSource.split(summaryNeedle).length-1,1,'expected one modifier summary anchor')
 isolatedModifierSource=isolatedModifierSource.replace(summaryNeedle,summaryReplacement)
 const isolatedModifierBuilder=path.join(modifierTemp,'build_modifier_bindings_v12_revalidation.py')
 fs.writeFileSync(isolatedModifierBuilder,isolatedModifierSource)
 let bindings
 try{bindings=spawnSync('python',[isolatedModifierBuilder],{cwd:root,encoding:'utf8',timeout:120000,maxBuffer:2*1024*1024})}finally{fs.rmSync(modifierTemp,{recursive:true,force:true})}
 assert.equal(bindings.error,undefined,bindings.error?.message)
 assert.equal(bindings.status,0,bindings.stdout+'\n'+bindings.stderr)
 const bindingResult=JSON.parse(bindings.stdout)
 assert.equal(bindingResult.controls_bound,13)
 assert.equal(bindingResult.all_current_control_anchors_verified,true)
 assert.deepEqual(bindingResult.missing_pdf_terms,[])
})
