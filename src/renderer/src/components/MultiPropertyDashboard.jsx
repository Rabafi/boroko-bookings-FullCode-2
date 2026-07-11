import { useCallback, useEffect, useState } from 'react'
import { Building2, Plus, Pencil, Trash2, LayoutDashboard, BarChart3, DollarSign, RefreshCw, Users, BedDouble } from 'lucide-react'
import { Modal } from './shared/Modal'
import { ConfirmDialog } from './shared/ConfirmDialog'

function formatCurrency(amount, currency = 'P') {
  return `${currency}${Number(amount || 0).toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export default function MultiPropertyDashboard() {
  const [groups, setGroups] = useState([])
  const [selectedGroup, setSelectedGroup] = useState(null)
  const [dashboard, setDashboard] = useState(null)
  const [occupancyReport, setOccupancyReport] = useState(null)
  const [financialReport, setFinancialReport] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState({ name: '', description: '', central_office_address: '', central_office_contact: '' })
  const [saving, setSaving] = useState(false)
  const [confirmDialog, setConfirmDialog] = useState(null)
  const [reportRange, setReportRange] = useState({ start: new Date(new Date().getFullYear(), 0, 1).toISOString().split('T')[0], end: new Date().toISOString().split('T')[0] })
  const [showAddProperty, setShowAddProperty] = useState(false)
  const [addPropertyForm, setAddPropertyForm] = useState({ lodgeId: '', role: 'member' })

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const data = await window.api.multiProperty.getAllGroups()
      setGroups(Array.isArray(data) ? data : [])
    } catch (err) {
      setError(err?.message || 'Failed to load property groups')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])
  useEffect(() => { if (success) { const t = setTimeout(() => setSuccess(''), 3000); return () => clearTimeout(t) } }, [success])

  const selectGroup = async (group) => {
    setSelectedGroup(group)
    setLoading(true)
    setError('')
    try {
      const [dash, occ, fin] = await Promise.all([
        window.api.multiProperty.getConsolidatedDashboard(group.id),
        window.api.multiProperty.getConsolidatedOccupancy(group.id, reportRange.start, reportRange.end),
        window.api.multiProperty.getConsolidatedFinancial(group.id, reportRange.start, reportRange.end)
      ])
      setDashboard(dash)
      setOccupancyReport(occ)
      setFinancialReport(fin)
    } catch (err) {
      setError(err?.message || 'Failed to load dashboard')
    } finally {
      setLoading(false)
    }
  }

  const refreshReports = async () => {
    if (!selectedGroup) return
    setLoading(true)
    try {
      const [dash, occ, fin] = await Promise.all([
        window.api.multiProperty.getConsolidatedDashboard(selectedGroup.id),
        window.api.multiProperty.getConsolidatedOccupancy(selectedGroup.id, reportRange.start, reportRange.end),
        window.api.multiProperty.getConsolidatedFinancial(selectedGroup.id, reportRange.start, reportRange.end)
      ])
      setDashboard(dash)
      setOccupancyReport(occ)
      setFinancialReport(fin)
    } catch (err) { setError(err?.message) }
    setLoading(false)
  }

  const handleSave = async (e) => {
    e.preventDefault()
    if (!form.name.trim()) { setError('Name is required'); return }
    setSaving(true)
    setError('')
    try {
      if (editing) {
        await window.api.multiProperty.updateGroup(editing, form)
        setSuccess('Group updated')
      } else {
        await window.api.multiProperty.createGroup(form)
        setSuccess('Group created')
      }
      setShowForm(false)
      setEditing(null)
      setForm({ name: '', description: '', central_office_address: '', central_office_contact: '' })
      load()
    } catch (err) { setError(err?.message) }
    setSaving(false)
  }

  const handleDelete = (group) => {
    setConfirmDialog({
      title: 'Delete Property Group',
      message: `Delete "${group.name}"? This cannot be undone.`,
      onConfirm: async () => {
        try {
          await window.api.multiProperty.deleteGroup(group.id)
          setSuccess('Group deleted')
          if (selectedGroup?.id === group.id) { setSelectedGroup(null); setDashboard(null); setOccupancyReport(null); setFinancialReport(null) }
          load()
        } catch (err) { setError(err?.message) }
        setConfirmDialog(null)
      }
    })
  }

  const handleAddProperty = async (e) => {
    e.preventDefault()
    if (!addPropertyForm.lodgeId) { setError('Lodge ID is required'); return }
    setSaving(true)
    setError('')
    try {
      await window.api.multiProperty.addProperty(selectedGroup.id, addPropertyForm.lodgeId, addPropertyForm.role)
      setSuccess('Property added')
      setShowAddProperty(false)
      setAddPropertyForm({ lodgeId: '', role: 'member' })
      selectGroup(selectedGroup)
    } catch (err) { setError(err?.message) }
    setSaving(false)
  }

  return (
    <div className="p-4">
      {error && <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded text-red-700 text-sm">{error}</div>}
      {success && <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded text-green-700 text-sm">{success}</div>}

      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold flex items-center gap-2"><Building2 className="w-5 h-5" /> Multi-Property Dashboard</h2>
        <button onClick={() => { setEditing(null); setForm({ name: '', description: '', central_office_address: '', central_office_contact: '' }); setError(''); setShowForm(true) }} className="px-3 py-1.5 bg-blue-600 text-white rounded text-sm hover:bg-blue-700"><Plus className="w-4 h-4 inline mr-1" />New Group</button>
      </div>

      <div className="grid grid-cols-4 gap-4">
        <div className="col-span-1 bg-white border rounded p-3">
          <div className="font-semibold text-sm mb-2">Property Groups</div>
          {groups.length === 0 ? (
            <div className="text-gray-400 text-xs p-2">No groups created</div>
          ) : (
            <div className="space-y-1">
              {groups.map(g => (
                <div key={g.id} className={`p-2 rounded cursor-pointer text-sm flex items-center justify-between ${selectedGroup?.id === g.id ? 'bg-blue-50 border border-blue-200' : 'hover:bg-gray-50'}`}
                  onClick={() => selectGroup(g)}>
                  <span>{g.name}</span>
                  <div className="flex gap-1">
                    <button onClick={(e) => { e.stopPropagation(); setEditing(g.id); setForm({ name: g.name, description: g.description || '', central_office_address: g.central_office_address || '', central_office_contact: g.central_office_contact || '' }); setError(''); setShowForm(true) }} className="p-1 text-gray-400 hover:text-blue-600"><Pencil className="w-3 h-3" /></button>
                    <button onClick={(e) => { e.stopPropagation(); handleDelete(g) }} className="p-1 text-gray-400 hover:text-red-600"><Trash2 className="w-3 h-3" /></button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="col-span-3">
          {!selectedGroup ? (
            <div className="bg-white border rounded p-8 text-center text-gray-400 text-sm">
              <Building2 className="w-12 h-12 mx-auto mb-2 opacity-30" />
              Select a property group to view consolidated data
            </div>
          ) : loading ? (
            <div className="flex items-center justify-center p-8"><RefreshCw className="animate-spin w-6 h-6 text-gray-400" /></div>
          ) : (
            <div>
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-semibold text-base">{selectedGroup.name} - Consolidated View</h3>
                <div className="flex items-center gap-2">
                  {dashboard && !dashboard.success === false && (
                    <span className="text-xs text-gray-500">{dashboard.property_count || 0} properties</span>
                  )}
                  <button onClick={() => { setShowAddProperty(true); setError('') }} className="px-2 py-1 text-xs border rounded hover:bg-gray-50"><Plus className="w-3 h-3 inline mr-1" />Add Property</button>
                  <button onClick={refreshReports} className="px-2 py-1 text-xs border rounded hover:bg-gray-50"><RefreshCw className="w-3 h-3 inline mr-1" />Refresh</button>
                </div>
              </div>

              {dashboard && dashboard.success !== false && (
                <div className="grid grid-cols-4 gap-3 mb-4">
                  <div className="p-3 bg-white border rounded"><div className="text-xs text-gray-500">Total Bookings</div><div className="text-lg font-semibold">{dashboard.total_bookings || 0}</div></div>
                  <div className="p-3 bg-white border rounded"><div className="text-xs text-gray-500">Total Revenue</div><div className="text-lg font-semibold">{formatCurrency(dashboard.total_revenue)}</div></div>
                  <div className="p-3 bg-white border rounded"><div className="text-xs text-gray-500">Occupancy</div><div className="text-lg font-semibold">{dashboard.occupancy_pct || 0}%</div></div>
                  <div className="p-3 bg-white border rounded"><div className="text-xs text-gray-500">ADR / RevPAR</div><div className="text-lg font-semibold">{formatCurrency(dashboard.adr)} / {formatCurrency(dashboard.revpar)}</div></div>
                </div>
              )}

              {dashboard && dashboard.properties && dashboard.properties.length > 0 && (
                <div className="bg-white border rounded mb-4">
                  <div className="p-3 border-b font-semibold text-sm">Properties</div>
                  <table className="w-full text-sm">
                    <thead><tr className="border-b bg-gray-50">{['Lodge ID', 'Role', 'Central Office'].map(h => <th key={h} className="text-left p-2 font-medium">{h}</th>)}</tr></thead>
                    <tbody>
                      {dashboard.properties.map((p, i) => (
                        <tr key={i} className="border-b hover:bg-gray-50">
                          <td className="p-2 font-mono text-xs">{p.lodge_id}</td>
                          <td className="p-2"><span className={`px-2 py-0.5 rounded text-xs ${p.role_in_group === 'head_office' ? 'bg-purple-100 text-purple-700' : 'bg-gray-100 text-gray-700'}`}>{p.role_in_group}</span></td>
                          <td className="p-2">{p.is_central_office ? 'Yes' : 'No'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              <div className="flex gap-2 mb-3">
                <input type="date" value={reportRange.start} onChange={e => setReportRange(r => ({ ...r, start: e.target.value }))} className="border rounded px-2 py-1 text-sm" />
                <input type="date" value={reportRange.end} onChange={e => setReportRange(r => ({ ...r, end: e.target.value }))} className="border rounded px-2 py-1 text-sm" />
              </div>

              {occupancyReport && occupancyReport.properties && occupancyReport.properties.length > 0 && (
                <div className="bg-white border rounded mb-4">
                  <div className="p-3 border-b font-semibold text-sm">Occupancy by Property</div>
                  <table className="w-full text-sm">
                    <thead><tr className="border-b bg-gray-50">{['Property', 'Total Rooms', 'Booked Rooms', 'Occupancy %'].map(h => <th key={h} className="text-left p-2 font-medium">{h}</th>)}</tr></thead>
                    <tbody>
                      {occupancyReport.properties.map((p, i) => (
                        <tr key={i} className="border-b hover:bg-gray-50">
                          <td className="p-2 font-mono text-xs">{p.lodge_id}</td>
                          <td className="p-2">{p.total_rooms}</td>
                          <td className="p-2">{p.booked_rooms}</td>
                          <td className="p-2">{p.occupancy_pct}%</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {financialReport && financialReport.properties && financialReport.properties.length > 0 && (
                <div className="bg-white border rounded">
                  <div className="p-3 border-b font-semibold text-sm">Financial Summary by Property</div>
                  <table className="w-full text-sm">
                    <thead><tr className="border-b bg-gray-50">{['Property', 'Revenue', 'Expenses', 'Net Profit'].map(h => <th key={h} className="text-left p-2 font-medium">{h}</th>)}</tr></thead>
                    <tbody>
                      {financialReport.properties.map((p, i) => (
                        <tr key={i} className="border-b hover:bg-gray-50">
                          <td className="p-2 font-mono text-xs">{p.lodge_id}</td>
                          <td className="p-2">{formatCurrency(p.total_revenue)}</td>
                          <td className="p-2">{formatCurrency(p.total_expenses)}</td>
                          <td className={`p-2 font-semibold ${(p.net_profit || 0) >= 0 ? 'text-green-600' : 'text-red-600'}`}>{formatCurrency(p.net_profit)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {showForm && (
        <Modal title={editing ? 'Edit Property Group' : 'New Property Group'} onClose={() => setShowForm(false)}>
          <form onSubmit={handleSave} className="space-y-3 p-4">
            <div><label className="block text-sm font-medium mb-1">Name *</label><input type="text" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} className="w-full border rounded px-3 py-2 text-sm" required /></div>
            <div><label className="block text-sm font-medium mb-1">Description</label><textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} className="w-full border rounded px-3 py-2 text-sm" rows={2} /></div>
            <div><label className="block text-sm font-medium mb-1">Central Office Address</label><input type="text" value={form.central_office_address} onChange={e => setForm(f => ({ ...f, central_office_address: e.target.value }))} className="w-full border rounded px-3 py-2 text-sm" /></div>
            <div><label className="block text-sm font-medium mb-1">Central Office Contact</label><input type="text" value={form.central_office_contact} onChange={e => setForm(f => ({ ...f, central_office_contact: e.target.value }))} className="w-full border rounded px-3 py-2 text-sm" /></div>
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => setShowForm(false)} className="px-4 py-2 border rounded text-sm">Cancel</button>
              <button type="submit" disabled={saving} className="px-4 py-2 bg-blue-600 text-white rounded text-sm hover:bg-blue-700 disabled:opacity-50">{saving ? 'Saving...' : editing ? 'Update' : 'Create'}</button>
            </div>
          </form>
        </Modal>
      )}

      {showAddProperty && (
        <Modal title="Add Property to Group" onClose={() => setShowAddProperty(false)}>
          <form onSubmit={handleAddProperty} className="space-y-3 p-4">
            <div><label className="block text-sm font-medium mb-1">Lodge ID *</label><input type="text" value={addPropertyForm.lodgeId} onChange={e => setAddPropertyForm(f => ({ ...f, lodgeId: e.target.value }))} className="w-full border rounded px-3 py-2 text-sm" required /></div>
            <div><label className="block text-sm font-medium mb-1">Role</label><select value={addPropertyForm.role} onChange={e => setAddPropertyForm(f => ({ ...f, role: e.target.value }))} className="w-full border rounded px-3 py-2 text-sm">{['member', 'head_office'].map(r => <option key={r} value={r}>{r.replace('_', ' ')}</option>)}</select></div>
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => setShowAddProperty(false)} className="px-4 py-2 border rounded text-sm">Cancel</button>
              <button type="submit" disabled={saving} className="px-4 py-2 bg-blue-600 text-white rounded text-sm hover:bg-blue-700 disabled:opacity-50">{saving ? 'Adding...' : 'Add Property'}</button>
            </div>
          </form>
        </Modal>
      )}

      {confirmDialog && <ConfirmDialog {...confirmDialog} onCancel={() => setConfirmDialog(null)} />}
    </div>
  )
}
