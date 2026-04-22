import { readFileSync, existsSync } from 'fs'
import path from 'path'
import { spawnSync } from 'child_process'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const projectRoot = path.resolve(__dirname, '..')

const args = process.argv.slice(2)
const mode = ['patch', 'minor', 'major', 'publish'].includes(args[0]) ? args[0] : 'patch'
const remindPwa = args.includes('--remind-pwa')

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
  run('npm.cmd', ['run', 'build'], {
    GH_TOKEN: ghToken,
    EP_DRAFT: 'false',
    EP_PRE_RELEASE: 'false',
    EP_CHANNEL: 'latest'
  })
  run('npx.cmd', ['electron-builder', '--win', 'nsis', '--publish', 'always'], {
    GH_TOKEN: ghToken,
    EP_DRAFT: 'false',
    EP_PRE_RELEASE: 'false',
    EP_CHANNEL: 'latest'
  })
} else {
  run('npm.cmd', ['version', mode, '--no-git-tag-version'], { GH_TOKEN: ghToken })
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
