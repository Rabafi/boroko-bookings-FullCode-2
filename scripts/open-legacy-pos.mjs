import '../legacy-pos/src/main/stdioGuard.js';
import { existsSync, mkdirSync, openSync, closeSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const legacy = path.join(root, 'legacy-pos');
const binary = path.join(legacy, 'node_modules/electron/dist', process.platform === 'win32' ? 'electron.exe' : 'electron');
const env = { ...process.env };
for (const name of ['ELECTRON_RENDERER_URL', 'ELECTRON_ENTRY', 'ELECTRON_RUN_AS_NODE', 'ELECTRON_EXEC_PATH', 'BOROKO_PRODUCT']) delete env[name];
if (!existsSync(binary)) {
  console.error('Legacy Electron is missing. From legacy-pos run: node node_modules/electron/install.js');
  process.exit(1);
}
// Invoke npm through its JavaScript entry, avoiding shell quoting and cwd-dependent entry points.
const npmCli = process.env.npm_execpath;
if (!npmCli || !existsSync(npmCli)) {
  console.error('Run this launcher using npm run legacy:open.');
  process.exit(1);
}
const build = spawnSync(process.execPath, [npmCli, 'run', 'build'], { cwd: legacy, env, stdio: 'inherit' });
if (build.status !== 0) process.exit(build.status || 1);
// Separate the rebuilt company-login preview from older running previews.
// Existing profiles, saved credentials and pending work are not removed.
const profile = path.join(legacy, '.tmp', 'preview-company-login-v2');
mkdirSync(path.dirname(profile), { recursive: true });
const logPath = path.join(legacy, '.tmp', 'legacy-preview.log');
const log = openSync(logPath, 'a');
try {
  const child = spawn(binary, [legacy, `--user-data-dir=${profile}`], {
    cwd: legacy, env, detached: true, windowsHide: false, stdio: ['ignore', log, log]
  });
  child.on('error', (error) => { console.error(`Legacy launch failed: ${error.message}`); process.exitCode = 1; });
  child.unref();
} finally {
  closeSync(log);
}
console.log(`Opening the company-login Legacy preview. Runtime output: ${logPath}`);
