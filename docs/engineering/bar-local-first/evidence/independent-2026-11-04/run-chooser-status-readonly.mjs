import { spawn } from 'node:child_process'
const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE
const child = spawn('node_modules/electron/dist/electron.exe', ['docs/engineering/bar-local-first/evidence/independent-2026-11-04/chooser-status-readonly.cjs', ...process.argv.slice(2)], { env, windowsHide: true, stdio: ['ignore','pipe','pipe'] })
child.stdout.on('data', data => process.stdout.write(data))
child.stderr.on('data', data => process.stderr.write(data))
child.once('error', error => { console.error(error.message); process.exitCode = 1 })
child.once('exit', code => { console.log('READONLY_DIAGNOSTIC_EXIT', code); process.exitCode = code ?? 1 })
