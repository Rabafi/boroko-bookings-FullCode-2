import { useCallback, useEffect, useState } from 'react'
import { Building2, ChevronDown, Check } from 'lucide-react'

export default function PropertySwitcher({ currentLodgeId, onSwitch }) {
  const [groups, setGroups] = useState([])
  const [open, setOpen] = useState(false)
  const [properties, setProperties] = useState([])
  const [selectedGroup, setSelectedGroup] = useState(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      if (window.api.multiProperty?.getAllGroups) {
        const groupData = await window.api.multiProperty.getAllGroups()
        const gs = Array.isArray(groupData) ? groupData : []
        setGroups(gs)
        if (gs.length > 0) {
          setSelectedGroup(gs[0])
          const props = await window.api.multiProperty.getProperties(gs[0].id)
          setProperties(props?.properties || [])
        }
      }
    } catch (_) {
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const handleSelect = async (lodgeId) => {
    setOpen(false)
    try {
      if (window.api.multiProperty?.switchProperty) {
        await window.api.multiProperty.switchProperty(lodgeId)
      }
      if (onSwitch) onSwitch(lodgeId)
    } catch (_) {}
  }

  if (loading || groups.length === 0 || properties.length === 0) return null

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 px-3 py-2 text-sm border rounded hover:bg-gray-50 w-full"
      >
        <Building2 className="w-4 h-4 text-gray-500" />
        <span className="flex-1 text-left truncate">
          {properties.find(p => p.lodge_id === currentLodgeId)?.lodge_id || 'Select Property'}
        </span>
        <ChevronDown className="w-3 h-3 text-gray-400" />
      </button>

      {open && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-white border rounded shadow-lg z-50 max-h-60 overflow-y-auto">
          <div className="p-2 border-b text-xs text-gray-500 font-medium">{selectedGroup?.name || 'Properties'}</div>
          {properties.map((p, i) => (
            <button
              key={i}
              onClick={() => handleSelect(p.lodge_id)}
              className={`w-full text-left px-3 py-2 text-sm hover:bg-blue-50 flex items-center justify-between ${p.lodge_id === currentLodgeId ? 'bg-blue-50 text-blue-700' : ''}`}
            >
              <span className="font-mono text-xs">{p.lodge_id}</span>
              <div className="flex items-center gap-2">
                <span className={`text-xs px-1.5 py-0.5 rounded ${p.role_in_group === 'head_office' ? 'bg-purple-100 text-purple-700' : 'bg-gray-100 text-gray-600'}`}>
                  {p.role_in_group === 'head_office' ? 'HQ' : 'Member'}
                </span>
                {p.lodge_id === currentLodgeId && <Check className="w-3 h-3 text-blue-600" />}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
