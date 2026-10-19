const secureNames = [
  'LUNA_REMEDIATION_TEST_DB_URL',
  'LUNA_REMEDIATION_LEDGER_STAFF_SESSION'
]
const secureStatus = Object.fromEntries(secureNames.map(name => [name, process.env[name] ? 'present' : 'missing']))
const runnerGuards = 'fixed in the maintained command: disposable project repsrmlomedqrmrdsbga / postgres / LUNA-REMEDIATION-DISPOSABLE-v1'
const ready = Object.values(secureStatus).every(value => value === 'present')
console.log(JSON.stringify({ ready, secureStatus, runnerGuards }))
if (!ready) process.exitCode = 2
