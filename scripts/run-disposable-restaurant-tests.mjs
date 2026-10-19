import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { childProcessExitCode } from './test-run-result.mjs'
import { buildApprovedDisposableRestaurantRunnerEnvironment } from './approved-disposable-restaurant-runner-env.mjs'

const root = resolve(import.meta.dirname, '..')

try {
  const { env, target } = buildApprovedDisposableRestaurantRunnerEnvironment(process.env)
  console.log(`Running guarded Restaurant suites for ${target.project_ref}/${target.database} (${target.hostname}).`)
  console.log('No local Supabase stack is started or reset by this command.')
  const result = spawnSync(process.execPath, [resolve(root, 'tests', 'run-restaurant-suite.mjs'), '--keep-going'], {
    cwd: root,
    env,
    stdio: 'inherit',
    shell: false
  })
  if (result.error) console.error('Restaurant runner could not start.')
  process.exitCode = childProcessExitCode(result)
} catch (error) {
  // Validation errors name missing settings or fixed guard failures only; do
  // not surface URL parsing details, environment values, or credential text.
  console.error(`BLOCKED: ${error?.message || 'approved disposable configuration is invalid'}; no child process or database connection was started.`)
  process.exitCode = 2
}
