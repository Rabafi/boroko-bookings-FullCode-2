import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile, rm, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { _electron } from 'playwright';

const legacy = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const root = path.dirname(legacy);
const scratchRoot = path.join(legacy, '.tmp');
await mkdir(scratchRoot, { recursive: true });
const scratch = await mkdtemp(path.join(scratchRoot, 'login-ui-'));
const evidence = path.join(legacy, 'docs/evidence');
await mkdir(evidence, { recursive: true });
let application;
try {
  await build({
    stdin: { resolveDir: root, loader: 'jsx', contents: `
      import React from 'react'; import {createRoot} from 'react-dom/client';
      import Login from './legacy-pos/src/renderer/src/screens/Login.jsx';
      const companies=[{lodge_id:'lodge',lodge_display_name:'Sample Lodge',property_type:'lodge',role:'owner'},
        {lodge_id:'bar',lodge_display_name:'Sample Bar',property_type:'bar',role:'owner'}];
      window.api={pos:{getConfig:async()=>({configured:true}),hasTrustedSession:async()=>true,updates:{getState:async()=>({phase:'idle'})}}};
      async function login(email,password,id){if(!id)return {code:'company_selection_required',memberships:companies};window.reviewChoice=id;return {user:{id:'sample'},lodgeId:id}}
      createRoot(document.getElementById('root')).render(<Login onLogin={login} onOfflineUnlock={login}/>);
    ` },
    alias: { react: path.join(legacy, 'node_modules/react'), 'react-dom': path.join(legacy, 'node_modules/react-dom') },
    bundle: true, jsx: 'automatic', outfile: path.join(scratch, 'bundle.js'), target: 'chrome108',
    loader: { '.png': 'dataurl' }, define: { 'process.env.NODE_ENV': '"production"' }
  });
  const css = (await readdir(path.join(legacy, 'out/renderer/assets'))).find((name) => name.endsWith('.css'));
  if (!css) throw new Error('Build Legacy before running the rendered login check.');
  const cssUrl = pathToFileURL(path.join(legacy, 'out/renderer/assets', css)).href;
  await writeFile(path.join(scratch, 'index.html'), '<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="' + cssUrl + '"></head><body><div id="root"></div><script src="bundle.js"></script></body></html>');
  await writeFile(path.join(scratch, 'main.cjs'), `const {app,BrowserWindow}=require('electron');app.whenReady().then(()=>{global.win=new BrowserWindow({show:true,width:1100,height:950,title:'Legacy POS login test — fictional companies',webPreferences:{backgroundThrottling:false}});win.loadFile(${JSON.stringify(path.join(scratch, 'index.html'))})});`);
  const env = { ...process.env };
  for (const name of ['ELECTRON_RUN_AS_NODE', 'ELECTRON_RENDERER_URL', 'ELECTRON_ENTRY']) delete env[name];
  application = await _electron.launch({ executablePath: path.join(legacy, 'node_modules/electron/dist/electron.exe'), args: [path.join(scratch, 'main.cjs'), `--user-data-dir=${path.join(scratch, 'profile')}`], env });
  const page = await application.firstWindow();
  page.setDefaultTimeout(10000);
  page.on('pageerror', (error) => console.error('Renderer:', error.message));
  await page.getByRole('heading', { name: 'Tsa Bonno POS Legacy' }).waitFor();
  await page.getByAltText('Tsa Bonno HospitalityOS').waitFor();
  await page.screenshot({ path: path.join(evidence, 'legacy-login-neutral.png'), fullPage: true });
  await page.locator('input[type=email]').fill('owner@example.test');
  await page.locator('input[autocomplete=current-password]').fill('sample-password');
  await page.getByRole('button', { name: 'Sign In', exact: true }).click();
  await page.getByRole('heading', { name: 'Which company are you working in?' }).waitFor();
  await page.getByRole('button', { name: /Sample Lodge/ }).waitFor();
  await page.getByRole('button', { name: /Sample Bar/ }).waitFor();
  await page.screenshot({ path: path.join(evidence, 'legacy-company-choice.png'), fullPage: true });
  await page.getByRole('button', { name: /Sample Bar/ }).click();
  await page.waitForFunction(() => window.reviewChoice === 'bar');
  assert.equal(await page.getByRole('heading', { name: 'Which company are you working in?' }).count(), 0);
  await page.getByRole('button', { name: 'Offline Unlock', exact: true }).click();
  await page.getByText('Choose a company previously saved on this terminal.').waitFor();
  await page.getByRole('button', { name: /Sample Lodge/ }).click();
  await page.waitForFunction(() => window.reviewChoice === 'lodge');
  await writeFile(path.join(evidence, 'company-login-ui.json'), JSON.stringify({ passed: true, runtime: 'Electron 22', assertions: ['neutral logo', 'online company chooser', 'selected company passed to login', 'offline chooser'], scope: 'Actual Login component with mocked APIs; no live account or business writes' }, null, 2));
  console.log('PASS: Legacy login logo, online/offline company selection and callback scope. Screenshots saved.');
} finally {
  if (application) await application.close();
  if (path.resolve(scratch).startsWith(path.resolve(scratchRoot) + path.sep) && path.basename(scratch).startsWith('login-ui-')) await rm(scratch, { recursive: true, force: true });
}
