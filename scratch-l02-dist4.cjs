const fs=require('fs');
function load(f){return fs.readFileSync(f,'utf8').split(/\r?\n/).filter(Boolean).map(l=>JSON.parse(l)).filter(r=>r.recordType==='diagnostic').filter(r=>r.path.startsWith('src/'));}
const d=load('docs/engineering/typescript-migration/evidence/L02-renderer-ipc-diagnostics-2026-10-27T21-46-49-778Z.jsonl');
const m=new Map();
for(const r of d){const t=/on type '([^']+)'/.exec(r.message); if(t) m.set(t[1],(m.get(t[1])||0)+1);}
console.log([...m].sort((a,b)=>b[1]-a[1]).slice(0,20));
const f=d.filter(r=>r.path==='src/renderer/src/components/Reports.jsx');
console.log('Reports',f.length);
for(const r of f.slice(0,40)) console.log(r.line+':'+r.column, r.code, r.message.slice(0,160));
