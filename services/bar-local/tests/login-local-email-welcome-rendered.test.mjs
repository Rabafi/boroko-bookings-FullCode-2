import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { createServer } from 'node:http'
import esbuild from 'esbuild'
import { chromium } from 'playwright'

const cache = join(process.env.LOCALAPPDATA || '', 'ms-playwright')
let executablePath = process.env.BAR_LOCAL_CHROMIUM_EXECUTABLE_PATH || ''
if (!executablePath && existsSync(chromium.executablePath())) executablePath = chromium.executablePath()
if (!executablePath && existsSync(cache)) executablePath = readdirSync(cache).filter((name) => /^chromium_headless_shell-\d+$/.test(name)).sort().reverse()
  .map((name) => join(cache, name, 'chrome-headless-shell-win64', 'chrome-headless-shell.exe')).find(existsSync) || ''
const entry = `
import React from 'react'
import {createRoot} from 'react-dom/client'
import {MemoryRouter} from 'react-router'
import {AuthContext, ProfilesContext, SettingsContext} from './src/renderer/src/app-context.jsx'
import Login from './src/renderer/src/components/Login.jsx'
const f = window.fixture
window.api = {settings:{getDiagnostics:async()=>({})},auth:{getStatus:async()=>({online:false}),login:async()=>{f.cloudLogins++;throw new Error('Cloud auth must not be called')}} ,
updates:{check:async()=>{f.updateChecks++;throw new Error('Missing update handler')},install:async()=>{f.updateInstalls++}},
barLocal:{login:async(credentials)=>{f.credentials=credentials;return {session:{staff:{id:'staff-1',email:credentials.email}}}},
selectCloudWorkspace:async()=>{f.workspaceSwitches++;return {restart_required:true,workspace:'cloud'}}}}
createRoot(document.getElementById('root')).render(<MemoryRouter><AuthContext.Provider value={{user:null,login:async(user)=>{f.loggedIn=user.session.staff},logout:()=>{}}}>
<ProfilesContext.Provider value={{profiles:[{lodge_id:'local',status:'ready'}],activeProfile:{lodge_id:'local',status:'ready'},createDraftProfile:async()=>{}}}>
<SettingsContext.Provider value={{settings:{business_name:'Saved Bar',property_type:'bar',authority_mode:'bar_local',lodge_id:'11111111-1111-4111-8111-111111111111'}}}><Login/></SettingsContext.Provider>
</ProfilesContext.Provider></AuthContext.Provider></MemoryRouter>)
`

test('local sign-in is email-only, remains local, returns to welcome through workspace handoff, and gives a safe update status', { timeout: 120000 }, async (t) => {
  const bundle = await esbuild.build({ stdin: { contents: entry, resolveDir: process.cwd(), loader: 'jsx' }, bundle: true, write: false,
    platform: 'browser', format: 'iife', jsx: 'automatic', loader: { '.png': 'dataurl' },
    define: { 'process.env.NODE_ENV': '"development"', __TSA_BONNO_PRODUCT__: '"hospitality-pos"' } })
  const server = createServer((_req, res) => res.writeHead(200, { 'content-type': 'text/html' }).end(
    '<div id="root"></div><script>window.fixture={cloudLogins:0,workspaceSwitches:0,updateChecks:0,updateInstalls:0}</script><script>' + bundle.outputFiles[0].text + '</script>'))
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  t.after(() => { server.closeAllConnections(); return new Promise((resolve) => server.close(resolve)) })
  const browser = await chromium.launch({ headless: true, executablePath })
  t.after(() => browser.close())
  const page = await browser.newPage()
  await page.goto('http://127.0.0.1:' + server.address().port)
  await page.getByTestId('login-email-input').waitFor()
  assert.equal(await page.getByLabel('Staff ID').count(), 0)
  assert.equal(await page.getByText('Staff PIN', { exact: true }).count(), 0)
  await page.getByTestId('login-email-input').fill('owner@example.test')
  await page.getByTestId('login-password-input').fill('local-password')
  await page.getByRole('button', { name: /Sign In|Log In/i }).click()
  await page.waitForFunction(() => Boolean(window.fixture.loggedIn))
  await page.getByRole('button', { name: '← Back to Welcome' }).click()
  await page.waitForFunction(() => window.fixture.workspaceSwitches === 1)
  assert.deepEqual(await page.evaluate(() => ({ credentials: window.fixture.credentials, cloudLogins: window.fixture.cloudLogins,
    workspaceSwitches: window.fixture.workspaceSwitches })), {
    credentials: { email: 'owner@example.test', password: 'local-password' }, cloudLogins: 0, workspaceSwitches: 1
  })

  await page.reload()
  await page.getByRole('button', { name: 'Update Software' }).click()
  await page.getByText(/Desktop app updates are managed from Manage > Local authority/).waitFor()
  assert.equal((await page.evaluate(() => window.fixture)).updateChecks, 0)
  assert.equal((await page.evaluate(() => window.fixture)).updateInstalls, 0)
})
