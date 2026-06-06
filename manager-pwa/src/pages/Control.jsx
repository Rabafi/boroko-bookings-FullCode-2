import { useCallback, useEffect, useMemo, useState } from 'react'
import { MessageCircle, Plus, RefreshCw, Send, Wifi, WifiOff, X } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { addSupportTicketMessage, createSupportTicket, flushOfflineQueue, getControlSnapshot, getSupportRequests } from '../lib/api'
import { supabase } from '../lib/supabase'
import { buildPwaNotificationSourceKey, getNotificationSettings, getPwaQueueHealth, publishPwaHealth, subscribeRuntimeEvent, upsertPwaNotification } from '../lib/runtime'
import { shortDateTime, titleCase } from '../lib/format'
import { buildSupportAuthorFromUser, normalizeSupportMessages, supportMessageSide, supportSenderMeta, supportSenderName } from '@shared/supportThreads'
import { useToast } from '../App'

function getFrontDeskNotificationSourceKey(request) {
  return buildPwaNotificationSourceKey(
    'frontdesk-request',
    request?.title || '',
    request?.description || '',
    request?.category || 'Front Desk Request',
    request?.priority || 'Normal'
  )
}

function upsertFrontDeskNotification(lodgeId, request) {
  if (!lodgeId || !isFrontDeskConversation(request)) return
  const messages = normalizeSupportMessages(request)
  const latestDeskMessage = [...messages].reverse().find((message) => supportMessageSide(message) === 'desk')
  const hasDeskResponse = String(request.status || 'open') !== 'open' || latestDeskMessage || String(request.admin_notes || '').trim()
  if (!hasDeskResponse) return
  upsertPwaNotification(lodgeId, {
    sourceKey: getFrontDeskNotificationSourceKey(request),
    title: `Front desk updated: ${request.title}`,
    message: latestDeskMessage?.body || request.admin_notes || `Status changed to ${titleCase(request.status || 'open')}.`,
    tone: request.status === 'resolved' || request.status === 'closed' ? 'info' : 'warn',
    category: 'frontDeskRequest',
    href: '/control',
    meta: {
      requestId: request.id || null,
      requestTitle: request.title || '',
      requestBody: request.description || '',
      deskResponse: latestDeskMessage?.body || request.admin_notes || '',
      requestStatus: request.status || 'open',
      requestCategory: request.category || 'Front Desk Request',
      requestPriority: request.priority || 'Normal',
      messages,
      sentAt: request.created_at || null,
      updatedAt: request.updated_at || null
    }
  })
}

function isFrontDeskConversation(request) {
  return String(request?.category || '').trim().toLowerCase() === 'front desk request'
}

function latestMessage(request) {
  const messages = normalizeSupportMessages(request)
  return messages[messages.length - 1] || null
}

function conversationTimestamp(request) {
  return request?.updated_at || latestMessage(request)?.created_at || request?.created_at || ''
}

function conversationTitle(body, user) {
  const firstLine = String(body || '').split(/\r?\n/).find((line) => line.trim()) || ''
  const trimmed = firstLine.trim()
  if (trimmed) return trimmed.length > 72 ? `${trimmed.slice(0, 69)}...` : trimmed
  return `Message from ${user?.name || 'Manager'}`
}

function initials(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return 'FD'
  return parts.slice(0, 2).map((part) => part[0]?.toUpperCase()).join('')
}

function statusTone(status) {
  const value = String(status || 'open').toLowerCase()
  if (value === 'resolved' || value === 'closed') return 'bg-green-900/50 text-green-300'
  if (value === 'in_progress') return 'bg-blue-900/50 text-blue-300'
  if (value === 'acknowledged') return 'bg-amber-900/50 text-amber-300'
  return 'bg-gray-900 text-gray-300'
}

function ConversationRow({ request, active, onSelect }) {
  const latest = latestMessage(request)
  const latestSender = latest ? supportSenderName(latest) : request.requester_name || 'Manager'
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`flex w-full items-center gap-3 px-3 py-3 text-left transition-colors ${
        active ? 'bg-green-500/12' : 'hover:bg-white/5'
      }`}
    >
      <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-sm font-bold ${
        active ? 'bg-green-600 text-white' : 'bg-gray-900 text-green-200'
      }`}>
        {initials(request.requester_name || latestSender)}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <p className="truncate text-sm font-semibold text-white">{request.title || 'Conversation'}</p>
          <span className="shrink-0 text-[10px] text-gray-500">{shortDateTime(conversationTimestamp(request))}</span>
        </div>
        <p className="mt-0.5 truncate text-xs text-gray-400">
          {latestSender}: {latest?.body || request.description || 'No messages yet'}
        </p>
      </div>
    </button>
  )
}

function ChatBubble({ message }) {
  const isManager = supportMessageSide(message) === 'manager'
  return (
    <div className={`flex ${isManager ? 'justify-end' : 'justify-start'}`}>
      <div className={`max-w-[84%] rounded-2xl px-3 py-2 ${
        isManager
          ? 'rounded-br-md bg-green-700 text-white'
          : 'rounded-bl-md bg-gray-800 text-gray-100'
      }`}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className={`text-[10px] font-semibold uppercase tracking-wide ${isManager ? 'text-green-100' : 'text-gray-400'}`}>
              {supportSenderName(message)}
            </p>
            {supportSenderMeta(message) ? (
              <p className={`mt-0.5 text-[10px] ${isManager ? 'text-green-100/75' : 'text-gray-500'}`}>
                {supportSenderMeta(message)}
              </p>
            ) : null}
          </div>
          <span className="shrink-0 text-[10px] opacity-70">{shortDateTime(message.created_at)}</span>
        </div>
        <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed">{message.body}</p>
      </div>
    </div>
  )
}

export default function Control() {
  const { user } = useAuth()
  const { showToast } = useToast()
  const [loading, setLoading] = useState(true)
  const [snapshot, setSnapshot] = useState(null)
  const [loadError, setLoadError] = useState('')
  const [requests, setRequests] = useState([])
  const [selectedId, setSelectedId] = useState('')
  const [startingNew, setStartingNew] = useState(false)
  const [newMessage, setNewMessage] = useState('')
  const [replyDraft, setReplyDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [notifications, setNotifications] = useState(() => getNotificationSettings())
  const [queueHealth, setQueueHealth] = useState(() => null)

  const conversations = useMemo(() => (
    requests
      .filter(isFrontDeskConversation)
      .sort((left, right) => String(conversationTimestamp(right)).localeCompare(String(conversationTimestamp(left))))
  ), [requests])

  const activeRequest = conversations.find((request) => request.id === selectedId) || conversations[0] || null
  const activeMessages = activeRequest ? normalizeSupportMessages(activeRequest) : []

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError('')
    try {
      const [control, requestRows] = await Promise.all([
        getControlSnapshot(user.lodge_id),
        getSupportRequests(user.lodge_id, 50).catch(() => [])
      ])
      const nextRows = Array.isArray(requestRows) ? requestRows : []
      const nextConversations = nextRows.filter(isFrontDeskConversation)
      setSnapshot(control)
      setRequests(nextRows)
      setSelectedId((current) => (
        nextConversations.some((request) => request.id === current)
          ? current
          : nextConversations[0]?.id || ''
      ))
      const health = getPwaQueueHealth(user.lodge_id)
      setQueueHealth(health)
      const isOnline = typeof navigator !== 'undefined' && navigator.onLine !== false
      if (isOnline) {
        publishPwaHealth(user.lodge_id, supabase, health)
      }
      nextRows.forEach((request) => {
        if (notifications.frontDeskRequests === false) return
        upsertFrontDeskNotification(user.lodge_id, request)
      })
    } catch (error) {
      setLoadError(error?.message || 'Inbox could not load.')
    }
    setLoading(false)
  }, [notifications.frontDeskRequests, user.lodge_id])

  useEffect(() => {
    load()
    const interval = window.setInterval(load, 30_000)
    const unsubscribe = subscribeRuntimeEvent('boroko:pwa-queue', load)
    const unsubscribeNotif = subscribeRuntimeEvent('boroko:pwa-notification-settings', setNotifications)
    const unsubscribeIssues = subscribeRuntimeEvent('boroko:pwa-issues', load)
    return () => {
      window.clearInterval(interval)
      unsubscribe?.()
      unsubscribeNotif?.()
      unsubscribeIssues?.()
    }
  }, [load])

  function buildRequestAuthorPayload(source = 'manager_pwa') {
    const author = buildSupportAuthorFromUser(user, 'manager_pwa')
    return {
      source,
      ...author,
      requester_name: author.sender_name,
      requester_role: author.sender_role,
      requester_user_id: author.sender_user_id,
      requester_surface: author.sender_surface
    }
  }

  async function startConversation() {
    const body = newMessage.trim()
    if (!body) return
    setSending(true)
    try {
      const authorPayload = buildRequestAuthorPayload('manager_pwa_inbox_message')
      const result = await createSupportTicket(user.lodge_id, {
        lodge_name: user.lodge_display_name,
        title: conversationTitle(body, user),
        description: body,
        category: 'Front Desk Request',
        priority: 'Normal',
        ...authorPayload
      })
      setNewMessage('')
      setStartingNew(false)
      if (result?.id) setSelectedId(result.id)
      showToast({
        title: result?.queued ? 'Message saved offline' : 'Message sent',
        message: result?.queued
          ? 'It will appear in the inbox when the device reconnects.'
          : 'Front desk can now see this conversation.',
        tone: result?.queued ? 'queued' : 'success'
      })
      await load()
    } catch (error) {
      showToast({
        title: 'Message was not sent',
        message: error?.message || 'Please try again.',
        tone: 'error'
      })
    } finally {
      setSending(false)
    }
  }

  async function sendReply() {
    if (!activeRequest) return
    const body = replyDraft.trim()
    if (!body) return
    setSending(true)
    try {
      const author = buildSupportAuthorFromUser(user, 'manager_pwa')
      const result = await addSupportTicketMessage(user.lodge_id, activeRequest.id, {
        body,
        status: ['resolved', 'closed'].includes(String(activeRequest.status || '').toLowerCase()) ? 'in_progress' : null,
        ...author,
        metadata: {
          source: 'manager_pwa_inbox_reply',
          requestTitle: activeRequest.title || ''
        }
      })
      setReplyDraft('')
      showToast({
        title: result?.queued ? 'Reply saved offline' : 'Reply sent',
        message: result?.queued
          ? 'It will reach front desk automatically when the internet returns.'
          : 'Front desk can now see your latest message.',
        tone: result?.queued ? 'queued' : 'success'
      })
      await load()
    } catch (error) {
      showToast({
        title: 'Reply was not sent',
        message: error?.message || 'Please try again.',
        tone: 'error'
      })
    } finally {
      setSending(false)
    }
  }

  async function syncNow() {
    try {
      const result = await flushOfflineQueue(user.lodge_id)
      await load()
      showToast({
        title: 'Sync finished',
        message: result?.processed > 0
          ? `Sent ${result.processed} saved message${result.processed === 1 ? '' : 's'}.`
          : 'There was nothing waiting to send.',
        tone: 'success'
      })
    } catch (error) {
      showToast({
        title: 'Sync could not finish',
        message: error?.message || 'Please try again when the connection is stable.',
        tone: 'error'
      })
    }
  }

  return (
    <div className="min-h-screen bg-gray-950 pb-24">
      <div className="bg-gray-900 px-4 pt-12 pb-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-lg font-bold text-white">Inbox</h1>
            <p className="text-xs text-gray-400">Chat with front desk from the manager mobile app.</p>
          </div>
          <button type="button" onClick={load} className="p-2 text-gray-400" aria-label="Refresh inbox">
            <RefreshCw size={18} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      <div className="px-4 py-4">
        {loadError ? (
          <div className="mb-3 rounded-2xl border border-red-900 bg-red-950/40 px-4 py-3 text-sm text-red-200">
            {loadError}
          </div>
        ) : null}

        <section className="overflow-hidden rounded-2xl border border-white/10 bg-gray-900">
          <div className="border-b border-white/10 px-4 py-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-white">Chats</p>
                <p className="mt-0.5 text-xs text-gray-500">
                  {conversations.length} conversation{conversations.length === 1 ? '' : 's'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setStartingNew(true)
                  setSelectedId('')
                }}
                className="inline-flex items-center gap-2 rounded-full bg-green-700 px-3 py-2 text-xs font-semibold text-white"
              >
                <Plus size={14} /> New chat
              </button>
            </div>
          </div>

          <div className="grid min-h-[620px] grid-cols-1 md:grid-cols-[240px_1fr]">
            <div className="border-b border-white/10 md:border-b-0 md:border-r md:border-white/10">
              {conversations.length > 0 ? (
                <div className="max-h-72 overflow-y-auto md:max-h-[620px]">
                  {conversations.map((request) => (
                    <ConversationRow
                      key={request.id}
                      request={request}
                      active={!startingNew && activeRequest?.id === request.id}
                      onSelect={() => {
                        setStartingNew(false)
                        setSelectedId(request.id)
                        setReplyDraft('')
                      }}
                    />
                  ))}
                </div>
              ) : (
                <div className="px-4 py-8 text-center">
                  <MessageCircle size={28} className="mx-auto text-gray-600" />
                  <p className="mt-3 text-sm font-semibold text-white">No chats yet</p>
                  <p className="mt-1 text-xs text-gray-500">Start a message and front desk will see it on desktop.</p>
                </div>
              )}
            </div>

            <div className="flex min-h-[500px] flex-col">
              {startingNew || !activeRequest ? (
                <div className="flex min-h-full flex-1 flex-col">
                  <div className="flex items-start justify-between gap-3 border-b border-white/10 px-4 py-3">
                    <div>
                      <p className="text-sm font-semibold text-white">New chat</p>
                      <p className="mt-0.5 text-xs text-gray-500">Write one message. The inbox title is created from your first line.</p>
                    </div>
                    {conversations.length > 0 ? (
                      <button
                        type="button"
                        onClick={() => setStartingNew(false)}
                        className="rounded-full bg-white/5 p-2 text-gray-400"
                        aria-label="Close new chat"
                      >
                        <X size={16} />
                      </button>
                    ) : null}
                  </div>
                  <div className="flex flex-1 items-end px-4 py-4">
                    <div className="w-full rounded-2xl border border-white/10 bg-gray-950 p-3">
                      <textarea
                        className="h-32 w-full resize-none rounded-xl border border-gray-800 bg-gray-900 px-3 py-3 text-sm text-white placeholder-gray-500"
                        placeholder="Message front desk..."
                        value={newMessage}
                        onChange={(event) => setNewMessage(event.target.value)}
                        maxLength={1200}
                      />
                      <div className="mt-3 flex justify-end">
                        <button
                          type="button"
                          onClick={startConversation}
                          disabled={sending || !newMessage.trim()}
                          className="inline-flex items-center gap-2 rounded-xl bg-green-700 px-4 py-3 text-sm font-semibold text-white disabled:opacity-50"
                        >
                          <Send size={15} /> {sending ? 'Sending...' : 'Send'}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <>
                  <div className="border-b border-white/10 px-4 py-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-white">{activeRequest.title}</p>
                        <p className="mt-0.5 text-xs text-gray-500">
                          {activeRequest.requester_name ? `${activeRequest.requester_name} - ` : ''}{shortDateTime(conversationTimestamp(activeRequest))}
                        </p>
                      </div>
                      <span className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold ${statusTone(activeRequest.status)}`}>
                        {titleCase(activeRequest.status || 'open')}
                      </span>
                    </div>
                  </div>

                  <div className="flex-1 space-y-2 overflow-y-auto bg-gray-950 px-4 py-4">
                    {activeMessages.map((message) => <ChatBubble key={message.id} message={message} />)}
                  </div>

                  <div className="border-t border-white/10 bg-gray-900 p-3">
                    <div className="rounded-2xl border border-white/10 bg-gray-950 p-2">
                      <textarea
                        className="h-20 w-full resize-none rounded-xl border border-gray-800 bg-gray-900 px-3 py-2 text-sm text-white placeholder-gray-500"
                        placeholder="Write a reply..."
                        value={replyDraft}
                        onChange={(event) => setReplyDraft(event.target.value)}
                        maxLength={1000}
                      />
                      <div className="mt-2 flex items-center justify-between gap-3">
                        <p className="text-[11px] text-gray-500">Front desk sees your name on each message.</p>
                        <button
                          type="button"
                          onClick={sendReply}
                          disabled={sending || !replyDraft.trim()}
                          className="inline-flex shrink-0 items-center gap-2 rounded-xl bg-green-700 px-4 py-2 text-xs font-semibold text-white disabled:opacity-50"
                        >
                          <Send size={14} /> {sending ? 'Sending...' : 'Send'}
                        </button>
                      </div>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        </section>

        <section className="mt-4 rounded-2xl border border-white/10 bg-gray-900 px-4 py-3">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="flex items-center gap-2 text-sm font-semibold text-white">
                {snapshot?.online ? <Wifi size={16} className="text-green-400" /> : <WifiOff size={16} className="text-red-400" />}
                {snapshot?.online ? 'Online' : 'Offline'}
              </p>
              <p className="mt-1 text-xs text-gray-500">
                {queueHealth?.queueLength > 0
                  ? `${queueHealth.queueLength} saved item${queueHealth.queueLength === 1 ? '' : 's'} waiting to send`
                  : 'No saved messages waiting to send'}
              </p>
              <p className="mt-0.5 text-[11px] text-gray-600">Sync status is for this device only.</p>
            </div>
            <button
              type="button"
              onClick={syncNow}
              className="shrink-0 rounded-xl border border-white/10 bg-gray-800 px-3 py-2 text-xs font-semibold text-white"
            >
              Sync now
            </button>
          </div>
        </section>
      </div>
    </div>
  )
}
