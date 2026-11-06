const fs=require('fs');
const sidecar='docs/engineering/typescript-migration/evidence/L02-main-surface-diagnostics-2026-10-28T08-29-39-331Z.jsonl';
const rows=fs.readFileSync(sidecar,'utf8').split(/\r?\n/).filter(Boolean).map(JSON.parse).filter(r=>r.recordType==='diagnostic');
const files=['src/main/domains/starterBackup.js','src/main/domains/starterRecovery.js','src/main/ai/aiOrchestrator.js','src/main/domains/reports.js','src/main/domains/restaurantAccountingV2.js','src/main/domains/customerCredit.js','src/main/domains/inventory.js','src/main/domains/admin.js','src/main/domains/supplies.js','src/main/domains/bookings.js','src/main/domains/pos.js','src/main/index.js'];
const dir='docs/engineering/typescript-migration/evidence/batch84-work/diagnostics';
fs.mkdirSync(dir,{recursive:true});
for(const f of files){
 const hits=rows.filter(r=>r.path.replace(/\\/g,'/')===f);
 fs.writeFileSync(dir+'/main__'+f.replace(/\//g,'__')+'.txt',`SIDECAR ${sidecar}\nFILE ${f}\nCOUNT ${hits.length}\n`+hits.map(r=>`${r.line}:${r.column} TS${r.code} ${r.message.replace(/\n/g,' | ')}`).join('\n')+'\n');
 console.log(f,hits.length);
}
// multiset comparison against the previous main sidecar
const prev='docs/engineering/typescript-migration/evidence/L02-main-surface-diagnostics-2026-10-27T21-55-07-267Z.jsonl';
const oldRows=fs.readFileSync(prev,'utf8').split(/\r?\n/).filter(Boolean).map(JSON.parse).filter(r=>r.recordType==='diagnostic');
const key=r=>`${r.path}|${r.line}|${r.column}|${r.code}|${r.message}`;
const count=arr=>{const m=new Map();for(const r of arr){const k=key(r);m.set(k,(m.get(k)||0)+1);}return m;};
const a=count(oldRows),b=count(rows);
const removed=[...a].filter(([k,n])=>n>(b.get(k)||0));
const added=[...b].filter(([k,n])=>n>(a.get(k)||0));
console.log('removed',removed.reduce((s,[,n])=>s+n,0),'added',added.reduce((s,[,n])=>s+n,0));
for(const [k,n] of removed) console.log('REMOVED',n,k.split('|').slice(0,4).join(':'));
for(const [k,n] of added) console.log('ADDED',n,k.split('|').slice(0,4).join(':'));
