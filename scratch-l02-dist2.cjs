const fs=require('fs');
function load(f){return fs.readFileSync(f,'utf8').split(/\r?\n/).filter(Boolean).map(l=>JSON.parse(l));}
const main=load('docs/engineering/typescript-migration/evidence/L02-main-surface-diagnostics-2026-10-27T21-55-07-267Z.jsonl');
console.log(main.slice(0,3).map(r=>Object.keys(r)));
console.log(main.filter(r=>r.recordType).map(r=>r.recordType));
const d=main.filter(r=>r.recordType==='diagnostic');
console.log('diag rows',d.length, JSON.stringify(d[0],null,1));
