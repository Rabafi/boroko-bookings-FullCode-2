import { useState, useEffect, useRef } from 'react'
import { WifiOff, Info, FileDown } from 'lucide-react'

export default function OfflineNotice({ tasks = [] }) {
  const [isOnline, setIsOnline] = useState(true)
  const [showOfflineNotice, setShowOfflineNotice] = useState(false)
  const offlineNoticeTimerRef = useRef(null)

  useEffect(() => {
    const applyOnlineState = (online) => {
      setIsOnline(online)
      if (offlineNoticeTimerRef.current) {
        clearTimeout(offlineNoticeTimerRef.current)
        offlineNoticeTimerRef.current = null
      }
      if (online) {
        setShowOfflineNotice(false)
        return
      }
      offlineNoticeTimerRef.current = setTimeout(() => {
        setShowOfflineNotice(true)
      }, 1200)
    }

    const checkStatus = async () => {
      try {
        const status = await window.api.sync.getStatus()
        applyOnlineState(status?.isOnline !== false)
      } catch {
        applyOnlineState(true)
      }
    }

    checkStatus()
    const unsubscribe = window.api.sync.onStatusChanged((status) => {
      applyOnlineState(status?.isOnline !== false)
    })

    return () => {
      unsubscribe?.()
      if (offlineNoticeTimerRef.current) clearTimeout(offlineNoticeTimerRef.current)
    }
  }, [])

  if (isOnline || !showOfflineNotice) return null

  return (
    <div className="mb-4 flex flex-col gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-amber-800 shadow-sm sm:flex-row sm:items-center">
      <div className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white text-amber-600 shadow-sm">
        <WifiOff size={20} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-bold">Offline Mode — Stability Notice</p>
        <p className="mt-0.5 text-xs opacity-90">
          You are currently offline. Work saved on this computer will queue safely and sync when the internet returns. These tasks still need a live connection:
        </p>
        {tasks.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
            {tasks.map((task, i) => (
              <div key={i} className="flex items-center gap-1.5 text-[11px] font-semibold">
                <div className="h-1 w-1 rounded-full bg-amber-400" />
                {task}
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="hidden sm:flex flex-col items-end gap-2 shrink-0">
        <div className="flex items-center gap-1.5 rounded-lg bg-amber-100/50 px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-amber-600">
          <Info size={12} />
          Safe Mode
        </div>
        <button
          type="button"
          onClick={async () => {
            try {
              const result = await window.api.reports.exportOfflineSafetyManifest()
              if (result?.success) {
                alert(`Safety manifest exported successfully to: ${result.filePath}`)
              }
            } catch (err) {
              console.error('[Offline Export] Failed:', err)
              alert('Failed to export safety manifest.')
            }
          }}
          className="inline-flex items-center gap-2 rounded-xl border border-amber-300 bg-white px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-amber-700 transition-colors hover:bg-amber-100"
        >
          <FileDown size={12} />
          Safety Export
        </button>
      </div>
    </div>
  )
}
