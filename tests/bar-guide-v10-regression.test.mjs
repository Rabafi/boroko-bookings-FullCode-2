import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { test } from 'node:test'
import { spawnSync } from 'node:child_process'

const root=process.cwd()
const verifier=path.join(root,'tests','bar-guide-v10-regression.py')
const v9=path.join(root,'docs','bar-manual','build','remediation-candidate-2026-10-09-v9')
const v10=path.join(root,'docs','bar-manual','build','remediation-candidate-2026-10-09-v10')
const audit=path.join(root,'docs','audits','2026-10-09','bar-v10-progress')
const redEvidence=path.join(audit,'exact-v9-red.json')
const preFixQuick=path.join(audit,'exact-v10-quick-before-duplicate-fix.pdf')
const preFixRecord=path.join(audit,'exact-v10-quick-before-duplicate-fix.json')
const duplicateCheck='quick start has no duplicate packaged-stock recovery heading'
const run=(candidate,expect,report,redPath,overrides={})=>spawnSync('python',[verifier,'--manual',overrides.manual||path.join(candidate,'pdf','Tsa-Bonno-Bar-Customer-Manual.pdf'),'--quick',overrides.quick||path.join(candidate,'pdf','Tsa-Bonno-Bar-Quick-Start.pdf'),'--candidate-dir',candidate,'--expect',expect,...(report?['--report',report]:[]),...(redPath?['--red-evidence',redPath]:[])],{cwd:root,encoding:'utf8',maxBuffer:4*1024*1024})

function buildIsolatedScratchCandidate(){
  const scratchRoot=fs.mkdtempSync(path.join(os.tmpdir(),'bar-guide-v10-scratch-'))
  const scratch=path.join(scratchRoot,'candidate')
  fs.mkdirSync(scratch,{recursive:true})
  fs.cpSync(path.join(v10,'content'),path.join(scratch,'content'),{recursive:true})
  fs.cpSync(path.join(v10,'screenshots'),path.join(scratch,'screenshots'),{recursive:true})
  fs.copyFileSync(path.join(v10,'build_candidate.py'),path.join(scratch,'build_candidate.py'))
  const output=path.join(scratch,'pdf')
  const build=spawnSync('python',[path.join(scratch,'build_candidate.py'),'--output-dir',output],{cwd:root,encoding:'utf8',maxBuffer:4*1024*1024})
  if(build.status!==0){
    const rel=path.relative(os.tmpdir(),path.resolve(scratchRoot))
    if(rel&&!rel.startsWith('..')&&!path.isAbsolute(rel)&&path.basename(scratchRoot).startsWith('bar-guide-v10-scratch-'))fs.rmSync(scratchRoot,{recursive:true,force:true})
    assert.equal(build.status,0,build.stdout+'\n'+build.stderr)
  }
  return {scratchRoot,candidate:scratch}
}
function removeScratch(scratchRoot){
  const resolved=path.resolve(scratchRoot)
  const rel=path.relative(path.resolve(os.tmpdir()),resolved)
  assert.ok(rel&&!rel.startsWith('..')&&!path.isAbsolute(rel),'scratch cleanup must stay inside the generated temp directory')
  assert.match(path.basename(resolved),/^bar-guide-v10-scratch-/,"scratch cleanup must name only this test run's unique directory")
  fs.rmSync(resolved,{recursive:true,force:true})
}

test('exact v9 PDFs fail the receipt-wide mixed-stock safeguards as a red fixture',()=>{
  const result=run(v9,'red')
  assert.equal(result.status,0,result.stdout+'\n'+result.stderr)
  const evidence=JSON.parse(result.stdout)
  assert.equal(evidence.red_evidence_validated,true)
  assert.ok(evidence.failed.includes('manual states one receipt-wide stock choice'))
  assert.ok(evidence.failed.includes('quick start has concise receipt-wide stop warning and exact task pointer'))
})

test('frozen exact pre-fix v10 Quick Start fails only the duplicate-section PDF regression',()=>{
  const record=JSON.parse(fs.readFileSync(preFixRecord,'utf8'))
  const bytes=fs.readFileSync(preFixQuick)
  assert.equal(createHash('sha256').update(bytes).digest('hex').toUpperCase(),record.sha256)
  assert.equal(record.sha256,'101A8F67A33884B5A5CBF4B43BF3C3087D387A91A7F56651C53A1FD8C79D4A58')
  assert.equal(record.duplicate_heading_count,2)
  const result=run(v10,'green',path.join(audit,'exact-v10-duplicate-red.json'),redEvidence,{quick:preFixQuick})
  assert.equal(result.status,1,result.stdout+'\n'+result.stderr)
  const evidence=JSON.parse(fs.readFileSync(path.join(audit,'exact-v10-duplicate-red.json'),'utf8'))
  assert.deepEqual(evidence.failed,[duplicateCheck])
})

test('isolated scratch build passes receipt-wide and no-duplicate exact-PDF checks',()=>{
  const built=buildIsolatedScratchCandidate()
  try{
    const result=run(built.candidate,'green',path.join(audit,'scratch-v10-green.json'),redEvidence)
    assert.equal(result.status,0,result.stdout+'\n'+result.stderr)
    const evidence=JSON.parse(result.stdout)
    assert.deepEqual(evidence.failed,[])
    assert.equal(evidence.red_evidence_validated,true)
  }finally{removeScratch(built.scratchRoot)}
})

test('final v10 exact PDFs pass receipt-wide and no-duplicate safeguards',()=>{
  const result=run(v10,'green',path.join(v10,'evidence','exact-v10-green.json'),redEvidence)
  assert.equal(result.status,0,result.stdout+'\n'+result.stderr)
  const evidence=JSON.parse(result.stdout)
  assert.deepEqual(evidence.failed,[])
  assert.equal(evidence.red_evidence_validated,true)
})
