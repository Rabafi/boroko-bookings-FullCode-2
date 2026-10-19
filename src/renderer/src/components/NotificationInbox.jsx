// @ts-check
import { useState, useEffect, useCallback } from 'react'
import { Bell, CheckCheck, Trash2, Filter, Info, AlertTriangle, AlertCircle, CheckCircle, Zap, RefreshCw } from 'lucide-react'
import Pagination, { usePagination } from './shared/Pagination'

/** @param {unknown} value @returns {value is import('../types/desktop-api.js').AdminNotificationRecord} */
function isAdminNotificationRecord(value) {
  if (!value || typeof value !== 'object') return false
  const row = /** @type {Record<string, unknown>} */ (value)
  return typeof row.id === 'string' && typeof row.type === 'string' && typeof row.title === 'string' &&
    ['body', 'entity_type', 'entity_id', 'lodge_id', 'lodge_name', 'action_url', 'actor_email', 'read_at'].every((key) => row[key] === null || typeof row[key] === 'string') &&
    typeof row.created_at === 'string'
}

/** @param {unknown} value */
function readAdminNotifications(value) {
  return Array.isArray(value) ? value.filter(isAdminNotificationRecord) : []
}

/** @param {unknown} value */
function readUnreadCount(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

/** @template {object} T @param {T} record @param {string} key @returns {key is keyof T} */
function hasOwnKey(record, key) {
  return Object.prototype.hasOwnProperty.call(record, key)
}

const TYPE_CONFIG = /** @type {const} */ ({
  info:              { icon: Info,         color: 'text-blue-400',    bg: 'bg-blue-500/10',    border: 'border-blue-500/20' },
  warning:           { icon: AlertTriangle, color: 'text-amber-400',  bg: 'bg-amber-500/10',   border: 'border-amber-500/20' },
  error:             { icon: AlertCircle,  color: 'text-red-400',     bg: 'bg-red-500/10',     border: 'border-red-500/20' },
  success:           { icon: CheckCircle,  color: 'text-green-400',   bg: 'bg-green-500/10',   border: 'border-green-500/20' },
  action_required:   { icon: Zap,          color: 'text-purple-400',  bg: 'bg-purple-500/10',  border: 'border-purple-500/20' }
})

/** @param {string | null | undefined} dateStr */
function timeAgo(dateStr) {
  if (!dateStr) return ''
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  return `${days}d ago`
}

export default function NotificationInbox() {
  const [notifications, setNotifications] = useState(/** @type {import('../types/desktop-api.js').AdminNotificationRecord[]} */ ([]))
  const [unreadCount, setUnreadCount] = useState(0)
  const [filter, setFilter] = useState({ unread_only: false, type: '' })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(/** @type {string | null} */ (null))

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [data, count] = await Promise.all([
        window.api.admin.getNotifications({
          unread_only: filter.unread_only,
          type: filter.type || null,
          limit: 100
        }),
        window.api.admin.getUnreadCount()
      ])
      setNotifications(readAdminNotifications(data))
      setUnreadCount(readUnreadCount(count))
    } catch (err) {
      // admin:getNotifications rethrows failures as Error instances in main.
      setError(/** @type {Error} */ (err)?.message || 'Failed to load notifications')
    } finally {
      setLoading(false)
    }
  }, [filter])

  useEffect(() => { load() }, [load])

  const { page, setPage, totalPages, paginated } = usePagination(notifications)

  const markAllRead = async () => {
    await window.api.admin.markNotificationsRead(null)
    load()
  }

  /** @param {string[]} ids */
  const markSelectedRead = async (ids) => {
    await window.api.admin.markNotificationsRead(ids)
    load()
  }

  const deleteOld = async () => {
    if (!confirm('Delete notifications older than 90 days?')) return
    const result = await window.api.admin.cleanupNotifications(90)
    alert(`Deleted ${result?.count || 0} old notifications`)
    load()
  }

  return (
    <div className="space-y-4">
      {/* Header bar */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Bell className="text-purple-400" size={20} />
          <h2 className="text-white font-semibold text-lg">Notification Inbox</h2>
          {unreadCount > 0 && (
            <span className="bg-red-500 text-white text-xs font-bold px-2 py-0.5 rounded-full">{unreadCount}</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={markAllRead}
            disabled={unreadCount === 0}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-gray-700 text-gray-300 hover:bg-gray-600 hover:text-white transition-colors disabled:opacity-40"
          >
            <CheckCheck size={13} /> Mark all read
          </button>
          <button
            onClick={deleteOld}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-gray-700 text-gray-300 hover:bg-gray-600 hover:text-red-400 transition-colors"
          >
            <Trash2 size={13} /> Cleanup old
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <button
          onClick={() => setFilter(f => ({ ...f, unread_only: false }))}
          className={`text-xs px-3 py-1.5 rounded-lg transition-colors ${!filter.unread_only ? 'bg-purple-600 text-white' : 'bg-gray-800 text-gray-400 hover:text-white'}`}
        >
          All
        </button>
        <button
          onClick={() => setFilter(f => ({ ...f, unread_only: true }))}
          className={`text-xs px-3 py-1.5 rounded-lg transition-colors ${filter.unread_only ? 'bg-purple-600 text-white' : 'bg-gray-800 text-gray-400 hover:text-white'}`}
        >
          Unread ({unreadCount})
        </button>
        <div className="w-px h-5 bg-gray-700" />
        {/** @type {(keyof typeof TYPE_CONFIG)[]} */ (['info', 'warning', 'error', 'success', 'action_required']).map(t => {
          const cfg = TYPE_CONFIG[t]
          return (
            <button
              key={t}
              onClick={() => setFilter(f => ({ ...f, type: f.type === t ? '' : t }))}
              className={`text-xs px-2.5 py-1 rounded-lg transition-colors border ${filter.type === t ? `${cfg.bg} ${cfg.color} ${cfg.border}` : 'bg-gray-800 text-gray-500 border-gray-700 hover:text-white'}`}
            >
              {t.replace(/_/g, ' ')}
            </button>
          )
        })}
      </div>

      {/* Notification list */}
      <div className="bg-gray-800 rounded-xl overflow-hidden">
        {loading ? (
          <div className="px-6 py-16 text-center text-gray-500">
            <div className="animate-pulse">Loading notifications...</div>
          </div>
        ) : error ? (
          <div className="px-6 py-16 text-center">
            <AlertCircle size={32} className="mx-auto mb-3 text-red-400 opacity-60" />
            <p className="text-red-300 text-sm">{error}</p>
            <button onClick={load} className="mt-3 flex items-center gap-1.5 mx-auto text-xs px-3 py-1.5 rounded-lg bg-gray-700 text-gray-300 hover:bg-gray-600 hover:text-white transition-colors">
              <RefreshCw size={13} /> Retry
            </button>
          </div>
        ) : notifications.length === 0 ? (
          <div className="px-6 py-16 text-center text-gray-500">
            <Bell size={32} className="mx-auto mb-3 opacity-40" />
            <p>No notifications.</p>
            <p className="text-xs text-gray-600 mt-1">Admin actions will appear here as notifications.</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-700">
            {paginated.map((/** @type {import('../types/desktop-api.js').AdminNotificationRecord} */ n) => {
              const cfg = hasOwnKey(TYPE_CONFIG, n.type) ? TYPE_CONFIG[n.type] : TYPE_CONFIG.info
              const Icon = cfg.icon
              const isUnread = !n.read_at
              return (
                <div
                  key={n.id}
                  className={`flex items-start gap-3 px-5 py-3 transition-colors ${isUnread ? 'bg-gray-750' : ''} hover:bg-gray-700`}
                >
                  <div className={`mt-0.5 p-1.5 rounded-lg ${cfg.bg}`}>
                    <Icon size={14} className={cfg.color} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                      <p className={`text-sm ${isUnread ? 'text-white font-medium' : 'text-gray-300'}`}>{n.title}</p>
                      <div className="flex items-center gap-2">
                        {isUnread && <span className="w-2 h-2 rounded-full bg-purple-400 shrink-0" />}
                        <p className="text-xs text-gray-500 shrink-0">{timeAgo(n.created_at)}</p>
                      </div>
                    </div>
                    {n.body && <p className="text-xs text-gray-400 mt-0.5 line-clamp-2">{n.body}</p>}
                    <div className="flex items-center gap-2 mt-1">
                      {n.lodge_name && <span className="text-[10px] text-gray-500 bg-gray-700 px-1.5 py-0.5 rounded">{n.lodge_name}</span>}
                      {n.entity_type && <span className="text-[10px] text-blue-400 bg-blue-500/10 px-1.5 py-0.5 rounded">{n.entity_type}</span>}
                      {n.actor_email && <span className="text-[10px] text-purple-400">by {n.actor_email}</span>}
                    </div>
                  </div>
                  {isUnread && (
                    <button
                      onClick={() => markSelectedRead([n.id])}
                      className="text-xs text-gray-500 hover:text-purple-400 transition-colors shrink-0 mt-1"
                      title="Mark as read"
                    >
                      <CheckCheck size={14} />
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
      <Pagination page={page} totalPages={totalPages} onPageChange={setPage} />
    </div>
  )
}
