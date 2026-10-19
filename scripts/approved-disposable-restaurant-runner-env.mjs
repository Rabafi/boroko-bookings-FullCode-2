import { validateLedgerDisposableEnvironment } from '../tests/helpers/ledger-disposable-connection.mjs'

const fixedGuards = Object.freeze({
  LUNA_REMEDIATION_TARGET_MARKER: 'LUNA-REMEDIATION-DISPOSABLE-v1',
  LUNA_REMEDIATION_EXPECTED_DATABASE: 'postgres',
  LUNA_REMEDIATION_EXPECTED_PROJECT_REF: 'repsrmlomedqrmrdsbga'
})

const runtimeNames = ['PATH', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'CI', 'NODE_ENV', 'TZ']
const secureNames = ['LUNA_REMEDIATION_TEST_DB_URL', 'LUNA_REMEDIATION_LEDGER_STAFF_SESSION']

export function buildApprovedDisposableRestaurantRunnerEnvironment(source = process.env) {
  for (const [name, expected] of Object.entries(fixedGuards)) {
    if (source[name] && source[name] !== expected) throw new Error(`${name} does not match the approved disposable target.`)
  }
  const candidate = { ...source, ...fixedGuards }
  const target = validateLedgerDisposableEnvironment(candidate)
  const env = {}
  for (const name of runtimeNames) if (source[name]) env[name] = source[name]
  Object.assign(env, fixedGuards)
  for (const name of secureNames) env[name] = source[name]
  return { env, target: { hostname: target.hostname, project_ref: target.expectedProjectRef, database: target.expectedDatabase } }
}
