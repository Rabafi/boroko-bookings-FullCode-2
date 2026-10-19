import { readFile } from 'node:fs/promises'
import { runReadOnlyDatabaseContract, reportBlocked } from './helpers/luna-disposable-database.mjs'

try {
  const sql = await readFile(new URL('./hotel-folio-financial-contract.sql', import.meta.url), 'utf8')
  await runReadOnlyDatabaseContract({ label: 'Hotel folio financial contract', sql })
} catch (error) {
  if (!reportBlocked(error)) throw error
}