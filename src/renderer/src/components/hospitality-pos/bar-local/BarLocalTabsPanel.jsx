// @ts-check
import { useEffect, useState } from 'react'
import BarLocalTenderEditor from './BarLocalTenderEditor.jsx'
import { centsToMoney, evaluateTenders, makeTenderRow, moneyToCents } from './tenderMath.js'

function displayMoney(value) {
  if (value === null || value === undefined || value === '') return '-'
  const number = Number(value)
  return Number.isFinite(number) ? number.toFixed(2) : String(value)
}

function displayQuantity(value) {
  if (value === null || value === undefined || value === '') return '-'
  const number = Number(value)
  return Number.isFinite(number) ? String(Number(number.toFixed(6))) : String(value)
}

/**
 * @param {{
 *   openTabs: Array<Record<string, unknown>>,
 *   selectedTab: Record<string, unknown>|null,
 *   selectedTabId: string,
 *   onSelectTab: (tabId: string) => void,
 *   onRefresh: () => void,
 *   onCommand: (command: string, payload: Record<string, unknown>) => Promise<unknown>|unknown,
 *   onApprovedCommand: (command: string, payload: Record<string, unknown>, pin: string) => Promise<unknown>|unknown,
 *   onAddCart: () => void,
 *   cartCount: number,
 *   cartTotalCents: number|null,
 *   shift: Record<string, unknown>|null,
 *   staffRows: Array<Record<string, unknown>>,
 *   customers: Array<Record<string, unknown>>,
 *   blocked: boolean,
 *   localReady: boolean,
 *   canUseStoreCredit: boolean,
 *   canUseVoucher: boolean
 * }} props
 */
export default function BarLocalTabsPanel({
  openTabs, selectedTab, selectedTabId, onSelectTab, onRefresh, onCommand, onApprovedCommand,
  onAddCart, cartCount, cartTotalCents, shift, staffRows, customers, blocked, localReady,
  canUseStoreCredit, canUseVoucher
}) {
  const [tabDraft, setTabDraft] = useState({ table_label: '', note: '' })
  const [settleRows, setSettleRows] = useState([makeTenderRow()])
  const [transferDraft, setTransferDraft] = useState({ target_staff_id: '', reason: '', pin: '' })
  const [splitSelection, setSplitSelection] = useState(/** @type {string[]} */ ([]))
  const [splitDraft, setSplitDraft] = useState({ target_owner_staff_id: '', table_label: '', note: '', reason: '', pin: '' })
  const [mergeTargetId, setMergeTargetId] = useState('')
  const [mergeDraft, setMergeDraft] = useState({ reason: '', pin: '' })
  const [actionError, setActionError] = useState('')

  useEffect(() => {
    setSettleRows([makeTenderRow()])
    setSplitSelection([])
    setTransferDraft({ target_staff_id: '', reason: '', pin: '' })
    setSplitDraft({ target_owner_staff_id: '', table_label: '', note: '', reason: '', pin: '' })
    setMergeTargetId('')
    setMergeDraft({ reason: '', pin: '' })
    setActionError('')
  }, [selectedTabId])

  const tabTotalCents = selectedTab ? moneyToCents(selectedTab.gross_total) : null
  const evaluation = evaluateTenders({ totalCents: tabTotalCents ?? 0, rows: settleRows })
  const openLines = selectedTab && Array.isArray(selectedTab.lines)
    ? selectedTab.lines.filter((line) => line.status === 'open')
    : []
  const otherTabs = openTabs.filter((tab) => String(tab.tab_id) !== String(selectedTabId))
  const activeStaff = staffRows.filter((staff) => staff.status === 'active')

  const openTab = (event) => {
    event.preventDefault()
    setActionError('')
    if (!shift) { setActionError('Open your trading shift before opening a tab.'); return }
    if (!tabDraft.table_label.trim() && !tabDraft.note.trim()) { setActionError('Enter a table label or note for the tab.'); return }
    void onCommand('tab.open', { table_label: tabDraft.table_label.trim() || undefined, note: tabDraft.note.trim() || undefined })
    setTabDraft({ table_label: '', note: '' })
  }

  const toggleSplitLine = (lineId) => {
    setSplitSelection((current) => current.includes(lineId) ? current.filter((id) => id !== lineId) : [...current, lineId])
  }

  const transferTab = (event) => {
    event.preventDefault()
    setActionError('')
    if (!selectedTab) return
    if (!transferDraft.target_staff_id) { setActionError('Select the staff member receiving the tab.'); return }
    if (!/^\d{4,12}$/.test(transferDraft.pin)) { setActionError('A manager PIN (4-12 digits) is required to approve the ownership transfer.'); return }
    void onApprovedCommand('tab.transfer', {
      tab_id: selectedTab.tab_id,
      expected_version: selectedTab.version,
      target_staff_id: transferDraft.target_staff_id,
      reason: transferDraft.reason.trim() || undefined
    }, transferDraft.pin)
    setTransferDraft({ target_staff_id: '', reason: '', pin: '' })
  }

  const splitTab = (event) => {
    event.preventDefault()
    setActionError('')
    if (!selectedTab) return
    if (splitSelection.length === 0) { setActionError('Select at least one open line to move into the new tab.'); return }
    if (!/^\d{4,12}$/.test(splitDraft.pin)) { setActionError('A manager PIN (4-12 digits) is required to approve the tab split.'); return }
    void onApprovedCommand('tab.split', {
      source_tab_id: selectedTab.tab_id,
      expected_version: selectedTab.version,
      line_ids: splitSelection,
      target_owner_staff_id: splitDraft.target_owner_staff_id || undefined,
      table_label: splitDraft.table_label.trim() || undefined,
      note: splitDraft.note.trim() || undefined,
      reason: splitDraft.reason.trim() || undefined
    }, splitDraft.pin)
    setSplitSelection([])
    setSplitDraft({ target_owner_staff_id: '', table_label: '', note: '', reason: '', pin: '' })
  }

  const mergeTab = (event) => {
    event.preventDefault()
    setActionError('')
    const target = otherTabs.find((tab) => String(tab.tab_id) === mergeTargetId)
    if (!selectedTab || !target) { setActionError('Select another open tab to merge into.'); return }
    if (!/^\d{4,12}$/.test(mergeDraft.pin)) { setActionError('A manager PIN (4-12 digits) is required to approve the tab merge.'); return }
    void onApprovedCommand('tab.merge', {
      source_tab_id: selectedTab.tab_id,
      source_expected_version: selectedTab.version,
      target_tab_id: target.tab_id,
      target_expected_version: target.version,
      reason: mergeDraft.reason.trim() || undefined
    }, mergeDraft.pin)
    setMergeTargetId('')
    setMergeDraft({ reason: '', pin: '' })
  }

  const settleTab = () => {
    setActionError('')
    if (!selectedTab || !shift) return
    if (evaluation.error || evaluation.tenders.length === 0) { setActionError(evaluation.error || 'Prepare the payment before settling the tab.'); return }
    void onCommand('tab.settle', {
      tab_id: selectedTab.tab_id,
      expected_version: selectedTab.version,
      tenders: evaluation.tenders,
      tip_amount: '0.00',
      discount_amount: '0.00'
    })
  }

  return (
    <section className="mt-5 grid gap-5 lg:grid-cols-[1fr_26rem]">
      <div>
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">Open tabs</h2>
          <button type="button" disabled={blocked} onClick={onRefresh} className="rounded border border-slate-600 px-3 py-1 text-xs disabled:opacity-40">Refresh</button>
        </div>
        {openTabs.length === 0 ? <p className="mt-3 rounded border border-slate-700 p-4 text-sm text-slate-300">No open tabs. Open a tab to hold a bar order, then add the counter cart or settle it with split payment.</p> : <ul className="mt-3 space-y-2">{openTabs.map((tab) => <li key={String(tab.tab_id)}><button type="button" disabled={blocked} onClick={() => onSelectTab(String(tab.tab_id))} className={`w-full rounded border p-3 text-left ${selectedTabId === String(tab.tab_id) ? 'border-amber-400 bg-amber-950/30' : 'border-slate-700 bg-slate-900'}`}><span className="flex justify-between gap-3"><span className="font-semibold">{String(tab.table_label || 'Unlabelled tab')} - v{String(tab.version)}</span><span>{displayMoney(tab.gross_total)}</span></span><span className="mt-1 block text-xs text-slate-400">{String(tab.owner_name)} - {String(tab.line_count)} open line(s)</span></button></li>)}</ul>}

        <form onSubmit={openTab} className="mt-4 rounded-xl border border-slate-700 bg-slate-900 p-4">
          <h3 className="font-semibold">Open a new tab</h3>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            <label className="text-xs">Table label<input maxLength={120} value={tabDraft.table_label} onChange={(event) => setTabDraft((draft) => ({ ...draft, table_label: event.target.value }))} className="mt-1 w-full rounded bg-slate-800 p-2 text-sm" /></label>
            <label className="text-xs">Note<input maxLength={1000} value={tabDraft.note} onChange={(event) => setTabDraft((draft) => ({ ...draft, note: event.target.value }))} className="mt-1 w-full rounded bg-slate-800 p-2 text-sm" /></label>
          </div>
          <button disabled={blocked || !localReady || !shift} className="mt-3 rounded bg-amber-500 px-4 py-2 text-sm font-semibold text-slate-950 disabled:opacity-40">Open tab</button>
          {!shift && <p className="mt-2 text-xs text-amber-200">Open your trading shift before opening a tab.</p>}
        </form>
      </div>

      <aside className="h-fit rounded-xl border border-slate-700 bg-slate-900 p-4">
        {!selectedTab ? <p className="text-sm text-slate-300">Select an open tab to add the current cart, settle with split payment, transfer ownership, split selected lines or merge tabs.</p> : <div>
          <h3 className="font-semibold">{String(selectedTab.table_label || 'Unlabelled tab')}</h3>
          <p className="mt-1 text-xs text-slate-400">Status {String(selectedTab.status)} - version {String(selectedTab.version)} - amount due {displayMoney(selectedTab.gross_total)}</p>
          <ul className="mt-3 space-y-1 text-sm">{openLines.map((line) => <li key={String(line.tab_line_id)} className="flex justify-between gap-3"><span>{String(line.name)} x {displayQuantity(line.quantity)}</span><span>{displayMoney(line.line_total)}</span></li>)}</ul>
          {openLines.length === 0 && <p className="mt-2 text-sm text-slate-300">This tab has no open lines.</p>}
          <p className="mt-3 text-xs text-slate-400">Current counter cart: {cartCount} line(s){cartTotalCents === null ? '' : `, estimate ${centsToMoney(cartTotalCents)}`}.</p>
          <button type="button" disabled={blocked || !shift || cartCount === 0 || selectedTab.status !== 'open'} onClick={onAddCart} className="mt-3 w-full rounded bg-sky-600 p-2 text-sm font-semibold disabled:opacity-40">Add current cart to tab</button>

          {selectedTab.status === 'open' && <>
            <BarLocalTenderEditor totalCents={tabTotalCents ?? 0} rows={settleRows} onChange={setSettleRows} disabled={blocked || !localReady || !shift} customers={customers} canUseStoreCredit={canUseStoreCredit} canUseVoucher={canUseVoucher} />
            <button type="button" disabled={blocked || !localReady || !shift || Boolean(evaluation.error) || evaluation.tenders.length === 0} onClick={settleTab} className="mt-1 w-full rounded bg-emerald-600 p-2 text-sm font-semibold disabled:opacity-40">Settle tab with this payment</button>

            <details className="mt-4 rounded border border-slate-700 p-3">
              <summary className="cursor-pointer text-sm font-semibold">Transfer ownership</summary>
              <form onSubmit={transferTab} className="mt-2 space-y-2">
                <label className="block text-xs">New owner<select value={transferDraft.target_staff_id} onChange={(event) => setTransferDraft((draft) => ({ ...draft, target_staff_id: event.target.value }))} className="mt-1 w-full rounded bg-slate-800 p-2 text-sm"><option value="">Select active staff</option>{activeStaff.map((staff) => <option key={String(staff.staff_id)} value={String(staff.staff_id)}>{String(staff.display_name)} - {String(staff.role)}</option>)}</select></label>
                <label className="block text-xs">Reason<input maxLength={300} value={transferDraft.reason} onChange={(event) => setTransferDraft((draft) => ({ ...draft, reason: event.target.value }))} className="mt-1 w-full rounded bg-slate-800 p-2 text-sm" /></label>
                <label className="block text-xs">Different manager PIN<input type="password" inputMode="numeric" maxLength={12} autoComplete="off" value={transferDraft.pin} onChange={(event) => setTransferDraft((draft) => ({ ...draft, pin: event.target.value.replace(/\D/g, '') }))} className="mt-1 w-full rounded bg-slate-800 p-2 text-sm" /></label>
                <button disabled={blocked || !localReady || !shift} className="w-full rounded border border-amber-600 p-2 text-sm font-semibold disabled:opacity-40">Approve and transfer tab</button>
              </form>
            </details>

            <details className="mt-3 rounded border border-slate-700 p-3">
              <summary className="cursor-pointer text-sm font-semibold">Split selected lines into a new tab</summary>
              <form onSubmit={splitTab} className="mt-2 space-y-2">
                <fieldset>
                  <legend className="text-xs text-slate-400">Open lines to move</legend>
                  <div className="mt-1 space-y-1">{openLines.map((line) => <label key={String(line.tab_line_id)} className="flex items-center gap-2 text-xs"><input type="checkbox" checked={splitSelection.includes(String(line.tab_line_id))} onChange={() => toggleSplitLine(String(line.tab_line_id))} />{String(line.name)} x {displayQuantity(line.quantity)} - {displayMoney(line.line_total)}</label>)}</div>
                </fieldset>
                <label className="block text-xs">New tab owner (optional)<select value={splitDraft.target_owner_staff_id} onChange={(event) => setSplitDraft((draft) => ({ ...draft, target_owner_staff_id: event.target.value }))} className="mt-1 w-full rounded bg-slate-800 p-2 text-sm"><option value="">Keep current owner</option>{activeStaff.map((staff) => <option key={String(staff.staff_id)} value={String(staff.staff_id)}>{String(staff.display_name)}</option>)}</select></label>
                <div className="grid gap-2 sm:grid-cols-2"><label className="text-xs">New table label<input maxLength={120} value={splitDraft.table_label} onChange={(event) => setSplitDraft((draft) => ({ ...draft, table_label: event.target.value }))} className="mt-1 w-full rounded bg-slate-800 p-2 text-sm" /></label><label className="text-xs">Note<input maxLength={1000} value={splitDraft.note} onChange={(event) => setSplitDraft((draft) => ({ ...draft, note: event.target.value }))} className="mt-1 w-full rounded bg-slate-800 p-2 text-sm" /></label></div>
                <label className="block text-xs">Reason<input maxLength={300} value={splitDraft.reason} onChange={(event) => setSplitDraft((draft) => ({ ...draft, reason: event.target.value }))} className="mt-1 w-full rounded bg-slate-800 p-2 text-sm" /></label>
                <label className="block text-xs">Different manager PIN<input type="password" inputMode="numeric" maxLength={12} autoComplete="off" value={splitDraft.pin} onChange={(event) => setSplitDraft((draft) => ({ ...draft, pin: event.target.value.replace(/\D/g, '') }))} className="mt-1 w-full rounded bg-slate-800 p-2 text-sm" /></label>
                <button disabled={blocked || !localReady || !shift || splitSelection.length === 0} className="w-full rounded border border-amber-600 p-2 text-sm font-semibold disabled:opacity-40">Approve and split tab</button>
              </form>
            </details>

            <details className="mt-3 rounded border border-slate-700 p-3">
              <summary className="cursor-pointer text-sm font-semibold">Merge this tab into another</summary>
              <form onSubmit={mergeTab} className="mt-2 space-y-2">
                <label className="block text-xs">Target tab<select value={mergeTargetId} onChange={(event) => setMergeTargetId(event.target.value)} className="mt-1 w-full rounded bg-slate-800 p-2 text-sm"><option value="">Select another open tab</option>{otherTabs.map((tab) => <option key={String(tab.tab_id)} value={String(tab.tab_id)}>{String(tab.table_label || 'Unlabelled tab')} - {displayMoney(tab.gross_total)}</option>)}</select></label>
                <label className="block text-xs">Reason<input maxLength={300} value={mergeDraft.reason} onChange={(event) => setMergeDraft((draft) => ({ ...draft, reason: event.target.value }))} className="mt-1 w-full rounded bg-slate-800 p-2 text-sm" /></label>
                <label className="block text-xs">Different manager PIN<input type="password" inputMode="numeric" maxLength={12} autoComplete="off" value={mergeDraft.pin} onChange={(event) => setMergeDraft((draft) => ({ ...draft, pin: event.target.value.replace(/\D/g, '') }))} className="mt-1 w-full rounded bg-slate-800 p-2 text-sm" /></label>
                <button disabled={blocked || !localReady || !shift || !mergeTargetId} className="w-full rounded border border-amber-600 p-2 text-sm font-semibold disabled:opacity-40">Approve and merge tab</button>
              </form>
            </details>
          </>}
          {actionError && <p role="alert" className="mt-3 rounded border border-red-700 bg-red-950/40 p-2 text-xs text-red-100">{actionError}</p>}
          <p className="mt-3 text-xs text-slate-400">The local authority reprices the tab, validates stock, customer credit and voucher liability, and records exact tender evidence. Version conflicts reject the whole operation; refresh and review the tab before retrying.</p>
        </div>}
      </aside>
    </section>
  )
}
