import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { useAuth } from './AuthContext'
import { getSupportRequests } from '../lib/api'
import { subscribeRuntimeEvent } from '../lib/runtime'
import { isFrontDeskConversation, upsertFrontDeskNotification } from '../lib/frontDeskNotifications'
import { normalizeSupportMessages, supportMessageSide } from '@shared/supportThreads'

const InboxContext = createContext({
  conversations: [],
  loading: false,
  error: '',
  unreadCount: 0,
  refresh: () => {},
  refreshFresh: () => {},
  updateConversation: () => {}
})

function latestMessage(request) {
  const messages = normalizeSupportMessages(request)
  return messages[messages.length - 1] || null
}

function conversationTimestamp(request) {
  return request?.updated_at || latestMessage(request)?.created_at || request?.created_at || ''
}

function latestDeskMessageVersion(request) {
  const messages = normalizeSupportMessages(request)
  const latestDeskMessage = [...messages].reverse().find((message) => supportMessageSide(message) === 'desk')
  if (!latestDeskMessage) return ''
  return [
    request?.id || '',
    latestDeskMessage?.id || '',
    latestDeskMessage?.created_at || '',
    latestDeskMessage?.body || latestDeskMessage?.message || ''
  ].map((part) => String(part ?? '').trim()).join('|')
}

export function InboxProvider({ children }) {
  const { user } = useAuth()
  const [conversations, setConversations] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const mountedRef = useRef(true)
  const lastLoadRef = useRef(null)
  const conversationCountRef = useRef(0)
  const previousUnreadVersionsRef = useRef(new Map())
  const initialLoadDoneRef = useRef(false)

  const load = useCallback(async ({ forceFresh = false } = {}) => {
    if (!user?.lodge_id) {
      setLoading(false)
      return
    }
    setLoading(true)
    setError('')
    try {
      const rows = await getSupportRequests(user.lodge_id, 50, { forceFresh })
      if (!mountedRef.current) return
      if (!Array.isArray(rows)) {
        throw new Error('Unexpected response from server.')
      }
      const filtered = rows.filter(isFrontDeskConversation)
      filtered.sort((left, right) => String(conversationTimestamp(right)).localeCompare(String(conversationTimestamp(left))))

      const currentUnreadVersions = new Map()
      for (const conversation of filtered) {
        if (conversation.manager_has_unread !== true) continue
        const version = latestDeskMessageVersion(conversation)
        if (!version) continue
        currentUnreadVersions.set(conversation.id, version)
        if (
          initialLoadDoneRef.current &&
          previousUnreadVersionsRef.current.get(conversation.id) !== version
        ) {
          upsertFrontDeskNotification(user.lodge_id, conversation, { quiet: false })
        }
      }
      previousUnreadVersionsRef.current = currentUnreadVersions
      initialLoadDoneRef.current = true

      setConversations(filtered)
      conversationCountRef.current = filtered.length
      lastLoadRef.current = Date.now()
    } catch (err) {
      if (!mountedRef.current) return
      if (conversationCountRef.current > 0) {
        setError(err?.message || 'Refresh failed. Showing last known conversations.')
      } else {
        setError(err?.message || 'Inbox could not load.')
      }
    }
    setLoading(false)
  }, [user?.lodge_id])

  useEffect(() => {
    mountedRef.current = true
    previousUnreadVersionsRef.current = new Map()
    initialLoadDoneRef.current = false
    load({ forceFresh: true })
    return () => { mountedRef.current = false }
  }, [load])

  useEffect(() => {
    if (!user?.lodge_id) return undefined
    const interval = window.setInterval(() => {
      if (document.visibilityState !== 'hidden') load()
    }, 60_000)
    const handleVisible = () => {
      if (document.visibilityState === 'visible') load({ forceFresh: true })
    }
    const handleOnline = () => load({ forceFresh: true })
    const unsubscribeQueue = subscribeRuntimeEvent('boroko:pwa-queue', () => load({ forceFresh: true }))
    document.addEventListener('visibilitychange', handleVisible)
    window.addEventListener('online', handleOnline)
    return () => {
      window.clearInterval(interval)
      document.removeEventListener('visibilitychange', handleVisible)
      window.removeEventListener('online', handleOnline)
      unsubscribeQueue?.()
    }
  }, [load, user?.lodge_id])

  const unreadCount = useMemo(() => {
    return conversations.filter((c) => c.manager_has_unread === true).length
  }, [conversations])

  const updateConversation = useCallback((ticketId, updates) => {
    setConversations((current) =>
      current.map((c) => (c.id === ticketId ? { ...c, ...updates } : c))
    )
  }, [])

  const refresh = useCallback(() => load(), [load])
  const refreshFresh = useCallback(() => load({ forceFresh: true }), [load])

  const value = useMemo(() => ({
    conversations,
    loading,
    error,
    unreadCount,
    refresh,
    refreshFresh,
    updateConversation
  }), [conversations, loading, error, unreadCount, refresh, refreshFresh, updateConversation])

  return <InboxContext.Provider value={value}>{children}</InboxContext.Provider>
}

export function useInbox() {
  return useContext(InboxContext)
}
