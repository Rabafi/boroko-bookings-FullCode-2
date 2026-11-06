const fs=require('fs');
const sidecar='docs/engineering/typescript-migration/evidence/L02-renderer-ipc-diagnostics-2026-10-28T08-34-39-000Z.jsonl';
const rows=fs.readFileSync(sidecar,'utf8').split(/\r?\n/).filter(Boolean).map(JSON.parse).filter(r=>r.recordType==='diagnostic');
const files=['src/renderer/src/components/Reports.jsx','src/renderer/src/components/Bookings.jsx','src/renderer/src/components/POS.jsx','src/renderer/src/components/Settings.jsx','src/renderer/src/components/hotel/StaffOperations.jsx','src/renderer/src/components/hotel/VenueManagement.jsx','src/renderer/src/components/AdminCentral.jsx','src/renderer/src/components/Dashboard.jsx','src/renderer/src/components/hospitality-pos/HposSystemHealth.jsx','src/renderer/src/components/LicensingWorkbench.jsx','src/renderer/src/components/hospitality-pos/HposTerminal.jsx','src/renderer/src/App.jsx'];
const dir='docs/engineering/typescript-migration/evidence/batch84-work/diagnostics';
for(const f of files){
 const hits=rows.filter(r=>r.path.replace(/\\/g,'/')===f);
 fs.writeFileSync(dir+'/renderer__'+f.replace(/\//g,'__')+'.txt',`SIDECAR ${sidecar}\nFILE ${f}\nCOUNT ${hits.length}\n`+hits.map(r=>`${r.line}:${r.column} TS${r.code} ${r.message.replace(/\n/g,' | ')}`).join('\n')+'\n');
 console.log(f,hits.length);
}
const prev='docs/engineering/typescript-migration/evidence/L02-renderer-ipc-diagnostics-2026-10-27T21-46-49-778Z.jsonl';
const oldRows=fs.readFileSync(prev,'utf8').split(/\r?\n/).filter(Boolean).map(JSON.parse).filter(r=>r.recordType==='diagnostic');
const key=r=>`${r.path}|${r.line}|${r.column}|${r.code}|${r.message}`;
const count=arr=>{const m=new Map();for(const r of arr){const k=key(r);m.set(k,(m.get(k)||0)+1);}return m;};
const a=count(oldRows),b=count(rows);
const removed=[...a].filter(([k,n])=>n>(b.get(k)||0));
const added=[...b].filter(([k,n])=>n>(a.get(k)||0));
console.log('renderer removed',removed.reduce((s,[,n])=>s+n,0),'added',added.reduce((s,[,n])=>s+n,0));
const byFile=m=>{const o={};for(const [k,n] of m){const f=k.split('|')[0];o[f]=(o[f]||0)+n;}return o;};
console.log('removedByFile',byFile(removed));
console.log('addedByFile',byFile(added));
