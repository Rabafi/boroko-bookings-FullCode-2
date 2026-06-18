import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

const args = process.argv.slice(2);
const mode = ['patch', 'minor', 'major', 'publish'].includes(args[0]) ? args[0] : 'patch';

function getArgValue(flagName) {
  const index = args.indexOf(flagName);
  if (index === -1) return '';
  return args[index + 1] || '';
}

const notesFileArg = getArgValue('--notes-file');
const notesArg = getArgValue('--notes');
const notesTitleArg = getArgValue('--notes-title');

function parseEnvFile(filePath) {
  if (!existsSync(filePath)) return {};
  const env = {};
  for (const rawLine of readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const idx = line.indexOf('=');
    if (idx <= 0) continue;
    const key = line.slice(0, idx).trim();
    let value = line.slice(idx + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    env[key] = value;
  }
  return env;
}

function resolveGhToken() {
  const direct = process.env.GH_TOKEN?.trim();
  if (direct) return direct;

  const tokenFile = process.env.GH_TOKEN_FILE?.trim();
  if (tokenFile && existsSync(tokenFile)) {
    const fileToken = readFileSync(tokenFile, 'utf8').trim();
    if (fileToken) return fileToken;
  }

  for (const candidate of [
    path.join(projectRoot, '.env.release'),
    path.join(projectRoot, '.env.local'),
    path.join(projectRoot, '.env')
  ]) {
    const parsed = parseEnvFile(candidate);
    if (parsed.GH_TOKEN?.trim()) return parsed.GH_TOKEN.trim();
  }
  return '';
}

function run(command, commandArgs, extraEnv = {}) {
  const isWindows = process.platform === 'win32';
  const result = spawnSync(
    isWindows ? process.env.ComSpec || 'cmd.exe' : command,
    isWindows ? ['/c', command, ...commandArgs] : commandArgs,
    {
      cwd: projectRoot,
      stdio: 'inherit',
      env: { ...process.env, ...extraEnv }
    }
  );
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(typeof result.status === 'number' ? result.status : 1);
}

function runCapture(command, commandArgs) {
  const isWindows = process.platform === 'win32';
  const result = spawnSync(
    isWindows ? process.env.ComSpec || 'cmd.exe' : command,
    isWindows ? ['/c', command, ...commandArgs] : commandArgs,
    { cwd: projectRoot, stdio: ['ignore', 'pipe', 'ignore'], encoding: 'utf8' }
  );
  if (result.error || result.status !== 0) return '';
  return String(result.stdout || '').trim();
}

function readPackageVersion() {
  const pkg = JSON.parse(readFileSync(path.join(projectRoot, 'package.json'), 'utf8'));
  return String(pkg.version || '').trim();
}

function buildGeneratedReleaseNotes({ version, title }) {
  const commits = runCapture('git', ['log', '--no-merges', '-n=8', '--pretty=format:%s'])
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const heading = title || `Boroko POS Legacy ${version}`;
  const lines = [
    `## ${heading}`,
    '',
    '### Highlights',
    ...(commits.length ? commits.map((commit) => `- ${commit}`) : ['- Maintenance release with POS fixes and stability improvements.']),
    '',
    '### Operator Notes',
    '- Install when the outlet has a quiet moment.',
    '- Finish or review pending sync items before restarting into the update.',
    '- Confirm menu, inventory, drawer, and shift state after the update opens.'
  ];
  return `${lines.join('\n').trim()}\n`;
}

function resolveReleaseNotesContent() {
  if (notesArg.trim()) return notesArg.trim();
  if (notesFileArg.trim()) {
    const resolved = path.resolve(projectRoot, notesFileArg.trim());
    if (!existsSync(resolved)) {
      console.error(`Release notes file not found: ${resolved}`);
      process.exit(1);
    }
    return readFileSync(resolved, 'utf8').trim();
  }
  const defaultNotesFile = path.join(projectRoot, 'release-notes.md');
  if (existsSync(defaultNotesFile)) return readFileSync(defaultNotesFile, 'utf8').trim();
  return buildGeneratedReleaseNotes({
    version: readPackageVersion(),
    title: notesTitleArg.trim()
  }).trim();
}

function writeReleaseNotesFile() {
  const releaseDir = path.join(projectRoot, '.release');
  mkdirSync(releaseDir, { recursive: true });
  const filePath = path.join(releaseDir, 'release-notes.md');
  writeFileSync(filePath, `${resolveReleaseNotesContent()}\n`, 'utf8');
  console.log(`Using release notes file: ${filePath}`);
  return filePath;
}

const ghToken = resolveGhToken();
if (!ghToken) {
  console.error('GH_TOKEN was not found.');
  console.error('Put GH_TOKEN in legacy-pos/.env.release, legacy-pos/.env.local, legacy-pos/.env, GH_TOKEN_FILE, or the current terminal.');
  process.exit(1);
}

const releaseEnv = {
  GH_TOKEN: ghToken,
  EP_DRAFT: 'false',
  EP_PRE_RELEASE: 'false',
  EP_CHANNEL: 'latest',
  CSC_IDENTITY_AUTO_DISCOVERY: 'false'
};

if (mode === 'publish') {
  const releaseNotesFile = writeReleaseNotesFile();
  run('npm.cmd', ['run', 'build'], releaseEnv);
  run('npx.cmd', ['electron-builder', '--win', 'nsis', '--publish', 'always', `--config.releaseInfo.releaseNotesFile=${releaseNotesFile}`], releaseEnv);
} else {
  run('npm.cmd', ['version', mode, '--no-git-tag-version'], releaseEnv);
  run('npm.cmd', ['run', 'release:publish'], releaseEnv);
}
