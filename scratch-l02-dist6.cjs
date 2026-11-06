const fs=require('fs');
function load(f){return fs.readFileSync(f,'utf8').split(/\r?\n/).filter(Boolean).map(l=>JSON.parse(l)).filter(r=>r.recordType==='diagnostic');}
const d=load('docs/engineering/typescript-migration/evidence/L02-main-surface-diagnostics-2026-10-27T21-55-07-267Z.jsonl');
for(const file of ['src/main/domains/starterBackup.js','src/main/ai/aiOrchestrator.js','src/main/domains/reports.js','src/main/domains/customerCredit.js','src/main/domains/inventory.js']){
 const rows=d.filter(r=>r.path===file);
 const codes={}; for(const r of rows) codes[r.code]=(codes[r.code]||0)+1;
 console.log('\n===',file,rows.length,JSON.stringify(codes));
 for(const r of rows.slice(0,12)) console.log(r.line, r.code, r.message.split('\n')[0].slice(0,150));
}
