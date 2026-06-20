import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, MessageCircle, Plus, RefreshCw, Search, Send, Wifi, WifiOff, X } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { useFeatures } from '../contexts/FeaturesContext'
import { useInbox } from '../contexts/InboxContext'
import { addSupportTicketMessage, createSupportTicket, flushOfflineQueue, markSupportRequestRead } from '../lib/api'
import { supabase } from '../lib/supabase'
import { getPwaQueueHealth, getOfflineQueue, markPwaNotificationReadBySourceKey, publishPwaHealth, subscribeRuntimeEvent } from '../lib/runtime'
import { shortDateTime, titleCase } from '../lib/format'
import { buildSupportAuthorFromUser, normalizeSupportMessages, supportMessageSide, supportSenderMeta, supportSenderName } from '@shared/supportThreads'
import { getFrontDeskNotificationSourceKey } from '../lib/frontDeskNotifications'
import { useToast } from '../App'

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

function ConversationRow({ request, onSelect }) {
  const latest = latestMessage(request)
  const latestSender = latest ? supportSenderName(latest) : request.requester_name || 'Manager'
  const isUnread = request.manager_has_unread === true
  return (
    <button
      type="button"
      onClick={onSelect}
      className="flex w-full items-center gap-3 px-3 py-3 text-left transition-colors hover:bg-white/5"
    >
      <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-sm font-bold ${
        isUnread ? 'bg-green-600 text-white' : 'bg-gray-900 text-green-200'
      }`}>
        {initials(request.requester_name || latestSender)}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <p className={`truncate text-sm font-semibold ${isUnread ? 'text-white' : 'text-gray-300'}`}>{request.title || 'Conversation'}</p>
          <span className="shrink-0 text-[10px] text-gray-500">{shortDateTime(conversationTimestamp(request))}</span>
        </div>
        <p className={`mt-0.5 truncate text-xs ${isUnread ? 'text-gray-300' : 'text-gray-500'}`}>
          {latestSender}: {latest?.body || request.description || 'No messages yet'}
        </p>
      </div>
      {isUnread && (
        <span className="shrink-0 h-2.5 w-2.5 rounded-full bg-green-500" />
      )}
    </button>
  )
}

function ChatBubble({ message, request, isPending }) {
  const isManager = supportMessageSide(message) === 'manager'
  const isQueued = message.metadata?.queued === true || isPending
  const messages = normalizeSupportMessages(request)
  const readMessageId = request?.front_desk_read_message_id
  const isRead = isManager && !isQueued && readMessageId && (() => {
    const readIndex = messages.findIndex((m) => m.id === readMessageId)
    if (readIndex < 0) return false
    const msgIndex = messages.findIndex((m) => m.id === message.id)
    return msgIndex >= 0 && msgIndex <= readIndex
  })()

  return (
    <div className={`flex ${isManager ? 'justify-end' : 'justify-start'}`}>
      <div className={`max-w-[84%] rounded-2xl px-3 py-2 ${
        isPending ? 'border border-dashed border-green-500/40 bg-green-800/60 text-white' :
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
        {isManager && (
          <p className="mt-1 text-[10px] text-green-200/60 text-right">
            {isQueued ? 'Waiting for connection' : isRead ? 'Read' : 'Sent'}
          </p>
        )}
      </div>
    </div>
  )
}

function PendingMessageBubble({ item }) {
  const payload = item.payload || {}
  const body = payload.body || ''
  return (
    <div className="flex justify-end">
      <div className="max-w-[84%] rounded-2xl rounded-br-md border border-dashed border-green-500/40 bg-green-800/60 px-3 py-2 text-white">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-green-100">You</p>
        <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed">{body}</p>
        <p className="mt-1 text-[10px] text-green-200/60 text-right">Waiting for connection</p>
      </div>
    </div>
  )
}

function PendingConversationBubble({ item }) {
  const payload = item.payload || {}
  const title = payload.title || 'New conversation'
  const description = payload.description || ''
  return (
    <div className="rounded-2xl border border-dashed border-green-500/30 bg-green-900/20 px-4 py-3">
      <p className="text-xs font-semibold text-green-300">{title}</p>
      <p className="mt-1 text-xs text-gray-400 line-clamp-2">{description}</p>
      <p className="mt-1.5 text-[10px] text-green-400/60">Waiting for connection · {shortDateTime(item.createdAt || new Date().toISOString())}</p>
    </div>
  )
}

export default function Control() {
  const { user } = useAuth()
  const { features } = useFeatures()
  const { showToast } = useToast()
  const { conversations, loading: inboxLoading, error: inboxError, refreshFresh, updateConversation } = useInbox()
  const [loadError, setLoadError] = useState('')
  const [selectedId, setSelectedId] = useState('')
  const [startingNew, setStartingNew] = useState(false)
  const [newMessage, setNewMessage] = useState('')
  const [replyDraft, setReplyDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [queueHealth, setQueueHealth] = useState(() => null)
  const messagesEndRef = useRef(null)
  const textareaRef = useRef(null)
  const acknowledgedMessagesRef = useRef(new Set())
  const pwaDisabled = Object.keys(features).length > 0 && features.pwa !== true

  const filteredConversations = useMemo(() => {
    if (!searchQuery.trim()) return conversations
    const q = searchQuery.toLowerCase()
    return conversations.filter((request) => {
      const title = (request.title || '').toLowerCase()
      const desc = (request.description || '').toLowerCase()
      const messages = normalizeSupportMessages(request)
      const hasMatchingMessage = messages.some((m) => (m.body || '').toLowerCase().includes(q))
      return title.includes(q) || desc.includes(q) || hasMatchingMessage
    })
  }, [conversations, searchQuery])

  const activeRequest = useMemo(() => {
    if (selectedId) return conversations.find((c) => c.id === selectedId) || null
    return null
  }, [conversations, selectedId])

  const activeMessages = useMemo(
    () => activeRequest ? normalizeSupportMessages(activeRequest) : [],
    [activeRequest]
  )

  const pendingMessages = useMemo(() => {
    if (!user?.lodge_id) return []
    const queue = getOfflineQueue(user.lodge_id)
    if (!activeRequest) return queue.filter((item) => item.type === 'support/create')
    return queue.filter((item) => item.type === 'support/message' && item.payload?.ticket_id === activeRequest.id)
  }, [user?.lodge_id, activeRequest])

  const pendingNewConversations = useMemo(() => {
    if (!user?.lodge_id || activeRequest) return []
    const queue = getOfflineQueue(user.lodge_id)
    return queue.filter((item) => item.type === 'support/create')
  }, [user?.lodge_id, activeRequest])

  const load = useCallback(async () => {
    if (pwaDisabled || !user?.lodge_id) return
    try {
      setLoadError('')
      const health = getPwaQueueHealth(user.lodge_id)
      setQueueHealth(health)
      const isOnline = typeof navigator !== 'undefined' && navigator.onLine !== false
      if (isOnline) {
        publishPwaHealth(user.lodge_id, supabase, health)
      }
    } catch (error) {
      setLoadError(error?.message || 'Inbox could not load.')
    }
  }, [pwaDisabled, user?.lodge_id])

  useEffect(() => {
    if (pwaDisabled) return undefined
    load()
    const unsubscribe = subscribeRuntimeEvent('boroko:pwa-queue', load)
    const unsubscribeIssues = subscribeRuntimeEvent('boroko:pwa-issues', load)
    return () => {
      unsubscribe?.()
      unsubscribeIssues?.()
    }
  }, [load, pwaDisabled])

  useEffect(() => {
    if (!activeRequest?.id || !user?.lodge_id || activeRequest.manager_has_unread === false) return
    const latestDeskMessage = [...activeMessages].reverse().find((message) => supportMessageSide(message) === 'desk')
    if (!latestDeskMessage?.id) return

    const acknowledgementKey = `${activeRequest.id}:${latestDeskMessage.id}`
    if (acknowledgedMessagesRef.current.has(acknowledgementKey)) return
    acknowledgedMessagesRef.current.add(acknowledgementKey)

    markSupportRequestRead(user.lodge_id, activeRequest.id, 'manager', latestDeskMessage.id)
      .then(() => {
        updateConversation(activeRequest.id, {
          manager_has_unread: false,
          manager_read_message_id: latestDeskMessage.id,
          manager_read_at: new Date().toISOString()
        })
        markPwaNotificationReadBySourceKey(
          user.lodge_id,
          getFrontDeskNotificationSourceKey(activeRequest)
        )
      })
      .catch(() => {
        acknowledgedMessagesRef.current.delete(acknowledgementKey)
      })
  }, [activeMessages, activeRequest, updateConversation, user?.lodge_id])

  useEffect(() => {
    if (activeRequest) {
      window.setTimeout(() => {
        messagesEndRef.current?.scrollIntoView({ block: 'end', behavior: 'smooth' })
      }, 80)
    }
  }, [activeMessages.length, activeRequest, pendingMessages.length])

  if (pwaDisabled) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center px-6">
        <div className="w-full max-w-md text-center">
          <div className="text-5xl mb-4">🔒</div>
          <h1 className="text-xl font-bold text-white">Pro Plan Required</h1>
          <p className="text-sm text-gray-400 mt-2">Inbox is part of the Manager Mobile App, which requires the Pro plan.</p>
        </div>
      </div>
    )
  }

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
      refreshFresh()
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
      refreshFresh()
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
      refreshFresh()
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

  const showThread = activeRequest || startingNew

  return (
    <div className="min-h-screen bg-gray-950 pb-24">
      {showThread ? (
        <div className="min-h-screen bg-gray-950 flex flex-col">
          <div className="bg-gray-900 px-3 pt-2 pb-3 border-b border-white/10">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => { setSelectedId(''); setStartingNew(false); setReplyDraft(''); }}
                className="p-2 text-gray-400 rounded-full hover:bg-white/5"
                aria-label="Back to conversations"
              >
                <ArrowLeft size={18} />
              </button>
              <div className="min-w-0 flex-1">
                {startingNew ? (
                  <p className="text-sm font-semibold text-white">New chat</p>
                ) : activeRequest ? (
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-white">{activeRequest.title}</p>
                    <p className="text-[10px] text-gray-500">
                      {activeRequest.requester_name ? `${activeRequest.requester_name} · ` : ''}{shortDateTime(conversationTimestamp(activeRequest))}
                    </p>
                  </div>
                ) : null}
              </div>
              {!startingNew && activeRequest && (
                <span className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold ${statusTone(activeRequest.status)}`}>
                  {titleCase(activeRequest.status || 'open')}
                </span>
              )}
            </div>
          </div>

          {startingNew ? (
            <div className="flex-1 flex flex-col">
              <div className="flex-1 overflow-y-auto px-4 py-6">
                <div className="text-center text-sm text-gray-500">
                  <MessageCircle size={28} className="mx-auto text-gray-600 mb-3" />
                  <p className="font-semibold text-white mb-1">Start a new conversation</p>
                  <p className="text-xs">Write your first message below. Front desk will see it on desktop.</p>
                </div>
              </div>
              <div className="border-t border-white/10 bg-gray-900 p-3">
                <div className="rounded-2xl border border-white/10 bg-gray-950 p-2">
                  <textarea
                    ref={textareaRef}
                    className="w-full resize-none rounded-xl border border-gray-800 bg-gray-900 px-3 py-2 text-sm text-white placeholder-gray-500 min-h-[40px] max-h-[120px]"
                    style={{ height: 'auto' }}
                    onInput={(e) => { e.target.style.height = 'auto'; e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px'; }}
                    placeholder="Message front desk..."
                    value={newMessage}
                    onChange={(event) => setNewMessage(event.target.value)}
                    maxLength={1200}
                    rows={1}
                  />
                  <div className="mt-2 flex justify-end">
                    <button
                      type="button"
                      onClick={startConversation}
                      disabled={sending || !newMessage.trim()}
                      className="inline-flex items-center gap-2 rounded-xl bg-green-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                    >
                      <Send size={14} /> {sending ? 'Sending...' : 'Send'}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ) : activeRequest ? (
            <div className="flex-1 flex flex-col">
              <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
                {activeMessages.map((message) => (
                  <ChatBubble key={message.id} message={message} request={activeRequest} />
                ))}
                {pendingMessages.map((item) => (
                  <PendingMessageBubble key={`pending-${item.id}`} item={item} />
                ))}
                <div ref={messagesEndRef} />
              </div>

              <div className="border-t border-white/10 bg-gray-900 p-3">
                <div className="rounded-2xl border border-white/10 bg-gray-950 p-2">
                  <textarea
                    ref={textareaRef}
                    className="w-full resize-none rounded-xl border border-gray-800 bg-gray-900 px-3 py-2 text-sm text-white placeholder-gray-500 min-h-[40px] max-h-[120px]"
                    style={{ height: 'auto' }}
                    onInput={(e) => { e.target.style.height = 'auto'; e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px'; }}
                    placeholder="Reply to front desk..."
                    value={replyDraft}
                    onChange={(event) => setReplyDraft(event.target.value)}
                    maxLength={1000}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' && !event.shiftKey) {
                        event.preventDefault()
                        sendReply()
                      }
                    }}
                    rows={1}
                  />
                  <div className="mt-2 flex justify-end">
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
            </div>
          ) : null}
        </div>
      ) : (
        <>
          <div className="bg-gray-900 px-4 pt-2 pb-3">
            <div className="flex items-center justify-between gap-3">
              <h1 className="text-lg font-bold text-white">Inbox</h1>
              <button type="button" onClick={() => refreshFresh()} className="p-2 text-gray-400" aria-label="Refresh inbox">
                <RefreshCw size={18} className={inboxLoading ? 'animate-spin' : ''} />
              </button>
            </div>
            <div className="mt-2 relative">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
              <input
                type="text"
                placeholder="Search chats..."
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                className="w-full rounded-xl bg-gray-950 border border-white/10 pl-9 pr-3 py-2.5 text-sm text-white placeholder-gray-500"
              />
              {searchQuery && (
                <button onClick={() => setSearchQuery('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500">
                  <X size={14} />
                </button>
              )}
            </div>
          </div>

          <div className="px-4 py-3">
            {(loadError || inboxError) && (
              <div className="mb-3 rounded-2xl border border-red-900 bg-red-950/40 px-4 py-3 text-sm text-red-200">
                {loadError || inboxError}
              </div>
            )}

            <div className="flex items-center justify-between mb-2">
              <p className="text-xs text-gray-500">{filteredConversations.length + pendingNewConversations.length} conversation{(filteredConversations.length + pendingNewConversations.length) === 1 ? '' : 's'}</p>
              <button
                type="button"
                onClick={() => { setStartingNew(true); setSelectedId(''); }}
                className="inline-flex items-center gap-1.5 rounded-full bg-green-700 px-3 py-1.5 text-xs font-semibold text-white"
              >
                <Plus size={13} /> New chat
              </button>
            </div>

            {inboxLoading && conversations.length === 0 ? (
              <div className="flex justify-center py-12">
                <div className="w-8 h-8 border-2 border-green-500 border-t-transparent rounded-full animate-spin" />
              </div>
            ) : filteredConversations.length > 0 || pendingNewConversations.length > 0 ? (
              <div className="rounded-2xl border border-white/10 bg-gray-900 overflow-hidden">
                {pendingNewConversations.map((item) => (
                  <div key={`pending-new-${item.id}`} className="px-3 py-3 border-b border-white/5">
                    <PendingConversationBubble item={item} />
                  </div>
                ))}
                {filteredConversations.map((request) => (
                  <ConversationRow
                    key={request.id}
                    request={request}
                    onSelect={() => {
                      setStartingNew(false)
                      setSelectedId(request.id)
                      setReplyDraft('')
                    }}
                  />
                ))}
              </div>
            ) : searchQuery ? (
              <div className="text-center py-12">
                <Search size={28} className="mx-auto text-gray-600 mb-3" />
                <p className="text-sm font-semibold text-white">No results</p>
                <p className="text-xs text-gray-500 mt-1">Try a different search term.</p>
              </div>
            ) : (
              <div className="text-center py-12">
                <MessageCircle size={28} className="mx-auto text-gray-600 mb-3" />
                <p className="text-sm font-semibold text-white">No chats yet</p>
                <p className="text-xs text-gray-500 mt-1 mb-4">Start a message and front desk will see it on desktop.</p>
                <button
                  type="button"
                  onClick={() => { setStartingNew(true); setSelectedId(''); }}
                  className="inline-flex items-center gap-1.5 rounded-full bg-green-700 px-4 py-2 text-xs font-semibold text-white"
                >
                  <Plus size={13} /> Start a chat
                </button>
              </div>
            )}

            <section className="mt-4 rounded-2xl border border-white/10 bg-gray-900 px-4 py-3">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="flex items-center gap-2 text-sm font-semibold text-white">
                    {navigator.onLine ? <Wifi size={16} className="text-green-400" /> : <WifiOff size={16} className="text-red-400" />}
                    {navigator.onLine ? 'Online' : 'Offline'}
                  </p>
                  <p className="mt-1 text-xs text-gray-500">
                    {queueHealth?.queueLength > 0
                      ? `${queueHealth.queueLength} saved item${queueHealth.queueLength === 1 ? '' : 's'} waiting to send`
                      : 'No saved messages waiting to send'}
                  </p>
                  <p className="mt-0.5 text-[10px] text-gray-600">this device only</p>
                </div>
                {queueHealth?.queueLength > 0 && (
                  <button
                    type="button"
                    onClick={syncNow}
                    className="shrink-0 rounded-xl border border-white/10 bg-gray-800 px-3 py-2 text-xs font-semibold text-white"
                  >
                    Sync now
                  </button>
                )}
              </div>
            </section>
          </div>
        </>
      )}
    </div>
  )
}
