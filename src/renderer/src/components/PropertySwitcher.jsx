import { useCallback, useEffect, useState } from 'react'
import { Building2, ChevronDown, Check, AlertTriangle } from 'lucide-react'

export default function PropertySwitcher({ currentLodgeId, onSwitch }) {
  const [groups, setGroups] = useState([])
  const [open, setOpen] = useState(false)
  const [properties, setProperties] = useState([])
  const [selectedGroup, setSelectedGroup] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [switching, setSwitching] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      if (window.api.multiProperty?.getAllGroups) {
        const groupData = await window.api.multiProperty.getAllGroups()
        const gs = Array.isArray(groupData) ? groupData : []
        setGroups(gs)
        if (gs.length > 0) {
          setSelectedGroup(gs[0])
          const props = await window.api.multiProperty.getProperties(gs[0].id)
          setProperties(props?.properties || (Array.isArray(props) ? props : []))
        }
      }
    } catch (err) {
      setError(err?.message || 'Could not load property groups')
      setGroups([])
      setProperties([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const handleSelect = async (lodgeId) => {
    if (switching) return
    setOpen(false)
    setError('')
    setSwitching(true)
    try {
      if (window.api.multiProperty?.switchProperty) {
        const result = await window.api.multiProperty.switchProperty(lodgeId)
        if (result?.success === false) {
          throw new Error(result?.error || 'Property switch was rejected. Active property was not changed.')
        }
      }
      if (onSwitch) onSwitch(lodgeId)
    } catch (err) {
      // Fail closed: do not call onSwitch when the server rejects the switch.
      setError(
        err?.message
        || 'Property switch failed. The active property was not changed to protect lodge data isolation.'
      )
    } finally {
      setSwitching(false)
    }
  }

  if (loading) return null
  if (groups.length === 0 || properties.length === 0) {
    if (error) {
      return (
        <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 flex items-start gap-2">
          <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )
    }
    return null
  }

  return (
    <div className="relative">
      {error && (
        <div className="mb-2 rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 flex items-start gap-2">
          <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}
      <button
        onClick={() => setOpen(!open)}
        disabled={switching}
        className="flex items-center gap-2 px-3 py-2 text-sm border rounded hover:bg-gray-50 w-full disabled:opacity-50"
      >
        <Building2 className="w-4 h-4 text-gray-500" />
        <span className="flex-1 text-left truncate">
          {switching
            ? 'Switching property…'
            : (properties.find(p => p.lodge_id === currentLodgeId)?.lodge_id || 'Select Property')}
        </span>
        <ChevronDown className="w-3 h-3 text-gray-400" />
      </button>

      {open && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-white border rounded shadow-lg z-50 max-h-60 overflow-y-auto">
          <div className="p-2 border-b text-xs text-gray-500 font-medium">
            {selectedGroup?.name || 'Properties'} · lodge isolation enforced
          </div>
          {properties.map((p, i) => (
            <button
              key={i}
              onClick={() => handleSelect(p.lodge_id)}
              disabled={switching}
              className={`w-full text-left px-3 py-2 text-sm hover:bg-blue-50 flex items-center justify-between disabled:opacity-50 ${p.lodge_id === currentLodgeId ? 'bg-blue-50 text-blue-700' : ''}`}
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
