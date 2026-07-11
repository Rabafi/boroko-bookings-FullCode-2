import { useCallback, useEffect, useState } from 'react'
import { Plus, Pencil, Trash2, RefreshCw, Settings, Check, X, AlertTriangle, ExternalLink } from 'lucide-react'
import { Modal } from './shared/Modal'
import { ConfirmDialog } from './shared/ConfirmDialog'

const emptyMapping = { channel_key: '', source_type: 'room_type', local_id: '', channel_code: '', channel_name: '' }
const emptyConfig = { channel_key: '', channel_label: '', enabled: true, sync_availability: true, sync_rates: false, import_reservations: false }

export default function ChannelManager() {
  const [dashboard, setDashboard] = useState({ channels: [], pending_sync_items: [], pending_imports: [] })
  const [mappings, setMappings] = useState([])
  const [roomTypes, setRoomTypes] = useState([])
  const [ratePlans, setRatePlans] = useState([])
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState('dashboard')
  const [showMappingModal, setShowMappingModal] = useState(false)
  const [showConfigModal, setShowConfigModal] = useState(false)
  const [editingMapping, setEditingMapping] = useState(null)
  const [editingConfig, setEditingConfig] = useState(null)
  const [mappingForm, setMappingForm] = useState(emptyMapping)
  const [configForm, setConfigForm] = useState(emptyConfig)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [saving, setSaving] = useState(false)
  const [processing, setProcessing] = useState(false)
  const [confirmDialog, setConfirmDialog] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [dash, rtData, rpData] = await Promise.all([
        window.api.channelManager.getDashboard().catch(() => ({ channels: [], pending_sync_items: [], pending_imports: [] })),
        window.api.roomTypes.getAll().catch(() => []),
        window.api.ratePlans.getAll().catch(() => [])
      ])
      setDashboard(dash)
      setRoomTypes(Array.isArray(rtData) ? rtData : [])
      setRatePlans(Array.isArray(rpData) ? rpData : [])
    } catch (err) {
      setError(err?.message || 'Failed to load channel manager')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    if (!success) return
    const timer = setTimeout(() => setSuccess(''), 3000)
    return () => clearTimeout(timer)
  }, [success])

  const handleProcessSync = async () => {
    setProcessing(true)
    setError('')
    try {
      const result = await window.api.channelManager.processSyncQueue()
      setSuccess(`Processed ${result?.processed || 0} sync items`)
      load()
    } catch (err) {
      setError(err?.message || 'Failed to process sync queue')
    } finally {
      setProcessing(false)
    }
  }

  const handleConfirmImport = async (importId) => {
    try {
      await window.api.channelManager.confirmImport(importId)
      setSuccess('Import confirmed')
      load()
    } catch (err) {
      setError(err?.message || 'Failed to confirm import')
    }
  }

  const handleRejectImport = async (importId) => {
    try {
      await window.api.channelManager.rejectImport(importId, 'Rejected by user')
      setSuccess('Import rejected')
      load()
    } catch (err) {
      setError(err?.message || 'Failed to reject import')
    }
  }

  const openAddMapping = () => { setEditingMapping(null); setMappingForm(emptyMapping); setError(''); setShowMappingModal(true) }
  const openEditMapping = (m) => {
    setEditingMapping(m.id)
    setMappingForm({
      channel_key: m.channel_key || '',
      source_type: m.source_type || 'room_type',
      local_id: m.local_id || '',
      channel_code: m.channel_code || '',
      channel_name: m.channel_name || ''
    })
    setError('')
    setShowMappingModal(true)
  }

  const handleSaveMapping = async (e) => {
    e.preventDefault()
    if (!mappingForm.channel_key || !mappingForm.local_id) { setError('Channel key and local entity are required'); return }
    setSaving(true)
    setError('')
    try {
      if (editingMapping) {
        await window.api.channelManager.updateMapping(editingMapping, mappingForm.channel_code, mappingForm.channel_name)
      } else {
        await window.api.channelManager.createMapping(mappingForm.channel_key, mappingForm.source_type, mappingForm.local_id, mappingForm.channel_code, mappingForm.channel_name)
      }
      setShowMappingModal(false)
      setSuccess(editingMapping ? 'Mapping updated' : 'Mapping created')
      load()
    } catch (err) {
      setError(err?.message || 'Failed to save mapping')
    } finally {
      setSaving(false)
    }
  }

  const handleDeleteMapping = (mappingId) => {
    setConfirmDialog({
      message: 'Delete this mapping?',
      onConfirm: async () => {
        try {
          await window.api.channelManager.deleteMapping(mappingId)
          setSuccess('Mapping deleted')
          load()
        } catch (err) {
          setError(err?.message || 'Failed to delete mapping')
        }
        setConfirmDialog(null)
      }
    })
  }

  const openAddConfig = () => { setEditingConfig(null); setConfigForm(emptyConfig); setError(''); setShowConfigModal(true) }
  const openEditConfig = (c) => {
    setEditingConfig(c.id)
    setConfigForm({
      channel_key: c.channel_key || '',
      channel_label: c.channel_label || '',
      enabled: c.enabled !== false,
      sync_availability: c.sync_availability !== false,
      sync_rates: c.sync_rates === true,
      import_reservations: c.import_reservations === true
    })
    setError('')
    setShowConfigModal(true)
  }

  const handleSaveConfig = async (e) => {
    e.preventDefault()
    if (!configForm.channel_key) { setError('Channel key is required'); return }
    setSaving(true)
    setError('')
    try {
      if (editingConfig) {
        await window.api.channelManager.updateConfig(editingConfig, configForm)
      } else {
        await window.api.channelManager.createConfig(configForm.channel_key, configForm.channel_label, configForm.enabled, configForm.sync_availability, configForm.sync_rates, configForm.import_reservations)
      }
      setShowConfigModal(false)
      setSuccess(editingConfig ? 'Config updated' : 'Config created')
      load()
    } catch (err) {
      setError(err?.message || 'Failed to save config')
    } finally {
      setSaving(false)
    }
  }

  const handleToggleChannel = async (channelKey, enabled) => {
    try {
      if (enabled) {
        await window.api.channelManager.enableChannel(channelKey)
      } else {
        await window.api.channelManager.disableChannel(channelKey)
      }
      setSuccess(`Channel ${enabled ? 'enabled' : 'disabled'}`)
      load()
    } catch (err) {
      setError(err?.message || 'Failed to toggle channel')
    }
  }

  const TabButton = ({ tab, label }) => (
    <button onClick={() => setActiveTab(tab)} className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${activeTab === tab ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}>
      {label}
    </button>
  )

  if (loading) return <div className="flex items-center justify-center h-64"><RefreshCw className="animate-spin w-6 h-6 text-gray-400" /></div>

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Channel Manager</h1>
        <div className="flex gap-2">
          <TabButton tab="dashboard" label="Dashboard" />
          <TabButton tab="mappings" label="Mappings" />
          <TabButton tab="configs" label="Channel Config" />
          <TabButton tab="imports" label="Imports" />
        </div>
      </div>

      {error && <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg flex items-center gap-2 text-red-700"><AlertTriangle className="w-4 h-4" />{error}</div>}
      {success && <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded-lg flex items-center gap-2 text-green-700"><Check className="w-4 h-4" />{success}</div>}

      {activeTab === 'dashboard' && (
        <div className="space-y-6">
          <div className="grid grid-cols-3 gap-4">
            <div className="bg-white rounded-xl p-4 border">
              <div className="text-sm text-gray-500">Active Channels</div>
              <div className="text-2xl font-bold">{Array.isArray(dashboard.channels) ? dashboard.channels.filter(c => c.enabled).length : 0}</div>
            </div>
            <div className="bg-white rounded-xl p-4 border">
              <div className="text-sm text-gray-500">Pending Sync Items</div>
              <div className="text-2xl font-bold">{Array.isArray(dashboard.pending_sync_items) ? dashboard.pending_sync_items.length : 0}</div>
            </div>
            <div className="bg-white rounded-xl p-4 border">
              <div className="text-sm text-gray-500">Pending Imports</div>
              <div className="text-2xl font-bold">{Array.isArray(dashboard.pending_imports) ? dashboard.pending_imports.length : 0}</div>
            </div>
          </div>

          <div className="bg-white rounded-xl border">
            <div className="p-4 border-b flex items-center justify-between">
              <h3 className="font-semibold">Sync Queue</h3>
              <button onClick={handleProcessSync} disabled={processing} className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 disabled:opacity-50 flex items-center gap-1">
                <RefreshCw className={`w-4 h-4 ${processing ? 'animate-spin' : ''}`} />
                Process Queue
              </button>
            </div>
            <div className="p-4">
              {(!Array.isArray(dashboard.pending_sync_items) || dashboard.pending_sync_items.length === 0) ? (
                <div className="text-gray-500 text-sm">No pending sync items</div>
              ) : (
                <table className="w-full text-sm">
                  <thead><tr className="text-left text-gray-500"><th className="pb-2">Channel</th><th className="pb-2">Type</th><th className="pb-2">Status</th><th className="pb-2">Created</th></tr></thead>
                  <tbody>
                    {dashboard.pending_sync_items.map(item => (
                      <tr key={item.id} className="border-t"><td className="py-2">{item.channel_key}</td><td>{item.sync_type}</td><td><span className="px-2 py-0.5 bg-yellow-100 text-yellow-800 rounded text-xs">{item.status}</span></td><td className="text-gray-500">{new Date(item.created_at).toLocaleString()}</td></tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}

      {activeTab === 'mappings' && (
        <div className="bg-white rounded-xl border">
          <div className="p-4 border-b flex items-center justify-between">
            <h3 className="font-semibold">Channel Mappings</h3>
            <button onClick={openAddMapping} className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 flex items-center gap-1"><Plus className="w-4 h-4" />Add Mapping</button>
          </div>
          <div className="p-4">
            {mappings.length === 0 ? (
              <div className="text-gray-500 text-sm">No mappings configured</div>
            ) : (
              <table className="w-full text-sm">
                <thead><tr className="text-left text-gray-500"><th className="pb-2">Channel</th><th className="pb-2">Type</th><th className="pb-2">Local Entity</th><th className="pb-2">Channel Code</th><th className="pb-2">Channel Name</th><th className="pb-2">Actions</th></tr></thead>
                <tbody>
                  {mappings.map(m => (
                    <tr key={m.id} className="border-t"><td className="py-2">{m.channel_key}</td><td>{m.source_type}</td><td>{m.local_id}</td><td>{m.channel_code}</td><td>{m.channel_name}</td>
                      <td className="flex gap-1">
                        <button onClick={() => openEditMapping(m)} className="p-1 hover:bg-gray-100 rounded"><Pencil className="w-4 h-4" /></button>
                        <button onClick={() => handleDeleteMapping(m.id)} className="p-1 hover:bg-red-100 rounded text-red-600"><Trash2 className="w-4 h-4" /></button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {activeTab === 'configs' && (
        <div className="bg-white rounded-xl border">
          <div className="p-4 border-b flex items-center justify-between">
            <h3 className="font-semibold">Channel Configurations</h3>
            <button onClick={openAddConfig} className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 flex items-center gap-1"><Plus className="w-4 h-4" />Add Channel</button>
          </div>
          <div className="p-4">
            {(!Array.isArray(dashboard.channels) || dashboard.channels.length === 0) ? (
              <div className="text-gray-500 text-sm">No channel configs</div>
            ) : (
              <table className="w-full text-sm">
                <thead><tr className="text-left text-gray-500"><th className="pb-2">Channel</th><th className="pb-2">Label</th><th className="pb-2">Status</th><th className="pb-2">Sync Avail</th><th className="pb-2">Sync Rates</th><th className="pb-2">Import Res</th><th className="pb-2">Actions</th></tr></thead>
                <tbody>
                  {dashboard.channels.map(c => (
                    <tr key={c.id} className="border-t">
                      <td className="py-2 font-medium">{c.channel_key}</td>
                      <td>{c.channel_label}</td>
                      <td><span className={`px-2 py-0.5 rounded text-xs ${c.enabled ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-600'}`}>{c.enabled ? 'Enabled' : 'Disabled'}</span></td>
                      <td>{c.sync_availability ? <Check className="w-4 h-4 text-green-600" /> : <X className="w-4 h-4 text-gray-400" />}</td>
                      <td>{c.sync_rates ? <Check className="w-4 h-4 text-green-600" /> : <X className="w-4 h-4 text-gray-400" />}</td>
                      <td>{c.import_reservations ? <Check className="w-4 h-4 text-green-600" /> : <X className="w-4 h-4 text-gray-400" />}</td>
                      <td className="flex gap-1">
                        <button onClick={() => openEditConfig(c)} className="p-1 hover:bg-gray-100 rounded"><Pencil className="w-4 h-4" /></button>
                        <button onClick={() => handleToggleChannel(c.channel_key, !c.enabled)} className={`p-1 rounded ${c.enabled ? 'hover:bg-red-100 text-red-600' : 'hover:bg-green-100 text-green-600'}`}>
                          {c.enabled ? <X className="w-4 h-4" /> : <Check className="w-4 h-4" />}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {activeTab === 'imports' && (
        <div className="bg-white rounded-xl border">
          <div className="p-4 border-b">
            <h3 className="font-semibold">Reservation Imports</h3>
          </div>
          <div className="p-4">
            {(!Array.isArray(dashboard.pending_imports) || dashboard.pending_imports.length === 0) ? (
              <div className="text-gray-500 text-sm">No pending imports</div>
            ) : (
              <table className="w-full text-sm">
                <thead><tr className="text-left text-gray-500"><th className="pb-2">Guest</th><th className="pb-2">Channel</th><th className="pb-2">Check In</th><th className="pb-2">Check Out</th><th className="pb-2">Amount</th><th className="pb-2">Status</th><th className="pb-2">Actions</th></tr></thead>
                <tbody>
                  {dashboard.pending_imports.map(imp => (
                    <tr key={imp.id} className="border-t">
                      <td className="py-2">{imp.guest_name || 'Unknown'}</td>
                      <td>{imp.channel_key}</td>
                      <td>{imp.check_in}</td>
                      <td>{imp.check_out}</td>
                      <td>{imp.rate_amount ? `P${Number(imp.rate_amount).toFixed(2)}` : '-'}</td>
                      <td><span className={`px-2 py-0.5 rounded text-xs ${imp.status === 'pending' ? 'bg-yellow-100 text-yellow-800' : 'bg-green-100 text-green-800'}`}>{imp.status}</span></td>
                      <td className="flex gap-1">
                        <button onClick={() => handleConfirmImport(imp.id)} className="px-2 py-1 bg-green-600 text-white rounded text-xs hover:bg-green-700"><Check className="w-3 h-3" /></button>
                        <button onClick={() => handleRejectImport(imp.id)} className="px-2 py-1 bg-red-600 text-white rounded text-xs hover:bg-red-700"><X className="w-3 h-3" /></button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {showMappingModal && (
        <Modal title={editingMapping ? 'Edit Mapping' : 'Add Mapping'} onClose={() => setShowMappingModal(false)}>
          <form onSubmit={handleSaveMapping} className="space-y-4">
            <div><label className="block text-sm font-medium mb-1">Channel Key</label>
              <input value={mappingForm.channel_key} onChange={e => setMappingForm({ ...mappingForm, channel_key: e.target.value })} className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="bookingcom" required /></div>
            <div><label className="block text-sm font-medium mb-1">Source Type</label>
              <select value={mappingForm.source_type} onChange={e => setMappingForm({ ...mappingForm, source_type: e.target.value })} className="w-full border rounded-lg px-3 py-2 text-sm">
                <option value="room_type">Room Type</option>
                <option value="rate_plan">Rate Plan</option>
              </select></div>
            <div><label className="block text-sm font-medium mb-1">Local Entity</label>
              <select value={mappingForm.local_id} onChange={e => setMappingForm({ ...mappingForm, local_id: e.target.value })} className="w-full border rounded-lg px-3 py-2 text-sm" required>
                <option value="">Select...</option>
                {mappingForm.source_type === 'room_type' ? roomTypes.map(rt => <option key={rt.id} value={rt.id}>{rt.name}</option>) : ratePlans.map(rp => <option key={rp.id} value={rp.id}>{rp.name}</option>)}
              </select></div>
            <div><label className="block text-sm font-medium mb-1">Channel Code</label>
              <input value={mappingForm.channel_code} onChange={e => setMappingForm({ ...mappingForm, channel_code: e.target.value })} className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="DBL_STD" /></div>
            <div><label className="block text-sm font-medium mb-1">Channel Name</label>
              <input value={mappingForm.channel_name} onChange={e => setMappingForm({ ...mappingForm, channel_name: e.target.value })} className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="Double Standard" /></div>
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => setShowMappingModal(false)} className="px-4 py-2 text-sm border rounded-lg hover:bg-gray-50">Cancel</button>
              <button type="submit" disabled={saving} className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50">{saving ? 'Saving...' : 'Save'}</button>
            </div>
          </form>
        </Modal>
      )}

      {showConfigModal && (
        <Modal title={editingConfig ? 'Edit Channel Config' : 'Add Channel Config'} onClose={() => setShowConfigModal(false)}>
          <form onSubmit={handleSaveConfig} className="space-y-4">
            <div><label className="block text-sm font-medium mb-1">Channel Key</label>
              <input value={configForm.channel_key} onChange={e => setConfigForm({ ...configForm, channel_key: e.target.value })} className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="bookingcom" required /></div>
            <div><label className="block text-sm font-medium mb-1">Label</label>
              <input value={configForm.channel_label} onChange={e => setConfigForm({ ...configForm, channel_label: e.target.value })} className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="Booking.com" /></div>
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-2"><input type="checkbox" checked={configForm.sync_availability} onChange={e => setConfigForm({ ...configForm, sync_availability: e.target.checked })} className="rounded" /> Sync Availability</label>
              <label className="flex items-center gap-2"><input type="checkbox" checked={configForm.sync_rates} onChange={e => setConfigForm({ ...configForm, sync_rates: e.target.checked })} className="rounded" /> Sync Rates</label>
              <label className="flex items-center gap-2"><input type="checkbox" checked={configForm.import_reservations} onChange={e => setConfigForm({ ...configForm, import_reservations: e.target.checked })} className="rounded" /> Import Reservations</label>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => setShowConfigModal(false)} className="px-4 py-2 text-sm border rounded-lg hover:bg-gray-50">Cancel</button>
              <button type="submit" disabled={saving} className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50">{saving ? 'Saving...' : 'Save'}</button>
            </div>
          </form>
        </Modal>
      )}

      {confirmDialog && <ConfirmDialog {...confirmDialog} onCancel={() => setConfirmDialog(null)} />}
    </div>
  )
}
