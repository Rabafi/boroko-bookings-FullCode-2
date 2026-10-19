import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { connectVerifiedDisposableDatabase, reportBlocked } from './helpers/luna-disposable-database.mjs'
import { runHotelFolioDiagnosticAcceptance } from './helpers/hotel-folio-diagnostic-acceptance.mjs'

const projectRef = process.env.LUNA_REMEDIATION_EXPECTED_PROJECT_REF
const lodgeId = process.env.LUNA_REMEDIATION_HOTEL_FIXTURE_LODGE_ID
const userId = process.env.LUNA_REMEDIATION_HOTEL_FIXTURE_USER_ID
const anonKey = process.env.LUNA_REMEDIATION_ANON_KEY
const evidencePath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../docs/audits/2026-10-07/accounting-remediation/evidence/hotel-diagnostic-results.json')

if (!anonKey) throw new Error('LUNA_REMEDIATION_ANON_KEY is required for actual anon-key HTTPS acceptance.')
if (!lodgeId || !userId) throw new Error('Synthetic Hotel fixture lodge/user IDs are required.')

let connection
try {
  connection = await connectVerifiedDisposableDatabase()
  const report = await runHotelFolioDiagnosticAcceptance({
    client: connection.client,
    projectRef,
    lodgeId,
    userId,
    anonKey,
    evidencePath
  })
  console.log(JSON.stringify(report, null, 2))
} catch (error) {
  if (!reportBlocked(error)) throw error
} finally {
  await connection?.client.end().catch(() => {})
}
