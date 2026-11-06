const fs=require('fs');
const f='docs/engineering/typescript-migration/evidence/L02-renderer-ipc-diagnostics-2026-10-28T08-22-50-507Z.jsonl';
const first=JSON.parse(fs.readFileSync(f,'utf8').split(/\r?\n/)[0]);
console.log(JSON.stringify(first,null,1).slice(0,2000));
