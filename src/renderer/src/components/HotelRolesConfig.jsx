import { useCallback, useEffect, useState } from 'react'
import { RefreshCw, Check, Search, Briefcase, Users, Shield } from 'lucide-react'

export default function HotelRolesConfig() {
  const [templates, setTemplates] = useState([])
  const [selectedRole, setSelectedRole] = useState(null)
  const [capabilities, setCapabilities] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [searchTerm, setSearchTerm] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const data = await window.api.hotelRoles.getTemplates()
      setTemplates(Array.isArray(data) ? data : [])
    } catch (err) {
      setError(err?.message || 'Failed to load role templates')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const handleSelectRole = async (roleKey) => {
    setSelectedRole(roleKey)
    try {
      const caps = await window.api.hotelRoles.getRoleCapabilities(roleKey)
      setCapabilities(Array.isArray(caps) ? caps : [])
    } catch {
      setCapabilities([])
    }
  }

  const CATEGORIES = [
    { key: 'front_office', label: 'Front Office', icon: 'Front Desk' },
    { key: 'housekeeping', label: 'Housekeeping', icon: 'Cleaning' },
    { key: 'maintenance', label: 'Maintenance', icon: 'Wrench' },
    { key: 'finance', label: 'Finance', icon: 'Finance' },
    { key: 'revenue', label: 'Revenue', icon: 'Revenue' },
    { key: 'sales', label: 'Sales', icon: 'Sales' },
    { key: 'management', label: 'Management', icon: 'Management' }
  ]

  const getCategoryIcon = (cat) => {
    const icons = { front_office: '🛎️', housekeeping: '🧹', maintenance: '🔧', finance: '💰', revenue: '📊', sales: '🤝', management: '👔' }
    return icons[cat] || '📋'
  }

  const filteredTemplates = searchTerm
    ? templates.filter(t => t.role_name?.toLowerCase().includes(searchTerm.toLowerCase()) || t.role_key?.toLowerCase().includes(searchTerm.toLowerCase()))
    : templates

  const groupedByCategory = CATEGORIES.map(cat => ({
    ...cat,
    roles: filteredTemplates.filter(t => t.category === cat.key)
  })).filter(g => g.roles.length > 0)

  if (loading) return <div className="flex items-center justify-center h-64"><RefreshCw className="animate-spin w-6 h-6 text-gray-400" /></div>

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Hotel Role Templates</h1>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input value={searchTerm} onChange={e => setSearchTerm(e.target.value)} className="pl-9 pr-4 py-2 border rounded-lg text-sm w-64" placeholder="Search roles..." />
        </div>
      </div>

      {error && <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">{error}</div>}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          {groupedByCategory.map(group => (
            <div key={group.key} className="bg-white rounded-xl border">
              <div className="p-4 border-b flex items-center gap-2">
                <span className="text-lg">{getCategoryIcon(group.key)}</span>
                <h3 className="font-semibold">{group.label}</h3>
                <span className="text-xs text-gray-400 ml-auto">{group.roles.length} role(s)</span>
              </div>
              <div className="p-4 space-y-2">
                {group.roles.map(role => (
                  <button key={role.id} onClick={() => handleSelectRole(role.role_key)}
                    className={`w-full text-left p-3 rounded-lg border transition-colors ${selectedRole === role.role_key ? 'border-blue-500 bg-blue-50' : 'hover:bg-gray-50'}`}>
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="font-medium">{role.role_name}</div>
                        <div className="text-xs text-gray-500">{role.role_key}</div>
                      </div>
                      {selectedRole === role.role_key && <Check className="w-4 h-4 text-blue-600" />}
                    </div>
                    {role.description && <div className="text-xs text-gray-500 mt-1">{role.description}</div>}
                    {role.is_system_role && <span className="mt-1 inline-block px-1.5 py-0.5 bg-purple-100 text-purple-700 rounded text-xs">System Role</span>}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="bg-white rounded-xl border p-4">
          <h3 className="font-semibold mb-3 flex items-center gap-2"><Shield className="w-4 h-4" />Capabilities</h3>
          {selectedRole ? (
            <>
              <div className="text-sm font-medium text-gray-600 mb-2">{templates.find(t => t.role_key === selectedRole)?.role_name}</div>
              {capabilities.length === 0 ? (
                <div className="text-gray-400 text-sm">No capabilities defined</div>
              ) : (
                <div className="space-y-1 max-h-96 overflow-y-auto">
                  {capabilities.map((cap, i) => (
                    <div key={i} className="flex items-center gap-2 p-1.5 text-sm hover:bg-gray-50 rounded">
                      <Check className="w-3.5 h-3.5 text-green-600 flex-shrink-0" />
                      <span className="font-mono text-xs">{cap}</span>
                    </div>
                  ))}
                </div>
              )}
            </>
          ) : (
            <div className="text-gray-400 text-sm">Select a role template to view its capabilities</div>
          )}
          <div className="mt-4 pt-3 border-t">
            <h4 className="text-sm font-medium mb-2">Suggested Assignment</h4>
            {selectedRole ? (
              <div className="text-xs text-gray-500">
                Assign this role template to staff with the <strong>{templates.find(t => t.role_key === selectedRole)?.role_name}</strong> position.
                Capabilities will be automatically applied.
              </div>
            ) : (
              <div className="text-xs text-gray-400">Select a role to see assignment suggestions</div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
