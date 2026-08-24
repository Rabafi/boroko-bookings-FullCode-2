// Electron drops own (non-indexed) properties on arrays twice: once when an
// ipcMain.handle result crosses to the preload, and again when a
// contextBridge-exposed function result crosses into the renderer's main
// world. The main process therefore wraps metadata-carrying arrays in plain
// `__rowsTransport` envelopes (which survive both boundaries). The preload
// passes those envelopes through untouched. Components must unwrap the
// envelopes in the renderer's main world with this helper, where the
// metadata survives for the lifetime of the value.

const IPC_META_KEYS = ['_source', '_complete', '_tender_complete', '_item_detail_complete', '_available']

export function unpackTransport(value) {
  if (Array.isArray(value)) return value.map(unpackTransport)
  if (value && typeof value === 'object') {
    if (value.__rowsTransport === true && Array.isArray(value.rows)) {
      const rows = value.rows.map(unpackTransport)
      for (const k of IPC_META_KEYS) {
        if (value[k] !== undefined) {
          Object.defineProperty(rows, k, { value: value[k], enumerable: true, configurable: true })
        }
      }
      return rows
    }
    const proto = Object.getPrototypeOf(value)
    if (proto === Object.prototype || proto === null) {
      const out = {}
      for (const k of Object.keys(value)) out[k] = unpackTransport(value[k])
      return out
    }
  }
  return value
}
