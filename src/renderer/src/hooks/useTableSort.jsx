import { useState, useMemo } from 'react'

export function useTableSort(data, defaultKey = '', defaultDir = 'asc') {
  const [sortKey, setSortKey] = useState(defaultKey)
  const [sortDir, setSortDir] = useState(defaultDir)

  const toggleSort = (key) => {
    if (sortKey === key) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    } else {
      setSortKey(key)
      setSortDir('asc')
    }
  }

  const sorted = useMemo(() => {
    if (!sortKey || !data?.length) return data
    return [...data].sort((a, b) => {
      let aVal = a?.[sortKey]
      let bVal = b?.[sortKey]
      if (aVal == null) aVal = ''
      if (bVal == null) bVal = ''
      if (typeof aVal === 'number' && typeof bVal === 'number') {
        return sortDir === 'asc' ? aVal - bVal : bVal - aVal
      }
      const aStr = String(aVal).toLowerCase()
      const bStr = String(bVal).toLowerCase()
      if (aStr < bStr) return sortDir === 'asc' ? -1 : 1
      if (aStr > bStr) return sortDir === 'asc' ? 1 : -1
      return 0
    })
  }, [data, sortKey, sortDir])

  return { sorted, sortKey, sortDir, toggleSort }
}

export function SortableHeader({ label, sortKey, currentSortKey, currentSortDir, onToggle, align = 'left', className = '' }) {
  const active = sortKey === currentSortKey
  const arrow = active ? (currentSortDir === 'asc' ? ' \u2191' : ' \u2193') : ''
  return (
    <th
      className={`px-4 py-3 text-${align} font-medium cursor-pointer select-none hover:text-white transition-colors ${active ? 'text-white' : 'text-gray-400'} ${className}`}
      onClick={() => onToggle(sortKey)}
    >
      {label}{arrow}
    </th>
  )
}
