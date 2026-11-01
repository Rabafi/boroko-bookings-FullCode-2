import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
const root=process.cwd(), dir=path.join(root,'.tmp','bar-local-independent-review-20261020');
const target=JSON.parse(fs.readFileSync(path.join(dir,'target.json'),'utf8'));
const data=target.data, port=target.port;
function run(label,file,args,env=process.env){const r=spawnSync(file,args,{cwd:root,env,windowsHide:true,encoding:'utf8',maxBuffer:30*1024*1024});fs.writeFileSync(path.join(dir,label+'.log'),(r.stdout||'')+(r.stderr||'')+(r.error?String(r.error):''));console.log(label,'exit',r.status);if(r.status!==0)throw new Error(label+' failed');}
const env={...process.env,BAR_LOCAL_TEST_DB:'1',BAR_LOCAL_DB_HOST:'127.0.0.1',BAR_LOCAL_DB_PORT:String(port),BAR_LOCAL_DB_NAME:'bar_local_test_independent_review',BAR_LOCAL_TEST_CLUSTER_DATA:data,BAR_LOCAL_MIGRATOR_USER:'bar_local_migrator',BAR_LOCAL_RUNTIME_USER:'bar_local_runtime',BAR_LOCAL_BOOTSTRAP_USER:'postgres',BAR_LOCAL_SETUP_SECRET:'review-disposable-bootstrap-secret-20261020'};
for(const k of ['DATABASE_URL','SUPABASE_DB_URL','SUPABASE_POOLER_URL','PGHOST','BAR_LOCAL_DB_PASSWORD','BAR_LOCAL_RUNTIME_PASSWORD','BAR_LOCAL_MIGRATOR_PASSWORD']) delete env[k];
fs.writeFileSync(path.join(dir,'target.json'),JSON.stringify({data,port,database:env.BAR_LOCAL_DB_NAME},null,2));
run('bootstrap',process.execPath,['services/bar-local/scripts/bootstrap-local.mjs'],env);
const npmCli=path.join(path.dirname(process.execPath),'node_modules','npm','bin','npm-cli.js');
run('service-tests',process.execPath,[npmCli,'run','bar-local:test'],env);
console.log('Independent full service suite finished; isolated cluster retained for targeted review probes.');

