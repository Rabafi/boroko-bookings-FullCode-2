const fs=require('fs');
function load(f){return fs.readFileSync(f,'utf8').split(/\r?\n/).filter(Boolean).map(l=>JSON.parse(l)).filter(r=>r.recordType==='diagnostic');}
const d=load('docs/engineering/typescript-migration/evidence/L02-renderer-ipc-diagnostics-2026-10-27T21-46-49-778Z.jsonl');
for(const file of ['src/renderer/src/components/Reports.jsx','src/renderer/src/components/Bookings.jsx','src/renderer/src/components/POS.jsx','src/renderer/src/components/Settings.jsx']){
 const rows=d.filter(r=>r.path===file);
 const codes={}; for(const r of rows) codes[r.code]=(codes[r.code]||0)+1;
 const never=rows.filter(r=>/'never'/.test(r.message)).length;
 const emptyObj=rows.filter(r=>/type '\{\}'/.test(r.message)).length;
 console.log(file, rows.length, codes, 'never',never,'{}',emptyObj);
}
