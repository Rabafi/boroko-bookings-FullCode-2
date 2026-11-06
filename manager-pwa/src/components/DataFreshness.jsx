import { useEffect, useState } from 'react'
import { shortDateTime } from '../lib/format'

function useOnlineStatus() {
  const [online, setOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine))

  useEffect(() => {
    const refresh = () => setOnline(typeof navigator === 'undefined' ? true : navigator.onLine)
    window.addEventListener('online', refresh)
    window.addEventListener('offline', refresh)
    refresh()
    return () => {
      window.removeEventListener('online', refresh)
      window.removeEventListener('offline', refresh)
    }
  }, [])

  return online
}

/**
 * @param {{ updatedAt?: string | null, lastUpdated?: string | null, loading?: boolean, error?: string | null, realtimeActive?: boolean, className?: string }} props
 */
export default function DataFreshness({ updatedAt, lastUpdated, loading = false, error = '', realtimeActive = false, className = '' }) {
  const online = useOnlineStatus()
  const effectiveUpdatedAt = updatedAt || lastUpdated || null

  const label = loading
    ? 'Updating\u2026'
    : error
      ? `Update failed \u2022 showing ${effectiveUpdatedAt ? shortDateTime(effectiveUpdatedAt) : 'no data'}`
      : !online
        ? `Offline \u2022 cached ${effectiveUpdatedAt ? shortDateTime(effectiveUpdatedAt) : 'no saved data'}`
        : realtimeActive
          ? 'Live'
          : effectiveUpdatedAt
            ? `Updated ${shortDateTime(effectiveUpdatedAt)}`
            : 'Loading\u2026'

  return (
    <p className={`text-[11px] ${error ? 'text-red-300' : online ? 'text-gray-500' : 'text-amber-300'} ${className}`}>
      {label}
    </p>
  )
}


