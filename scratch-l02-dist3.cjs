const fs=require('fs');
function load(f){return fs.readFileSync(f,'utf8').split(/\r?\n/).filter(Boolean).map(l=>JSON.parse(l)).filter(r=>r.recordType==='diagnostic');}
const files={main:'docs/engineering/typescript-migration/evidence/L02-main-surface-diagnostics-2026-10-27T21-55-07-267Z.jsonl',renderer:'docs/engineering/typescript-migration/evidence/L02-renderer-ipc-diagnostics-2026-10-27T21-46-49-778Z.jsonl'};
for(const [k,f] of Object.entries(files)){
 const d=load(f).filter(r=>r.path.startsWith('src/'));
 const norm=s=>s.replace(/'[^']*'/g,"'X'").replace(/\b\d+\b/g,'N');
 const pats=new Map();
 for(const r of d){const key=r.code+'|'+norm(r.message);pats.set(key,(pats.get(key)||0)+1);}
 console.log('====',k,'src diagnostics',d.length);
 for(const [p,n] of [...pats].sort((a,b)=>b[1]-a[1]).slice(0,25)) console.log(n,p.slice(0,180));
}
