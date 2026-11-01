import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
const require=createRequire(import.meta.url), esbuild=require('esbuild');
const React=require('react'), {renderToString}=require('react-dom/server');
const root=process.cwd(), out=path.join(root,'.tmp','bar-local-independent-review-20261020');
const files={modern:'src/renderer/src/components/hospitality-pos/BarLocalWorkspace.jsx',legacy:'legacy-pos/src/renderer/src/screens/BarLocalWorkspace.jsx'};
const results=[];
async function component(file,hooks=React,api={}){
 const build=await esbuild.build({entryPoints:[file],bundle:true,write:false,platform:'node',format:'cjs',jsx:'automatic',external:['react','react/jsx-runtime']});
 const m={exports:{}};
 const ctx={module:m,exports:m.exports,require:(id)=>id==='react'?hooks:require(id),crypto:{randomUUID},window:{api},console,setTimeout,clearTimeout};
 vm.runInNewContext(build.outputFiles[0].text,ctx,{filename:file});return m.exports.default;
}
for(const [name,file] of Object.entries(files)){
 try{const C=await component(file);renderToString(React.createElement(C,name==='modern'?{status:{session:null},onLogout(){}}:{authority:{outlet_id:'test'}}));results.push({case:name+' initial signed-out render',result:'rendered'});}
 catch(e){results.push({case:name+' initial signed-out render',result:'THREW',message:e.message});}
}
function flatten(x,all=[]){if(!x||typeof x!=='object')return all;if(x.type)all.push(x);const c=x.props?.children;for(const v of Array.isArray(c)?c:[c])flatten(v,all);return all;}
function label(x){if(typeof x==='string')return x;if(Array.isArray(x))return x.map(label).join('');return x?.props?label(x.props.children):'';}
for(const [name,file] of Object.entries(files)){
 const product={product_id:randomUUID(),name:'Review fixture',price:'1.00',tax_rate:'0',active:true,product_active:true,available:true,category:'Fixture'};
 const staff={display_name:'Synthetic cashier',capabilities:['pos.manage']};
 let cursor=0;const cells=[];const calls=[];
 const hooks={useState(initial){const i=cursor++;if(!(i in cells))cells[i]=initial;return[cells[i],v=>cells[i]=typeof v==='function'?v(cells[i]):v];},useEffect(){},useCallback:f=>f,useMemo:f=>f()};
 const capture=async (...args)=>{calls.push(name==='modern'?args[0].operation_id:args[2].operationId);return{ok:false,outcome:'unknown',error:{message:'Synthetic dropped reply'}};};
 const api=name==='modern'?{barLocal:{command:capture}}:{pos:{barLocal:{command:capture}}};
 const C=await component(file,hooks,api);
 if(name==='modern'){cells[2]={staff,outlet_id:randomUUID()};cells[3]={ready:true,blockers:[],checkedAt:Date.now()};cells[4]=[product];cells[5]={shift_id:randomUUID(),status:'open'};cells[6]=[{product,quantity:1}];}
 else{cells[2]=staff;cells[3]={ready:true,blockers:[],checkedAt:Date.now()};cells[4]=[product];cells[5]={shift_id:randomUUID(),status:'open'};cells[6]=[{product,quantity:1}];}
 function render(){cursor=0;return C(name==='modern'?{status:{},onLogout(){}}:{authority:{outlet_id:'fixture'}});}
 let tree=render(),button=flatten(tree).find(e=>e.type==='button'&&label(e)==='Commit cash sale');
 button.props.onClick();await new Promise(r=>setTimeout(r,0));
 tree=render();button=flatten(tree).find(e=>e.type==='button'&&label(e)==='Commit cash sale');
 const allowed=button.props.disabled!==true;
 if(allowed){button.props.onClick();await new Promise(r=>setTimeout(r,0));}
 results.push({case:name+' unknown result allows new sale',normalButtonEnabled:allowed,operations:calls,distinctIds:new Set(calls).size});
}
const {getCommand,getQuery}=await import('../../packages/bar-contracts/dist/index.js');
for(const name of ['catalogue.recipe.set','promotion.upsert','loyalty.points.earn','workforce.tip.allocate','accounting.ap.invoice.upsert']){try{getCommand(name);results.push({case:'service registry '+name,result:'registered'});}catch(e){results.push({case:'service registry '+name,result:e.code});}}
fs.writeFileSync(path.join(out,'ui-and-contract-probes.json'),JSON.stringify(results,null,2));console.log(JSON.stringify(results,null,2));
