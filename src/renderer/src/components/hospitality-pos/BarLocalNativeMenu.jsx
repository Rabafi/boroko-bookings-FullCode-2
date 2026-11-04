// @ts-check
import { useCallback, useEffect, useState } from 'react'
import { useAccess } from '../../app-context.jsx'
import { loadCompleteBarList } from '../../../../shared/barLocalPagination.js'
import { barTaxPercentToRate, barTaxRateToPercent } from '../../../../shared/barLocalTaxInput.js'

/** Regular Menu screen backed only by the authenticated local Bar service. */
export default function BarLocalNativeMenu() {
  const access = useAccess()
  const canManage = access?.effectiveCapabilities?.['pos.menu_manage'] === true || access?.effectiveCapabilities?.['menu.manage'] === true
  const [rows, setRows] = useState([])
  const [versions, setVersions] = useState({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [pending, setPending] = useState(null)
  const [draft, setDraft] = useState({ product_id: '', expected_version: '', sku: '', name: '', category: '', price: '', tax_rate: '0', track_stock: true })

  const refresh = useCallback(async () => {
    setRows([])
    setVersions({})
    const query = (name, filters) => window.api.barLocal.query(name, filters)
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const snapshots = new Map()
      const verifiedQuery = async (name, filters) => {
        const result = await query(name, filters)
        if (!Array.isArray(result?.unavailable) || result.unavailable.length !== 0) {
          throw new Error('The local menu read has unavailable fields. Refresh before relying on the catalogue.')
        }
        const scope = JSON.stringify([result.scope?.business_id, result.scope?.outlet_id, result.scope?.device_id, result.scope?.actor_staff_id])
        snapshots.set(name, { scope, watermark: result.snapshot_watermark })
        return result
      }
      const [products, availability] = await Promise.all([
        loadCompleteBarList(verifiedQuery, 'menu.list', { include_inactive: true }),
        loadCompleteBarList(verifiedQuery, 'menu.availability', { include_inactive: true })
      ])
      const productSnapshot = snapshots.get('menu.list')
      const availabilitySnapshot = snapshots.get('menu.availability')
      if (productSnapshot?.scope !== availabilitySnapshot?.scope || productSnapshot?.watermark !== availabilitySnapshot?.watermark) continue
      const byId = new Map(products.map((row) => [String(row.product_id), row]))
      if (products.length !== availability.length || availability.some((row) => !byId.has(String(row.product_id)))) {
        throw new Error('The local product and availability lists do not match. Refresh before editing.')
      }
      setRows(availability)
      setVersions(Object.fromEntries(products.map((row) => [String(row.product_id), Number(row.version)])))
      setError('')
      return
    }
    throw new Error('The local menu changed while loading. Refresh before editing.')
  }, [])

  const refreshJournal = useCallback(async () => {
    const open = await window.api.barLocal.getOpenIntents()
    if (!Array.isArray(open)) throw new Error('The local operation journal could not be checked. Menu changes are paused.')
    setPending(open[0] && typeof open[0].operation_id === 'string' ? {
      operation_id: open[0].operation_id, command: open[0].command, state: open[0].state || 'outcome_unknown'
    } : null)
  }, [])

  useEffect(() => {
    let active = true
    Promise.all([refresh(), refreshJournal()]).catch((cause) => { if (active) setError(cause?.message || 'Local menu could not be verified.') })
    return () => { active = false }
  }, [refresh, refreshJournal])

  const submit = async (command, payload, retryId = null) => {
    if (!canManage || busy || (pending && (!retryId || retryId !== pending.operation_id))) return
    const operationId = retryId || crypto.randomUUID()
    let outcomeUnknown = false
    setBusy(true); setError(''); setNotice('')
    try {
      const result = retryId
        ? await window.api.barLocal.retryOperation(operationId)
        : await window.api.barLocal.command({ command, payload, operation_id: operationId })
      if (result?.outcome === 'unknown') {
        outcomeUnknown = true
        setPending({ operation_id: operationId, command, state: 'outcome_unknown' })
        throw new Error(`${result.error?.message || 'The local outcome is unknown.'} Retry this same operation before starting another change.`)
      }
      if (result?.outcome !== 'committed_local') throw new Error(result?.error?.message || 'The local authority refused this change. Nothing was committed.')
      setPending(null)
      setNotice(command === 'catalogue.upsert' && payload.active === false ? 'Product archived. Sales and stock history remain available.' : 'Local menu change saved.')
      if (command === 'catalogue.upsert') setDraft({ product_id: '', expected_version: '', sku: '', name: '', category: '', price: '', tax_rate: '0', track_stock: true })
      await refresh()
      await refreshJournal()
    } catch (cause) {
      setError(cause?.message || 'Local menu change failed.')
      if (!outcomeUnknown) {
        try { await refreshJournal() } catch { /* Existing error remains visible; fail closed. */ }
      }
    } finally { setBusy(false) }
  }

  const save = (event) => {
    event.preventDefault()
    if (!draft.sku.trim() || !draft.name.trim() || !draft.category.trim() || !/^\d+(?:\.\d{1,2})?$/.test(draft.price)) {
      setError('Enter a SKU, name, category, valid price and tax rate before saving.')
      return
    }
    let taxRate
    try { taxRate = barTaxPercentToRate(draft.tax_rate) } catch (cause) { setError(cause?.message || 'Enter a valid tax percentage.'); return }
    const payload = { ...draft, sku: draft.sku.trim(), name: draft.name.trim(), category: draft.category.trim(), price: draft.price, tax_rate: taxRate, active: true }
    if (payload.product_id) { payload.expected_version = Number(payload.expected_version) }
    else { delete payload.product_id; delete payload.expected_version }
    void submit('catalogue.upsert', payload)
  }

  const edit = (row) => setDraft({ product_id: String(row.product_id), expected_version: String(versions[String(row.product_id)] || ''), sku: String(row.sku || ''), name: String(row.name || ''), category: String(row.category || ''), price: String(row.price ?? ''), tax_rate: barTaxRateToPercent(row.tax_rate ?? '0'), track_stock: row.track_stock === true })
  const update = (key, value) => setDraft((current) => ({ ...current, [key]: value }))

  return <main className="mx-auto max-w-6xl space-y-5 p-5 text-slate-900">
    <header><h1 className="text-2xl font-bold">Menu and availability</h1><p className="mt-1 text-sm text-slate-600">Changes are recorded by this Bar’s local database for the signed-in outlet.</p></header>
    {error && <div role="alert" className="rounded border border-red-300 bg-red-50 p-3 text-sm text-red-900">{error}</div>}
    {notice && <div role="status" className="rounded border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900">{notice}</div>}
    {pending && <div role="alert" className="rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">Operation {pending.operation_id} needs resolution. Retry the original operation before changing the menu. <button className="ml-2 rounded bg-amber-800 px-3 py-1 text-white" disabled={busy} onClick={() => void submit(pending.command, {}, pending.operation_id)}>Retry saved operation</button></div>}
    {!canManage && <p role="status" className="rounded border border-amber-300 bg-amber-50 p-3 text-sm">Your local role can view the menu but cannot change it.</p>}
    <form onSubmit={save} className="grid gap-3 rounded-xl border bg-white p-4 md:grid-cols-4">
      <h2 className="md:col-span-4 font-semibold">{draft.product_id ? 'Edit product' : 'Add product'}</h2>
      <label className="text-sm">SKU<input required maxLength={80} value={draft.sku} onChange={(e) => update('sku', e.target.value)} disabled={Boolean(draft.product_id) || busy || Boolean(pending)} className="mt-1 w-full rounded border p-2" /></label>
      <label className="text-sm">Name<input required maxLength={200} value={draft.name} onChange={(e) => update('name', e.target.value)} disabled={busy || Boolean(pending)} className="mt-1 w-full rounded border p-2" /></label>
      <label className="text-sm">Category<input required maxLength={80} value={draft.category} onChange={(e) => update('category', e.target.value)} disabled={busy || Boolean(pending)} className="mt-1 w-full rounded border p-2" /></label>
      <label className="text-sm">Price<input required inputMode="decimal" value={draft.price} onChange={(e) => update('price', e.target.value)} disabled={busy || Boolean(pending)} className="mt-1 w-full rounded border p-2" /></label>
      <label className="text-sm">Tax (%)<input required inputMode="decimal" value={draft.tax_rate} onChange={(e) => update('tax_rate', e.target.value)} disabled={busy || Boolean(pending)} className="mt-1 w-full rounded border p-2" /></label>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={draft.track_stock} onChange={(e) => update('track_stock', e.target.checked)} disabled={busy || Boolean(pending)} />Track stock</label>
      <div className="flex items-end gap-2"><button disabled={!canManage || busy || Boolean(pending)} className="rounded bg-amber-600 px-4 py-2 font-semibold text-white disabled:opacity-50">Save locally</button>{draft.product_id && <button type="button" className="rounded border px-4 py-2" onClick={() => setDraft({ product_id: '', expected_version: '', sku: '', name: '', category: '', price: '', tax_rate: '0', track_stock: true })}>Cancel</button>}</div>
    </form>
    <section className="overflow-x-auto rounded-xl border bg-white"><table className="w-full text-left text-sm"><thead><tr className="border-b bg-slate-50"><th className="p-3">Product</th><th className="p-3">SKU</th><th className="p-3">Price</th><th className="p-3">Stock</th><th className="p-3">Availability</th><th className="p-3">Actions</th></tr></thead><tbody>{rows.map((row) => <tr key={String(row.product_id)} className="border-b"><td className="p-3">{String(row.name)}{row.product_active !== true && <span className="ml-2 text-xs text-amber-700">Archived</span>}</td><td className="p-3">{String(row.sku)}</td><td className="p-3">{Number(row.price).toFixed(2)}</td><td className="p-3">{row.track_stock === true ? String(row.stock_quantity ?? '0') : 'Not tracked'}</td><td className="p-3">{row.available === true ? 'Available' : 'Sold out'}</td><td className="space-x-2 p-3"><button disabled={!canManage || busy || Boolean(pending) || row.product_active !== true} onClick={() => edit(row)} className="rounded border px-2 py-1 disabled:opacity-40">Edit</button>{row.product_active === true && <><button disabled={!canManage || busy || Boolean(pending)} onClick={() => void submit('catalogue.availability.set', { product_id: row.product_id, available: row.available !== true, ...(Number(row.availability_version) > 0 ? { expected_version: Number(row.availability_version) } : {}) })} className="rounded border px-2 py-1 disabled:opacity-40">{row.available === true ? 'Mark sold out' : 'Make available'}</button><button disabled={!canManage || busy || Boolean(pending)} onClick={() => { if (!window.confirm(`Archive ${String(row.name)}? History will remain.`)) return; void submit('catalogue.upsert', { product_id: row.product_id, expected_version: versions[String(row.product_id)], sku: row.sku, name: row.name, category: row.category, price: row.price, tax_rate: row.tax_rate, track_stock: row.track_stock, active: false }) }} className="rounded border border-red-300 px-2 py-1 text-red-800 disabled:opacity-40">Archive</button></>}</td></tr>)}</tbody></table>{rows.length === 0 && <p className="p-4 text-sm text-slate-600">No products in this Bar catalogue yet.</p>}</section>
  </main>
}
