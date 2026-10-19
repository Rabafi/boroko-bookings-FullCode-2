import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { test } from 'node:test'
import { buildBarTenderBreakdown } from '../src/shared/barTenderAllocation.js'
import { computeCashTender } from '../src/shared/tillBasketRecovery.js'

const root=process.cwd()
const progress=path.join(root,'docs/audits/2026-10-09/bar-v10-continuation')
const v10=path.join(root,'docs/bar-manual/build/remediation-candidate-2026-10-09-v10')
const draft=path.join(progress,'draft-v11-sell-expanded')
const manualName='Tsa-Bonno-Bar-Customer-Manual.pdf'
const verifier=path.join(progress,'scripts/verify_sell_pdf.py')
function run(dir,pdf,expect,report){
  return spawnSync('python',[verifier,'--candidate-dir',dir,'--manual',pdf,'--expect',expect,'--report',report],{cwd:root,encoding:'utf8',maxBuffer:4*1024*1024})
}

test('current cash and provider tender helpers preserve exact sale amount with optional references',()=>{
  const cash=computeCashTender('100','85')
  assert.equal(cash.ok,true)
  assert.equal(cash.cashTender.cash_received,100)
  assert.equal(cash.cashTender.change_due,15)
  assert.equal(cash.cashTender.cash_received-cash.cashTender.change_due,85)
  const direct=buildBarTenderBreakdown({total:85,paymentMethod:'card',paymentReferences:{}})
  assert.equal(direct.ok,true)
  assert.equal(direct.breakdown[0].amount,85)
  assert.equal(direct.breakdown[0].reference,null)
  const split=buildBarTenderBreakdown({total:100,paymentMethod:'split',splitCashAmount:'40',splitRemainderMethod:'mobile_money',paymentReferences:{mobile_money:''}})
  assert.equal(split.ok,true)
  assert.deepEqual(split.breakdown.map(x=>[x.method,x.amount,x.reference]),[['cash',40,null],['mobile_money',60,null]])
})

test('exact frozen v10 manual PDF is red for source-verified Sell wording gaps',()=>{
  const report=path.join(progress,'evidence/exact-v10-sell-red.json')
  const pdf=path.join(v10,'pdf',manualName)
  const result=run(v10,pdf,'red',report)
  assert.equal(result.status,0,result.stdout+'\n'+result.stderr)
  const evidence=JSON.parse(fs.readFileSync(report,'utf8'))
  assert.equal(evidence.red_fixture_validated,true)
  assert.ok(evidence.failed.some(x=>x.includes('BAR-DOC-019')))
  assert.ok(evidence.failed.some(x=>x.includes('BAR-DOC-023')))
  assert.ok(evidence.failed.some(x=>x.includes('BAR-DOC-025')))
})

test('isolated corrected manual draft PDF is green for source-verified Sell wording',()=>{
  const report=path.join(progress,'evidence/draft-v11-sell-expanded-green.json')
  const pdf=path.join(draft,'pdf',manualName)
  const result=run(draft,pdf,'green',report)
  assert.equal(result.status,0,result.stdout+'\n'+result.stderr)
  const evidence=JSON.parse(fs.readFileSync(report,'utf8'))
  assert.deepEqual(evidence.failed,[])
  assert.deepEqual(evidence.task_spans['BAR-DOC-019'],[19,19])
  assert.deepEqual(evidence.task_spans['BAR-DOC-023'],[21,21])
  assert.deepEqual(evidence.task_spans['BAR-DOC-025'],[21,21])
})

test('continuation correction resolves the v10 pre-fix hash to the retained artifact, while exposing the frozen row error',()=>{
  const evidence=JSON.parse(fs.readFileSync(path.join(progress,'preservation-start.json'),'utf8'))
  const item=evidence['V10-EVIDENCE-01']
  const actual=createHash('sha256').update(fs.readFileSync(path.join(root,item.artifact))).digest('hex').toUpperCase()
  assert.equal(actual,'101A8F67A33884B5A5CBF4B43BF3C3087D387A91A7F56651C53A1FD8C79D4A58')
  assert.equal(item.actual_sha256,actual)
  assert.equal(item.actual_matches_correct,true)
  assert.equal(item.frozen_v10_closure_matches_artifact,false)
})

