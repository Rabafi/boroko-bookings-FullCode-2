import { useState, useEffect, useRef } from 'react'
import { Send, MessageCircle, Loader2 } from 'lucide-react'
import { rpc } from '../lib/publicApi.js'
import { useGuestPortal } from './GuestPortalSession.jsx'

export default function GuestMessages() {
  const { token, customer_name } = useGuestPortal()
  const [messages, setMessages] = useState([])
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const [text, setText] = useState('')
  const [error, setError] = useState(null)
  const [sendError, setSendError] = useState(null)
  const listEndRef = useRef(null)
  const inputRef = useRef(null)

  useEffect(() => {
    loadMessages()
  }, [token])

  useEffect(() => {
    if (listEndRef.current) {
      listEndRef.current.scrollIntoView({ behavior: 'smooth' })
    }
  }, [messages])

  async function loadMessages() {
    setLoading(true)
    setError(null)
    try {
      const { data, error: rpcErr } = await rpc('get_guest_messages', { p_token: token })
      if (rpcErr) { setError(rpcErr.message); return }
      if (!data || data.success === false) { setError(data?.error || 'Could not load messages.'); return }
      setMessages(data.messages || [])
    } catch (e) {
      setError(e.message || 'Network error.')
    } finally {
      setLoading(false)
    }
  }

  async function handleSend(e) {
    e.preventDefault()
    const trimmed = text.trim()
    if (!trimmed || sending) return

    setSending(true)
    setSendError(null)
    try {
      const { data, error: rpcErr } = await rpc('send_guest_message', {
        p_token: token,
        p_message: trimmed
      })
      if (rpcErr) { setSendError(rpcErr.message); return }
      if (!data || data.success === false) { setSendError(data?.error || 'Could not send message.'); return }

      setText('')
      await loadMessages()
      inputRef.current?.focus()
    } catch (e) {
      setSendError(e.message || 'Network error.')
    } finally {
      setSending(false)
    }
  }

  if (loading) {
    return (
      <div className="space-y-4">
        {[1, 2, 3].map((i) => (
          <div key={i} className="skeleton h-16 w-full" />
        ))}
      </div>
    )
  }

  if (error && messages.length === 0) {
    return (
      <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-center">
        <p className="text-sm text-red-700">{error}</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col">
      <div className="mb-4 space-y-3">
        {messages.length === 0 && !error ? (
          <div className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-8 text-center">
            <MessageCircle className="mx-auto mb-3 h-10 w-10 text-[var(--muted)]" />
            <p className="text-sm text-[var(--muted)]">No messages yet. Send a message to the property.</p>
          </div>
        ) : (
          messages.map((msg, i) => {
            const isGuest = msg.sender_type === 'guest' || msg.sender === customer_name
            return (
              <div key={msg.id || i} className={`flex ${isGuest ? 'justify-end' : 'justify-start'}`}>
                <div
                  className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${
                    isGuest
                      ? 'bg-[var(--brand)] text-white rounded-br-md'
                      : 'bg-[var(--surface-strong)] text-[var(--text)] rounded-bl-md'
                  }`}
                >
                  <p>{msg.message || msg.content}</p>
                  <p className={`mt-1 text-[10px] font-semibold uppercase tracking-[0.1em] ${isGuest ? 'text-white/60' : 'text-[var(--muted)]'}`}>
                    {msg.created_at ? new Date(msg.created_at).toLocaleString() : ''}
                  </p>
                </div>
              </div>
            )
          })
        )}
        <div ref={listEndRef} />
      </div>

      {sendError && (
        <p className="mb-3 text-xs font-semibold text-[var(--danger)]">{sendError}</p>
      )}

      <form onSubmit={handleSend} className="flex gap-3">
        <input
          ref={inputRef}
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Type your message…"
          maxLength={2000}
          className="guest-input flex-1"
          disabled={sending}
        />
        <button
          type="submit"
          disabled={!text.trim() || sending}
          className="brand-button flex h-[48px] w-[48px] shrink-0 items-center justify-center rounded-full transition-opacity disabled:opacity-40"
        >
          {sending ? <Loader2 className="h-5 w-5 animate-spin" /> : <Send className="h-5 w-5" />}
        </button>
      </form>
    </div>
  )
}
