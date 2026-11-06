const fs=require('fs');
const mainFile='docs/engineering/typescript-migration/evidence/L02-main-surface-diagnostics-2026-10-27T21-55-07-267Z.jsonl';
const rendFile='docs/engineering/typescript-migration/evidence/L02-renderer-ipc-diagnostics-2026-10-27T21-46-49-778Z.jsonl';
function load(f){const lines=fs.readFileSync(f,'utf8').split(/\r?\n/).filter(Boolean);return lines.map(l=>JSON.parse(l));}
for(const [name,f] of [['MAIN',mainFile],['RENDERER',rendFile]]){
  const rows=load(f);
  console.log(name, 'rows', rows.length, 'keys', Object.keys(rows[0]));
  const byFile=new Map(); const byCode=new Map();
  for(const r of rows){ const file=r.file||r.path||r.source; byFile.set(file,(byFile.get(file)||0)+1); byCode.set(r.code,(byCode.get(r.code)||0)+1); }
  console.log(name,'codes',[...byCode].sort((a,b)=>b[1]-a[1]).slice(0,12));
  console.log(name,'files',[...byFile].sort((a,b)=>b[1]-a[1]).slice(0,30));
}
