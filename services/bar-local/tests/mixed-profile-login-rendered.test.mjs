import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { createServer } from 'node:http'
import esbuild from 'esbuild'
import { chromium } from 'playwright'

const cache = join(process.env.LOCALAPPDATA || '', 'ms-playwright')
const executablePath = process.env.BAR_LOCAL_CHROMIUM_EXECUTABLE_PATH || (existsSync(chromium.executablePath()) ? chromium.executablePath()
  : readdirSync(cache).filter((name) => /^chromium_headless_shell-\d+$/.test(name)).sort().reverse()
    .map((name) => join(cache, name, 'chrome-headless-shell-win64', 'chrome-headless-shell.exe')).find(existsSync))
const entry = `
import React from 'react'
import {createRoot} from 'react-dom/client'
import {MemoryRouter} from 'react-router'
import {AuthContext, ProfilesContext, SettingsContext} from './src/renderer/src/app-context.jsx'
import Login from './src/renderer/src/components/Login.jsx'
const f = window.fixture
window.api = {settings:{getDiagnostics:async()=>({})}, auth:{getStatus:async()=>({online:true}),login:async()=>{f.cloudLogins++;throw new Error('Cloud credentials must not be submitted')}},
barLocal:{getChooserEntry:async()=>({status:'ready',label:'Saved Lounge'}),selectLocalBarWorkspace:async()=>{f.switches++;return {restart_required:true,workspace:'local_bar'}}}}
const restaurant={lodge_id:'restaurant',label:'Restaurant',status:'ready'}
const draft={lodge_id:'draft',label:'New Business',status:'draft'}
createRoot(document.getElementById('root')).render(<MemoryRouter><AuthContext.Provider value={{user:null,login:async()=>{},logout:()=>{}}}>
<ProfilesContext.Provider value={{profiles:[restaurant,draft],activeProfile:draft,createDraftProfile:async()=>{throw new Error('No new business')}}}>
<SettingsContext.Provider value={{settings:{business_name:'New Business',property_type:'restaurant'}}}><Login/></SettingsContext.Provider>
</ProfilesContext.Provider></AuthContext.Provider></MemoryRouter>)
`

test('original Login offers the saved local Bar separately from ready Restaurant and stale cloud draft', { timeout: 120000 }, async (t) => {
  const bundle = await esbuild.build({ stdin: { contents: entry, resolveDir: process.cwd(), loader: 'jsx' }, bundle: true, write: false,
    platform: 'browser', format: 'iife', jsx: 'automatic', loader: { '.png': 'dataurl' },
    define: { 'process.env.NODE_ENV': '"development"', __TSA_BONNO_PRODUCT__: '"hospitality-pos"' } })
  const server = createServer((_req, res) => res.writeHead(200, { 'content-type': 'text/html' }).end(
    '<div id="root"></div><script>window.fixture={switches:0,cloudLogins:0}</script><script>' + bundle.outputFiles[0].text + '</script>'))
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  t.after(() => { server.closeAllConnections();return new Promise((resolve) => server.close(resolve)) })
  const browser = await chromium.launch({ headless: true, executablePath })
  t.after(() => browser.close())
  const page = await browser.newPage()
  await page.goto('http://127.0.0.1:' + server.address().port)
  await page.getByTestId('selected-lodge-panel').getByText('New Business', { exact: true }).waitFor()
  await page.getByRole('button', { name: 'Open saved local Bar — Saved Lounge', exact: true }).click()
  await page.getByRole('button', { name: 'Opening saved local Bar…', exact: true }).waitFor()
  assert.deepEqual(await page.evaluate(() => window.fixture), { switches: 1, cloudLogins: 0 })
})
