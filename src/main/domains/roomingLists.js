// @ts-check
import { state } from '../state.js'
import { readCache, writeCache, dedupePromise } from './infrastructure.js'

const CACHE_KEY = 'rooming-lists'

/** @returns {NonNullable<typeof state.supabase>} */
function supabaseForDomainRpc() {
  // Preserve the existing unguarded RPC dereference if session/client setup is absent.
  return /** @type {NonNullable<typeof state.supabase>} */ (state.supabase)
}

/** @typedef {Record<string, unknown> & {guest_name: string, check_in: string, check_out: string}} RoomingListEntry */

/** @param {unknown} error @returns {unknown} */
function readErrorMessage(error) {
  if (error === null || error === undefined) return undefined
  // Preserve the existing `.message` read for all thrown values.
  return /** @type {{message?: unknown}} */ (error).message
}

/** @returns {Promise<unknown>} */
async function _getAllRoomingLists() {
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) return []
  try {
    const { data, error } = await supabaseForDomainRpc().rpc('rpc', { fn: 'get_rooming_lists', args: { p_lodge_id: currentLodgeId } })
    if (error) throw error
    const rows = Array.isArray(data) ? data : []
    writeCache(CACHE_KEY, rows)
    return rows
  } catch (e) {
    const cached = readCache(CACHE_KEY)
    return Array.isArray(cached) ? cached : []
  }
}

/** @param {...unknown} args @returns {Promise<unknown>} */
export const getAllRoomingLists = (...args) => dedupePromise('getAllRoomingLists', () => _getAllRoomingLists())

/** @param {unknown} entries @param {unknown} corporateAccountId @param {unknown} groupBlockId @param {unknown} importName @param {unknown} [lodgeIdArg] @returns {Promise<{rooming_list_id: unknown, total_rows: number, processed_rows: number, failed_rows: number, errors: Array<{row: number, error: unknown}>}>} */
export async function processRoomingList(entries, corporateAccountId, groupBlockId, importName, lodgeIdArg) {
  const currentLodgeId = lodgeIdArg || state.lodgeId
  if (!currentLodgeId) throw new Error('No lodge selected')
  if (!Array.isArray(entries) || entries.length === 0) {
    throw new Error('Rooming list must have at least one entry')
  }
  // The IPC boundary proves only the array container and nonempty length.
  // Row values remain unknown; malformed rows keep failing inside the existing
  // per-row try/catch below.
  const entryRows = /** @type {unknown[]} */ (entries)

  const listData = await supabaseForDomainRpc().rpc('rpc', {
    fn: 'create_rooming_list',
    args: {
      p_lodge_id: currentLodgeId,
      p_corporate_account_id: corporateAccountId || null,
      p_group_block_id: groupBlockId || null,
      p_import_name: importName,
      p_total_rows: entryRows.length
    }
  })
  if (listData.error) throw listData.error

  const listId = listData.data?.rooming_list_id
  if (!listId) throw new Error('Failed to create rooming list')

  let processed = 0
  let failed = 0
  const errors = []

  for (let i = 0; i < entryRows.length; i++) {
    try {
      // This view only types the existing property reads. A null or primitive
      // row still produces the same native property-access outcome in this try.
      const entry = /** @type {Record<string, unknown>} */ (entryRows[i])
      const result = await supabaseForDomainRpc().rpc('rpc', {
        fn: 'create_rooming_list_entry',
        args: {
          p_rooming_list_id: listId,
          p_payload: {
            guest_name: entry.guest_name,
            guest_email: entry.guest_email,
            guest_phone: entry.guest_phone,
            room_type: entry.room_type,
            check_in: entry.check_in,
            check_out: entry.check_out,
            adults: entry.adults || 1,
            children: entry.children || 0,
            row_number: i + 1
          }
        }
      })
      if (result.error) {
        failed++
        errors.push({ row: i + 1, error: result.error.message })
      } else {
        processed++
      }
    } catch (e) {
      failed++
      errors.push({ row: i + 1, error: readErrorMessage(e) })
    }
  }

  await supabaseForDomainRpc().rpc('rpc', {
    fn: 'update_rooming_list_status',
    args: {
      p_id: listId,
      p_processed_rows: processed,
      p_failed_rows: failed,
      p_status: failed === 0 ? 'completed' : 'partial',
      p_error_log: errors
    }
  })

  return {
    rooming_list_id: listId,
    total_rows: entryRows.length,
    processed_rows: processed,
    failed_rows: failed,
    errors
  }
}

/** @param {unknown} csvText @returns {RoomingListEntry[]} */
export function parseRoomingListCSV(csvText) {
  if (!csvText || typeof csvText !== 'string') {
    throw new Error('Invalid CSV content')
  }

  const lines = csvText.trim().split('\n')
  if (lines.length < 2) {
    throw new Error('CSV must have a header row and at least one data row')
  }

  const headers = lines[0].split(',').map(h => h.trim().toLowerCase())
  const requiredHeaders = ['guest_name', 'check_in', 'check_out']
  const missing = requiredHeaders.filter(h => !headers.includes(h))
  if (missing.length > 0) {
    throw new Error(`Missing required columns: ${missing.join(', ')}`)
  }

  const entries = []
  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split(',').map(v => v.trim())
    /** @type {Record<string, string>} */
    const entry = {}
    headers.forEach((h, idx) => {
      entry[h] = values[idx] || ''
    })
    // Required headers were checked before parsing, and every CSV cell is a string.
    entries.push(/** @type {RoomingListEntry} */ (entry))
  }

  return entries
}
