import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { spawnSync } from 'node:child_process'
let retained
export function buildBarGuideProgressScratch(){
 if(retained)return retained
 const root=process.cwd(),draft=path.join(root,'docs/audits/2026-10-09/bar-v10-continuation/draft-v11-semantic-review-01')
 const scratch=path.join(draft,'scratch',`verification-${new Date().toISOString().replaceAll(':','-')}-${crypto.randomUUID()}`)
 fs.mkdirSync(scratch,{recursive:true});fs.cpSync(path.join(draft,'content'),path.join(scratch,'content'),{recursive:true,errorOnExist:true});fs.cpSync(path.join(draft,'screenshots'),path.join(scratch,'screenshots'),{recursive:true,errorOnExist:true});fs.copyFileSync(path.join(draft,'build_candidate.py'),path.join(scratch,'build_candidate.py'))
 const code=String.raw`import importlib.util,json,sys
from pathlib import Path
S=Path(sys.argv[1]).resolve()
spec=importlib.util.spec_from_file_location('isolated_progress_scratch',S/'build_candidate.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
m.HERE=S;m.CONTENT=S/'content/candidate-content.json';m.PDFDIR=S/'pdf'
a,b=m.build(json.loads(m.CONTENT.read_text(encoding='utf-8')),m.PDFDIR)
print(json.dumps({'root':str(S),'manual':str(a),'quick_start':str(b)}))`
 const run=spawnSync('python',['-c',code,scratch],{cwd:root,encoding:'utf8',timeout:240000,maxBuffer:4*1024*1024})
 fs.writeFileSync(path.join(scratch,'build.log'),run.stdout+'\n'+run.stderr+'\nEXIT_CODE='+run.status+'\n')
 if(run.error||run.status!==0)throw new Error('Scratch build failed: '+(run.error?.message||run.stdout+' '+run.stderr))
 const hash=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex').toUpperCase()
 const record={...JSON.parse(run.stdout),content_sha256:hash(path.join(scratch,'content/candidate-content.json')),builder_sha256:hash(path.join(scratch,'build_candidate.py')),pdf_sha256:{manual:hash(path.join(scratch,'pdf/Tsa-Bonno-Bar-Customer-Manual.pdf')),quick_start:hash(path.join(scratch,'pdf/Tsa-Bonno-Bar-Quick-Start.pdf'))},status:'retained disposable progress scratch; not candidate/approval'}
 fs.writeFileSync(path.join(scratch,'identity.json'),JSON.stringify(record,null,2)+'\n');retained=scratch;return scratch
}
