import { useEffect, useState } from 'react'
import { LifeBuoy, RefreshCw, Wifi, WifiOff } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { createSupportTicket, flushOfflineQueue, getControlSnapshot, getSupportRequests } from '../lib/api'
import { supabase } from '../lib/supabase'
import { getNotificationSettings, getPwaQueueHealth, listCacheEntries, publishPwaHealth, setNotificationSettings, subscribeRuntimeEvent } from '../lib/runtime'
import { shortDateTime, titleCase } from '../lib/format'
import { useToast } from '../App'

export default function Control() {
  const { user } = useAuth()
  const { showToast } = useToast()
  const [loading, setLoading] = useState(true)
  const [snapshot, setSnapshot] = useState(null)
  const [loadError, setLoadError] = useState('')
  const [caches, setCaches] = useState([])
  const [requests, setRequests] = useState([])
  const [ticket, setTicket] = useState({ title: '', description: '', category: 'Support', priority: 'Normal' })
  const [sending, setSending] = useState(false)
  const [notifications, setNotifications] = useState(() => getNotificationSettings())
  const [queueHealth, setQueueHealth] = useState(() => null)

  const load = async () => {
    setLoading(true)
    setLoadError('')
    try {
      const [control, requestRows] = await Promise.all([
        getControlSnapshot(user.lodge_id),
        getSupportRequests(user.lodge_id, 10).catch(() => [])
      ])
      setSnapshot(control)
      setRequests(requestRows)
      setCaches(listCacheEntries(user.lodge_id))
      const health = getPwaQueueHealth(user.lodge_id)
      setQueueHealth(health)
      const isOnline = typeof navigator !== 'undefined' && navigator.onLine !== false
      if (isOnline) {
        publishPwaHealth(user.lodge_id, supabase, health)
      }
    } catch (error) {
      setLoadError(error?.message || 'Control view could not load.')
    }
    setLoading(false)
  }

  useEffect(() => {
    load()
    const unsubscribe = subscribeRuntimeEvent('boroko:pwa-queue', load)
    const unsubscribeNotif = subscribeRuntimeEvent('boroko:pwa-notification-settings', setNotifications)
    const unsubscribeIssues = subscribeRuntimeEvent('boroko:pwa-issues', load)
    return () => {
      unsubscribe?.()
      unsubscribeNotif?.()
      unsubscribeIssues?.()
    }
  }, [user.lodge_id])

  return (
    <div className="min-h-screen bg-gray-950 pb-24">
      <div className="bg-gray-900 px-4 pt-12 pb-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-lg font-bold text-white">Control</h1>
            <p className="text-xs text-gray-400">Check sync health, send simple requests, and follow front desk updates</p>
          </div>
          <button onClick={load} className="p-2 text-gray-400"><RefreshCw size={18} className={loading ? 'animate-spin' : ''} /></button>
        </div>
      </div>

      <div className="px-4 py-4 space-y-3">
        {loadError && (
          <div className="bg-red-950/40 border border-red-900 rounded-2xl px-4 py-3 text-sm text-red-200">
            {loadError}
          </div>
        )}
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-gray-800 rounded-2xl p-4">
            <p className="text-xs text-gray-400">Connection</p>
            <p className="text-xl font-bold text-white mt-1 flex items-center gap-2">
              {snapshot?.online ? <Wifi size={18} className="text-green-400" /> : <WifiOff size={18} className="text-red-400" />}
              {snapshot?.online ? 'Online' : 'Offline'}
            </p>
          </div>
          <div className="bg-gray-800 rounded-2xl p-4">
            <p className="text-xs text-gray-400">Queued Changes (this device only)</p>
            <p className="text-xl font-bold text-white mt-1">{snapshot?.queue?.count || 0}</p>
            <p className="text-[11px] text-gray-500 mt-1">
              {snapshot?.lastSync?.processed
                ? `Last sync moved ${snapshot.lastSync.processed} change(s)`
                : snapshot?.online ? 'No recent sync yet' : 'Waiting for connection'}
            </p>
          </div>
        </div>

        {/* Offline Queue Health — device-local state only, not reflected in desktop System Health */}
        <div className="bg-gray-800 rounded-2xl p-4">
          <div className="flex items-center justify-between mb-1">
            <p className="text-sm font-semibold text-white">Offline Queue Health (this device only)</p>
            <span className="text-xs text-gray-500">device-local</span>
          </div>
          <p className="text-[11px] text-gray-500 mb-3">
            This reflects the offline queue stored on this browser only. It is NOT synced to the desktop System Health panel and does not represent the state of other devices.
          </p>
          {queueHealth ? (
            <div className="space-y-2">
              <div className="grid grid-cols-3 gap-2">
                <div className="bg-gray-900 rounded-xl p-3 text-center">
                  <p className="text-xl font-bold text-white">{queueHealth.queueLength}</p>
                  <p className="text-[11px] text-gray-400 mt-1">Queued (this device only)</p>
                </div>
                <div className="bg-gray-900 rounded-xl p-3 text-center">
                  <p className={`text-xl font-bold ${queueHealth.blockedCount > 0 ? 'text-yellow-400' : 'text-white'}`}>{queueHealth.blockedCount}</p>
                  <p className="text-[11px] text-gray-400 mt-1">Blocked</p>
                </div>
                <div className="bg-gray-900 rounded-xl p-3 text-center">
                  <p className={`text-xl font-bold ${queueHealth.deadLetterCount > 0 ? 'text-red-400' : 'text-white'}`}>{queueHealth.deadLetterCount}</p>
                  <p className="text-[11px] text-gray-400 mt-1">Dead Letters</p>
                </div>
              </div>
              {queueHealth.blockedCount > 0 && (
                <p className="text-xs text-yellow-300 bg-yellow-950/30 rounded-xl px-3 py-2">
                  {queueHealth.blockedCount} operation(s) are blocked from sending. These will not sync until the blocking condition is resolved.
                </p>
              )}
              {queueHealth.deadLetterCount > 0 && (
                <p className="text-xs text-red-300 bg-red-950/30 rounded-xl px-3 py-2">
                  {queueHealth.deadLetterCount} operation(s) have failed too many times or have errors. Manual review may be required.
                </p>
              )}
              {queueHealth.unresolvedItems.length > 0 && (
                <div className="space-y-1 mt-2">
                  <p className="text-xs text-gray-400 font-medium">Unresolved items (this device only):</p>
                  {queueHealth.unresolvedItems.map((item, index) => (
                    <div key={item.id || index} className="bg-gray-900 rounded-xl px-3 py-2">
                      <p className="text-xs text-white">{item.label}</p>
                      {item.lastError && <p className="text-[11px] text-red-400 mt-1">{item.lastError}</p>}
                    </div>
                  ))}
                </div>
              )}
              {queueHealth.queueLength === 0 && (
                <p className="text-sm text-gray-500">No pending operations in the offline queue on this device.</p>
              )}
            </div>
          ) : (
            <p className="text-sm text-gray-500">Queue health not loaded yet.</p>
          )}
        </div>

        <div className="bg-gray-800 rounded-2xl p-4">
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm font-semibold text-white">Financial Validation Alerts</p>
            <span className="text-xs text-gray-500">Server reconciliation</span>
          </div>
          <div className="space-y-2">
            {(snapshot?.validationAlerts || []).map((alert) => (
              <div key={alert.id} className="bg-gray-900 rounded-xl px-3 py-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-white">{titleCase(alert.alert_type || 'validation alert')}</p>
                    <p className="text-xs text-gray-400 mt-1">{shortDateTime(alert.created_at)}</p>
                  </div>
                  <span className="rounded-full bg-yellow-950/60 px-2 py-1 text-xs font-semibold text-yellow-300">
                    {Number(alert.issue_count || 0)} issue{Number(alert.issue_count || 0) === 1 ? '' : 's'}
                  </span>
                </div>
                {alert.summary && (
                  <p className="mt-2 text-xs text-gray-500">
                    Payments {Number(alert.summary.payment_mismatches || 0)} • Charges {Number(alert.summary.charge_mismatches || 0)} • Folio POS {Number(alert.summary.folio_pos_mismatches || 0)} • Invoices {Number(alert.summary.invoice_gaps || 0) + Number(alert.summary.orphan_invoices || 0)}
                  </p>
                )}
              </div>
            ))}
            {(!snapshot?.validationAlerts || snapshot.validationAlerts.length === 0) && (
              <p className="text-sm text-gray-500">No recent reconciliation alerts were recorded.</p>
            )}
          </div>
        </div>

        <div className="bg-gray-800 rounded-2xl p-4">
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm font-semibold text-white">Recent App Issues</p>
            <span className="text-xs text-gray-500">Specific load failures</span>
          </div>
          <div className="space-y-2">
            {(snapshot?.recentIssues || []).map((issue) => (
              <div key={issue.id} className="bg-gray-900 rounded-xl px-3 py-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-white truncate">{titleCase(String(issue.scope || 'app issue').replace(/[.:/-]+/g, ' '))}</p>
                    <p className="text-xs text-gray-400 mt-1">{shortDateTime(issue.createdAt)}</p>
                  </div>
                  <span className={`rounded-full px-2 py-1 text-xs font-semibold ${
                    issue.severity === 'warn'
                      ? 'bg-yellow-950/60 text-yellow-300'
                      : 'bg-red-950/60 text-red-300'
                  }`}>
                    {titleCase(issue.severity || 'error')}
                  </span>
                </div>
                <p className="mt-2 text-xs text-gray-300">{issue.message}</p>
                {issue.detail && issue.detail !== issue.message && <p className="mt-1 text-[11px] text-gray-500">{issue.detail}</p>}
              </div>
            ))}
            {(!snapshot?.recentIssues || snapshot.recentIssues.length === 0) && (
              <p className="text-sm text-gray-500">No recent app issues were recorded on this device.</p>
            )}
          </div>
        </div>

        <div className="bg-gray-800 rounded-2xl p-4">
          <p className="text-sm font-semibold text-white">Subscription</p>
          <p className="text-xs text-gray-400 mt-1">{snapshot?.entitlement?.lodge_name || user.lodge_display_name}</p>
          <div className="flex items-center justify-between mt-3">
            <div>
              <p className="text-2xl font-bold text-white">{snapshot?.entitlement?.plan || 'Starter'}</p>
              <p className="text-xs text-gray-500 mt-1">Status: {snapshot?.entitlement?.status || 'active'}</p>
              {snapshot?.lastSync && <p className="text-[11px] text-gray-500 mt-1">Last sync left {snapshot.lastSync.remaining || 0} queued change(s)</p>}
            </div>
            <button
              onClick={async () => {
                try {
                  const result = await flushOfflineQueue(user.lodge_id)
                  await load()
                  showToast({
                    title: 'Sync finished',
                    message: result?.processed > 0
                      ? `Moved ${result.processed} queued change${result.processed === 1 ? '' : 's'}.`
                      : 'There was nothing new to sync.',
                    tone: 'success'
                  })
                } catch (error) {
                  showToast({
                    title: 'Sync could not finish',
                    message: error?.message || 'Please try again when the connection is stable.',
                    tone: 'error'
                  })
                }
              }}
              className="bg-green-700 text-white rounded-xl px-4 py-2 text-sm font-semibold"
            >
              Sync Now
            </button>
          </div>
        </div>

        <div className="bg-gray-800 rounded-2xl p-4">
          <p className="text-sm font-semibold text-white">Offline Cache</p>
          <div className="space-y-2 mt-3">
            {caches.slice(0, 8).map((entry) => (
              <div key={entry.key} className="bg-gray-900 rounded-xl px-3 py-3 flex items-center justify-between gap-3 text-sm">
                <div>
                  <p className="text-white font-medium">{entry.key}</p>
                  <p className="text-xs text-gray-500 mt-1">{entry.updatedAt || 'Not cached yet'}</p>
                </div>
                <span className="text-xs text-gray-400">{entry.size}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-gray-800 rounded-2xl p-4">
          <p className="text-sm font-semibold text-white">Notification Settings</p>
          <div className="space-y-2 mt-3">
            {[
              ['urgentAlerts', 'Urgent lodge alerts'],
              ['refunds', 'Refund-related alerts'],
              ['balances', 'Outstanding balance alerts'],
              ['maintenance', 'Maintenance alerts']
            ].map(([key, label]) => (
              <label key={key} className="bg-gray-900 rounded-xl px-3 py-3 flex items-center justify-between gap-3 text-sm text-white">
                <span>{label}</span>
                <input
                  type="checkbox"
                  checked={notifications[key] !== false}
                  onChange={(event) => {
                    const next = { ...notifications, [key]: event.target.checked }
                    setNotifications(next)
                    setNotificationSettings(next)
                    showToast({
                      title: 'Notification setting saved',
                      message: `${label} ${event.target.checked ? 'turned on' : 'turned off'}.`,
                      tone: 'success'
                    })
                  }}
                />
              </label>
            ))}
          </div>
        </div>

        <div className="bg-gray-800 rounded-2xl p-4">
          <p className="text-sm font-semibold text-white">Quick Requests</p>
          <p className="mt-1 text-xs text-gray-500">Use these when you need front desk follow-up without changing bookings from mobile. They appear on the desktop dashboard.</p>
          <div className="grid grid-cols-1 gap-2 mt-3">
            {[
              ['Balance follow-up', 'Please confirm which outstanding guest balances are being followed up today.'],
              ['Arrival clarification', 'Please confirm any special cases or room issues for today’s arrivals.'],
              ['Expense clarification', 'Please explain any unusual expense entered today and add missing notes on desktop.']
            ].map(([title, description]) => (
              <button
                key={title}
                onClick={async () => {
                  setSending(true)
                  try {
                    const result = await createSupportTicket(user.lodge_id, {
                      lodge_name: user.lodge_display_name,
                      title,
                      description,
                      category: 'Front Desk Request',
                      priority: 'Normal'
                    })
                    showToast({
                      title: result?.queued ? 'Request saved offline' : 'Request sent',
                      message: result?.queued
                        ? 'It will reach front desk automatically when the internet returns.'
                        : 'Front desk can now see this request on the desktop dashboard.',
                      tone: result?.queued ? 'queued' : 'success'
                    })
                    await load()
                  } catch (error) {
                    showToast({
                      title: 'Request was not sent',
                      message: error?.message || 'Please try again.',
                      tone: 'error'
                    })
                  } finally {
                    setSending(false)
                  }
                }}
                disabled={sending}
                className="bg-gray-900 text-left text-white rounded-xl px-3 py-3 text-sm font-medium disabled:opacity-60"
              >
                {title}
              </button>
            ))}
          </div>
        </div>

        <div className="bg-gray-800 rounded-2xl p-4">
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm font-semibold text-white">Request Tracker</p>
            <span className="text-xs text-gray-500">Front desk updates</span>
          </div>
          <p className="mb-3 text-xs text-gray-500">Once the desk acknowledges or resolves a request on desktop, the update appears here.</p>
          <div className="space-y-2">
            {requests.map((request) => (
              <div key={request.id} className="bg-gray-900 rounded-xl px-3 py-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-white truncate">{request.title}</p>
                    <p className="text-xs text-gray-400 mt-1">{request.category} • {shortDateTime(request.updated_at || request.created_at)}</p>
                  </div>
                  <span className={`text-xs px-2 py-1 rounded-full ${
                    request.status === 'resolved'
                      ? 'bg-green-900/40 text-green-300'
                      : request.status === 'in_progress'
                        ? 'bg-blue-900/40 text-blue-300'
                        : request.status === 'acknowledged'
                          ? 'bg-yellow-900/40 text-yellow-300'
                          : 'bg-gray-800 text-gray-300'
                  }`}>
                    {titleCase(request.status || 'open')}
                  </span>
                </div>
                {request.description && <p className="text-xs text-gray-500 mt-2">{request.description}</p>}
                {request.admin_notes && (
                  <div className="mt-2 rounded-lg bg-gray-800 px-3 py-2">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">Front desk note</p>
                    <p className="mt-1 text-xs text-gray-300">{request.admin_notes}</p>
                  </div>
                )}
              </div>
            ))}
            {requests.length === 0 && <p className="text-sm text-gray-500">No support or front desk requests yet.</p>}
          </div>
        </div>

        <div className="bg-gray-800 rounded-2xl p-4">
          <p className="text-sm font-semibold text-white flex items-center gap-2"><LifeBuoy size={16} className="text-green-400" /> Request Support</p>
          <div className="space-y-3 mt-3">
            <input className="w-full bg-gray-900 border border-gray-700 rounded-xl px-3 py-3 text-white text-sm" placeholder="Title" value={ticket.title} onChange={(event) => setTicket((current) => ({ ...current, title: event.target.value }))} />
            <textarea className="w-full bg-gray-900 border border-gray-700 rounded-xl px-3 py-3 text-white text-sm h-24 resize-none" placeholder="Describe the issue or request" value={ticket.description} onChange={(event) => setTicket((current) => ({ ...current, description: event.target.value }))} />
            <button
              onClick={async () => {
                setSending(true)
                try {
                  const result = await createSupportTicket(user.lodge_id, {
                    ...ticket,
                    lodge_name: user.lodge_display_name
                  })
                  setTicket({ title: '', description: '', category: 'Support', priority: 'Normal' })
                  showToast({
                    title: result?.queued ? 'Support request saved offline' : 'Support request sent',
                    message: result?.queued
                      ? 'It will send automatically once the device is back online.'
                      : 'Boroko support has received your request.',
                    tone: result?.queued ? 'queued' : 'success'
                  })
                  await load()
                } catch (error) {
                  showToast({
                    title: 'Support request failed',
                    message: error?.message || 'Please try again.',
                    tone: 'error'
                  })
                } finally {
                  setSending(false)
                }
              }}
              disabled={sending || !ticket.title.trim() || !ticket.description.trim()}
              className="w-full bg-green-700 text-white rounded-xl py-3 text-sm font-semibold"
            >
              {sending ? 'Sending…' : 'Send Support Request'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
