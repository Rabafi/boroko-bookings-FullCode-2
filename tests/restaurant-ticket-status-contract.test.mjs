import { describe, it } from 'node:test'
import assert from 'node:assert'
import { readFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')

function read(relPath) {
  return readFileSync(join(ROOT, relPath), 'utf8')
}

const POS_JS = 'src/main/domains/pos.js'
const PRELOAD = 'src/preload/index.js'
const INDEX = 'src/main/index.js'
const DATABASE = 'src/main/database.js'

describe('Restaurant Ticket Status Contract', () => {

  describe('updatePosTicketStatus (server-first)', () => {
    it('pos.js has updatePosTicketStatus function', () => {
      const js = read(POS_JS)
      assert.ok(js.includes('export async function updatePosTicketStatus'), 'function exists')
    })

    it('validates status against allowed set', () => {
      const js = read(POS_JS)
      const fnIdx = js.indexOf('export async function updatePosTicketStatus')
      const fnBody = js.slice(fnIdx, fnIdx + 1500)
      assert.ok(fnBody.includes("'new'"), 'allows new status')
      assert.ok(fnBody.includes("'preparing'"), 'allows preparing status')
      assert.ok(fnBody.includes("'ready'"), 'allows ready status')
      assert.ok(fnBody.includes("'served'"), 'allows served status')
      assert.ok(fnBody.includes("'cancelled'"), 'allows cancelled status')
    })

    it('saves previous state for rollback on server failure', () => {
      const js = read(POS_JS)
      const fnIdx = js.indexOf('export async function updatePosTicketStatus')
      const fnBody = js.slice(fnIdx, fnIdx + 1500)
      assert.ok(fnBody.includes('previousTickets'), 'captures previous state')
      assert.ok(fnBody.includes('writePosTickets(previousTickets)'), 'restores on error')
    })

    it('calls update_pos_prep_ticket_status RPC', () => {
      const js = read(POS_JS)
      const fnIdx = js.indexOf('export async function updatePosTicketStatus')
      const fnBody = js.slice(fnIdx, fnIdx + 1500)
      assert.ok(fnBody.includes("'update_pos_prep_ticket_status'"), 'calls server RPC')
    })

    it('returns server error response when RPC returns success: false', () => {
      const js = read(POS_JS)
      const fnIdx = js.indexOf('export async function updatePosTicketStatus')
      const fnBody = js.slice(fnIdx, fnIdx + 1500)
      assert.ok(fnBody.includes("data?.success === false"), 'handles RPC success: false')
      assert.ok(fnBody.includes('return data'), 'returns error data to caller')
    })

    it('updates local cache after successful server response', () => {
      const js = read(POS_JS)
      const fnIdx = js.indexOf('export async function updatePosTicketStatus')
      const fnBody = js.slice(fnIdx, fnIdx + 2000)
      assert.ok(fnBody.includes('data?.ticket?.id'), 'checks for returned ticket')
      assert.ok(fnBody.includes('writePosTickets(readPosTickets().map'), 'updates local cache with server ticket')
    })

    it('writes audit log on successful status update', () => {
      const js = read(POS_JS)
      const fnIdx = js.indexOf('export async function updatePosTicketStatus')
      const fnBody = js.slice(fnIdx, fnIdx + 2500)
      assert.ok(fnBody.includes('appendPosAudit'), 'writes audit')
      assert.ok(fnBody.includes("'ticket_status_updated'"), 'audit action is ticket_status_updated')
    })

    it('rejects offline ticket status updates to prevent state mismatch', () => {
      const js = read(POS_JS)
      const fnIdx = js.indexOf('export async function updatePosTicketStatus')
      const fnBody = js.slice(fnIdx, fnIdx + 3000)
      assert.ok(fnBody.includes('Ticket status updates require an internet connection'), 'returns error when offline')
      assert.ok(!fnBody.includes('offline: true'), 'does not return offline: true')
    })

    it('updates table-tab status link after ticket update', () => {
      const js = read(POS_JS)
      const fnIdx = js.indexOf('export async function updatePosTicketStatus')
      const fnBody = js.slice(fnIdx, fnIdx + 2500)
      assert.ok(fnBody.includes('updateTableTabStatusByTicket'), 'updates linked table-tab status')
    })

    it('blocks offline ticket status updates to prevent state mismatch', () => {
      const js = read(POS_JS)
      const fnIdx = js.indexOf('export async function updatePosTicketStatus')
      const fnBody = js.slice(fnIdx, fnIdx + 2500)
      assert.ok(fnBody.includes('Ticket status updates require an internet connection'), 'returns error when offline')
      assert.ok(!fnBody.includes('offline: true'), 'does not return offline: true')
    })
  })

  describe('IPC and preload wiring', () => {
    it('pos.js updatePosTicketStatus is exported', () => {
      const js = read(POS_JS)
      assert.ok(js.includes('export async function updatePosTicketStatus'), 'exported')
    })

    it('database.js exports updatePosTicketStatus', () => {
      const db = read(DATABASE)
      assert.ok(db.includes('updatePosTicketStatus'), 'exported from database.js')
    })

    it('preload.js has updateTicketStatus method', () => {
      const pl = read(PRELOAD)
      assert.ok(pl.includes('updateTicketStatus'), 'preload method exists')
    })

    it('index.js has pos:updateTicketStatus IPC handler', () => {
      const idx = read(INDEX)
      assert.ok(idx.includes('pos:updateTicketStatus'), 'IPC handler exists')
    })
  })

  describe('getPosTickets (server-backed reads)', () => {
    it('pos.js getPosTickets fetches from server when online', () => {
      const js = read(POS_JS)
      const fnIdx = js.indexOf('export async function getPosTickets')
      const fnBody = js.slice(fnIdx, fnIdx + 2500)
      assert.ok(fnBody.includes("'pos_prep_tickets'"), 'queries pos_prep_tickets table')
      assert.ok(fnBody.includes('writePosTickets'), 'caches results locally')
    })

    it('getPosTickets supports station filtering', () => {
      const js = read(POS_JS)
      const fnIdx = js.indexOf('export async function getPosTickets')
      const fnBody = js.slice(fnIdx, fnIdx + 1000)
      assert.ok(fnBody.includes('station'), 'supports station filter parameter')
    })
  })
})
