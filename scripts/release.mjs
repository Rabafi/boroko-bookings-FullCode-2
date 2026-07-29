import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'fs'
import path from 'path'
import { spawnSync } from 'child_process'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const projectRoot = path.resolve(__dirname, '..')

const args = process.argv.slice(2)
const validModes = ['patch', 'minor', 'major', 'publish']
const usage = 'Usage: node scripts/release.mjs <patch|minor|major|publish> [--notes-file <path>] [--notes <text>] [--notes-title <title>] [--remind-pwa]'
if (args.includes('--help') || args.includes('-h')) {
  console.log(usage)
  process.exit(0)
}
if (!validModes.includes(args[0])) {
  console.error(usage)
  process.exit(1)
}
const mode = args[0]
const remindPwa = args.includes('--remind-pwa')

function getArgValue(flagName) {
  const index = args.indexOf(flagName)
  if (index === -1) return ''
  return args[index + 1] || ''
}

const notesFileArg = getArgValue('--notes-file')
const notesArg = getArgValue('--notes')
const notesTitleArg = getArgValue('--notes-title')

function parseEnvFile(filePath) {
  if (!existsSync(filePath)) return {}
  const env = {}
  const lines = readFileSync(filePath, 'utf8').split(/\r?\n/)
  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const idx = line.indexOf('=')
    if (idx <= 0) continue
    const key = line.slice(0, idx).trim()
    let value = line.slice(idx + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    env[key] = value
  }
  return env
}

function resolveGhToken() {
  const direct = process.env.GH_TOKEN?.trim()
  if (direct) return direct

  const tokenFile = process.env.GH_TOKEN_FILE?.trim()
  if (tokenFile && existsSync(tokenFile)) {
    const fileToken = readFileSync(tokenFile, 'utf8').trim()
    if (fileToken) return fileToken
  }

  const candidates = [
    path.join(projectRoot, '.env.release'),
    path.join(projectRoot, '.env.local'),
    path.join(projectRoot, '.env')
  ]
  for (const candidate of candidates) {
    const parsed = parseEnvFile(candidate)
    if (parsed.GH_TOKEN?.trim()) return parsed.GH_TOKEN.trim()
  }

  return ''
}

function run(command, commandArgs, extraEnv = {}) {
  const isWindows = process.platform === 'win32'
  const result = spawnSync(isWindows ? process.env.ComSpec || 'cmd.exe' : command, isWindows ? ['/c', command, ...commandArgs] : commandArgs, {
    cwd: projectRoot,
    stdio: 'inherit',
    env: { ...process.env, ...extraEnv }
  })
  if (result.error) throw result.error
  if (result.status !== 0) {
    const code = typeof result.status === 'number' ? result.status : 1
    process.exit(code)
  }
}

function runCapture(command, commandArgs, extraEnv = {}) {
  const isWindows = process.platform === 'win32'
  const result = spawnSync(
    isWindows ? process.env.ComSpec || 'cmd.exe' : command,
    isWindows ? ['/c', command, ...commandArgs] : commandArgs,
    {
      cwd: projectRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
      encoding: 'utf8',
      env: { ...process.env, ...extraEnv }
    }
  )
  if (result.error) return ''
  if (result.status !== 0) return ''
  return String(result.stdout || '').trim()
}

function readPackageVersion() {
  const pkgPath = path.join(projectRoot, 'package.json')
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
  return String(pkg.version || '').trim()
}

function getRecentCommitSubjects(limit = 8) {
  const output = runCapture('git', ['log', '--no-merges', `-n=${limit}`, '--pretty=format:%s'])
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
}

function buildGeneratedReleaseNotes({ version, title }) {
  const commits = getRecentCommitSubjects()
  const heading = title || `Tsa Bonno LodgingOS ${version}`
  const lines = [
    `## ${heading}`,
    '',
    '### Highlights',
    ...(commits.length > 0
      ? commits.map((commit) => `- ${commit}`)
      : ['- Maintenance release with quality improvements and fixes.']),
    '',
    '### Operator Notes',
    '- Update when the front desk has a quiet moment.',
    '- Restart the desktop app after download completes to apply the update.',
    '- Review the updated areas briefly after install.'
  ]
  return `${lines.join('\n').trim()}\n`
}

function resolveReleaseNotesContent() {
  if (notesArg.trim()) return notesArg.trim()

  if (notesFileArg.trim()) {
    const resolvedFile = path.resolve(projectRoot, notesFileArg.trim())
    if (!existsSync(resolvedFile)) {
      console.error(`Release notes file not found: ${resolvedFile}`)
      process.exit(1)
    }
    return readFileSync(resolvedFile, 'utf8').trim()
  }

  const defaultNotesFile = path.join(projectRoot, 'release-notes.md')
  if (existsSync(defaultNotesFile)) {
    return readFileSync(defaultNotesFile, 'utf8').trim()
  }

  return buildGeneratedReleaseNotes({
    version: readPackageVersion(),
    title: notesTitleArg.trim()
  }).trim()
}

function writeReleaseNotesFile() {
  const releaseDir = path.join(projectRoot, '.release')
  mkdirSync(releaseDir, { recursive: true })
  const filePath = path.join(releaseDir, 'release-notes.md')
  const content = `${resolveReleaseNotesContent()}\n`
  writeFileSync(filePath, content, 'utf8')
  console.log(`Using release notes file: ${filePath}`)
  return filePath
}

const ghToken = resolveGhToken()
if (!ghToken) {
  console.error('GH_TOKEN was not found.')
  console.error('Put GH_TOKEN in one of these places:')
  console.error('  - .env.release')
  console.error('  - .env.local')
  console.error('  - .env')
  console.error('  - the current terminal session')
  process.exit(1)
}

if (mode === 'publish') {
  const releaseNotesFile = writeReleaseNotesFile()
  run('npm.cmd', ['run', 'icons:build'], { GH_TOKEN: ghToken })
  run('npm.cmd', ['run', 'build'], {
    GH_TOKEN: ghToken,
    EP_DRAFT: 'false',
    EP_PRE_RELEASE: 'false',
    EP_CHANNEL: 'latest'
  })
  run('npx.cmd', ['electron-builder', '--win', 'nsis', '--publish', 'always', `--config.releaseInfo.releaseNotesFile=${releaseNotesFile}`], {
    GH_TOKEN: ghToken,
    EP_DRAFT: 'false',
    EP_PRE_RELEASE: 'false',
    EP_CHANNEL: 'latest',
    CSC_IDENTITY_AUTO_DISCOVERY: 'false'
  })
} else {
  run('npm.cmd', ['version', mode, '--no-git-tag-version'], { GH_TOKEN: ghToken })
  run('npm.cmd', ['run', 'icons:build'], { GH_TOKEN: ghToken })
  run('npm.cmd', ['run', 'release:publish'], {
    GH_TOKEN: ghToken,
    EP_DRAFT: 'false',
    EP_PRE_RELEASE: 'false',
    EP_CHANNEL: 'latest'
  })
  if (remindPwa) {
    console.log('Remember to run npm run pwa:deploy')
  }
}
