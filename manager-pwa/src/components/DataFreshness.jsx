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

export default function DataFreshness({ updatedAt, loading = false, error = '', realtimeActive = false, className = '' }) {
  const online = useOnlineStatus()

  const label = loading
    ? 'Updating\u2026'
    : error
      ? `Update failed \u2022 showing ${updatedAt ? shortDateTime(updatedAt) : 'no data'}`
      : !online
        ? `Offline \u2022 cached ${updatedAt ? shortDateTime(updatedAt) : ''}`
        : realtimeActive
          ? 'Live'
          : updatedAt
            ? `Updated ${shortDateTime(updatedAt)}`
            : 'Loading\u2026'

  return (
    <p className={`text-[11px] ${error ? 'text-red-300' : online ? 'text-gray-500' : 'text-amber-300'} ${className}`}>
      {label}
    </p>
  )
}
