import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

// Exercise the real async screen loader with synthetic IPC responses. No
// customer files, network, database or payment commands are used.
const source = fs.readFileSync('src/renderer/src/components/BookingInvoices.jsx', 'utf8')
const start = source.indexOf('  const retryAfterObservedRecovery = (')
const end = source.indexOf('\n  useEffect(', start)
assert.ok(start >= 0 && end > start)
const loaderSource = source.slice(start, end)

function fixture(readInvoices) {
  const previous = [{ booking_id: 'last-good-invoice', total_amount: 500 }]
  const state = { rows: previous, error: '', loading: false, notifications: 0 }
  const request = { current: 0 }
  const deps = {
    invoiceLoadRequestRef: request,
    loadInvoicesRef: { current: null },
    syncRecoveryVersionRef: { current: 0 },
    lastRecoveryRetryVersionRef: { current: 0 },
    invoiceReadFailedRef: { current: false },
    invoices: previous,
    setLoading: value => { state.loading = value },
    setLoadError: value => { state.error = value },
    setIsOffline: () => {},
    setInvoices: rows => { state.rows = rows },
    setSelectedInvoice: update => update(null),
    window: {
      api: {
        invoices: { getBookingInvoices: (...args) => readInvoices(...args) },
        conference: { getAll: async () => [] },
        sync: { getStatus: async () => ({ isOnline: true }) }
      },
      dispatchEvent: () => { state.notifications += 1 }
    }
  }
  const load = new Function('deps', `const {${Object.keys(deps).join(',')}} = deps;\n${loaderSource}\nreturn loadInvoices;`)(deps)
  return { state, previous, request, load }
}

test('failed invoice refresh preserves last good rows and reports the failure', async () => {
  const f = fixture(async () => { throw new Error('Server access could not be verified') })
  await f.load()
  assert.equal(f.state.rows, f.previous)
  assert.match(f.state.error, /could not be verified/)
  assert.equal(f.state.loading, false)
  assert.equal(f.state.notifications, 0)
})

test('successful recovery replaces rows and clears the warning only after success', async () => {
  let fail = true
  const f = fixture(async () => {
    if (fail) throw new Error('Connection failed')
    return [{ booking_id: 'recovered-invoice', total_amount: 500 }]
  })
  await f.load()
  assert.ok(f.state.error)
  fail = false
  await f.load()
  assert.equal(f.state.rows[0].booking_id, 'recovered-invoice')
  assert.equal(f.state.error, '')
  assert.equal(f.state.notifications, 1)
})

test('late failure from an older refresh cannot replace a recovered list or warning', async () => {
  let rejectOld
  let calls = 0
  const f = fixture(() => ++calls === 1
    ? new Promise((_, reject) => { rejectOld = reject })
    : Promise.resolve([{ booking_id: 'newest-invoice' }]))
  const old = f.load()
  await f.load()
  rejectOld(new Error('Old connection failure'))
  await old
  assert.equal(f.state.rows[0].booking_id, 'newest-invoice')
  assert.equal(f.state.error, '')
  assert.equal(f.state.notifications, 1)
})

test('scope invalidation prevents a late response from publishing prior-lodge invoices', async () => {
  let resolveOld
  const f = fixture(() => new Promise(resolve => { resolveOld = resolve }))
  const old = f.load()
  f.request.current += 1 // effect cleanup when account/lodge/auth context changes
  resolveOld([{ booking_id: 'prior-lodge-invoice' }])
  await old
  assert.equal(f.state.rows, f.previous)
  assert.equal(f.state.notifications, 0)
})

test('a malformed invoice response is unavailable rather than a successful empty list', async () => {
  const f = fixture(async () => ({ error: 'Invalid response' }))
  await f.load()
  assert.equal(f.state.rows, f.previous)
  assert.match(f.state.error, /incomplete/)
  assert.equal(f.state.notifications, 0)
})
