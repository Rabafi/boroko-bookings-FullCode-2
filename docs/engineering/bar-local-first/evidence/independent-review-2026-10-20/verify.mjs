import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
const dir=path.join(process.cwd(),'.tmp','bar-local-independent-review-20261020');
const npm=path.join(path.dirname(process.execPath),'node_modules','npm','bin','npm-cli.js');
const checks=['bar-local:typecheck','test:bar-local-electron','legacy-pos:test','legacy-pos:build','build:hospitality-pos','typecheck:main','test:bar-guides','test:preload-api','test:preload-transport','test:bar','test:release-architecture','test:release-behavior'];
const results=[];
for(const script of checks){const logfile=script.replaceAll(':','-')+'.log';const fd=fs.openSync(path.join(dir,logfile),'w');const start=Date.now();const r=spawnSync(process.execPath,[npm,'run',script],{cwd:process.cwd(),env:process.env,windowsHide:true,stdio:['ignore',fd,fd],timeout:600000});fs.closeSync(fd);results.push({script,exit:r.status,error:r.error?.message||null,duration_ms:Date.now()-start,logfile});fs.writeFileSync(path.join(dir,'verification-results.json'),JSON.stringify(results,null,2));console.log(script,'exit',r.status);}
