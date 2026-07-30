import { useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, Sparkles, X } from 'lucide-react'
import { useLocation, useNavigate } from 'react-router'
import { useSettings } from '../../app-context'

function safeParseJson(raw, fallback = null) {
  try { return JSON.parse(raw) } catch { return fallback }
}

export default function OpsAiLayer() {
  const navigate = useNavigate()
  const location = useLocation()
  const { settings } = useSettings()
  const [badge, setBadge] = useState(0)
  const [toasts, setToasts] = useState([])
  const lastAlertKeyRef = useRef('')

  const routeKey = location?.pathname || '/'
  const enabled = settings?.assistant_enabled === true

  useEffect(() => {
    if (!window.api?.ai?.onAlert) return
    const unsubscribe = window.api.ai.onAlert((payload) => {
      if (!payload || typeof payload !== 'object') return

      const key = String(payload.key || payload.type || '')
      if (key && key === lastAlertKeyRef.current) return
      lastAlertKeyRef.current = key

      if (payload.badge_delta) {
        setBadge((prev) => Math.max(0, prev + Number(payload.badge_delta || 0)))
      } else if (typeof payload.badge === 'number') {
        setBadge(Math.max(0, Number(payload.badge || 0)))
      } else {
        setBadge((prev) => Math.min(99, prev + 1))
      }

      setToasts((prev) => {
        const next = [...prev, { id: crypto.randomUUID(), ...payload, createdAt: Date.now() }]
        return next.slice(-3)
      })
    })
    return () => unsubscribe?.()
  }, [])

  const visibleToasts = useMemo(() => (
    (toasts || [])
      .filter((t) => Date.now() - Number(t.createdAt || 0) < 12_000)
      .slice(-2)
  ), [toasts])

  useEffect(() => {
    if (!toasts.length) return
    const interval = setInterval(() => {
      setToasts((prev) => prev.filter((t) => Date.now() - Number(t.createdAt || 0) < 12_000))
    }, 1500)
    return () => clearInterval(interval)
  }, [toasts.length])

  if (!enabled || routeKey === '/ai') return null

  return (
    <div className="fixed bottom-5 right-5 z-[9999] pointer-events-none">
      {/* Toast stack */}
      <div className="pointer-events-none flex flex-col gap-2 items-end mb-3">
        {visibleToasts.map((t) => (
          <div
            key={t.id}
            className="pointer-events-auto w-[360px] rounded-[22px] border border-amber-200/80 bg-white/95 shadow-[0_24px_60px_rgba(15,23,42,0.2)] backdrop-blur overflow-hidden"
          >
            <div className="flex items-start gap-3 px-4 py-3">
              <div className="mt-0.5 inline-flex h-9 w-9 items-center justify-center rounded-2xl bg-amber-100 text-amber-700">
                <AlertTriangle size={16} />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-amber-700/80">
                  {t.title || 'Ops alert'}
                </p>
                <p className="mt-1 text-sm font-semibold text-slate-900 leading-5">
                  {t.message || 'Attention needed.'}
                </p>
                {(t.action?.label || t.action?.prompt) && (
                  <button
                    type="button"
                    onClick={() => {
                      setBadge(0)
                      setToasts((prev) => prev.filter((x) => x.id !== t.id))
                      const actionType = t.action?.type || (t.action?.prompt?.includes('unpaid') || t.action?.prompt?.includes('collect') ? 'fix_unpaid' : t.action?.prompt?.includes('overdue') || t.action?.prompt?.includes('checkout') ? 'resolve_overdue' : null)
                      if (actionType) {
                        window.dispatchEvent(new CustomEvent('bb_ai_action', { detail: { type: actionType, label: t.action?.label || t.message || '' } }))
                      } else {
                        navigate('/ai', { state: { initialPrompt: t.action?.prompt || '' } })
                      }
                    }}
                    className="mt-2 inline-flex items-center gap-2 rounded-xl bg-slate-900 px-3 py-2 text-xs font-semibold text-white transition hover:bg-slate-800"
                  >
                    {t.action?.type === 'investigate_fraud' ? 'Open Assistant' : 'Open Guide'}
                  </button>
                )}
              </div>
              <button
                type="button"
                onClick={() => setToasts((prev) => prev.filter((x) => x.id !== t.id))}
                className="inline-flex h-9 w-9 items-center justify-center rounded-xl text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
                aria-label="Dismiss"
              >
                <X size={16} />
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Floating launcher */}
      <button
        type="button"
        onClick={() => {
          setBadge(0)
          navigate('/ai', { state: { from: routeKey } })
        }}
        className="pointer-events-auto relative inline-flex items-center gap-3 rounded-full bg-slate-900 px-4 py-3 text-white shadow-[0_24px_60px_rgba(15,23,42,0.25)] transition hover:bg-slate-800"
        title="Open Tsa Bonno Assistant"
      >
        <div className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-white/10">
          <Sparkles size={16} />
        </div>
        <div className="text-left">
          <div className="text-xs font-semibold uppercase tracking-[0.18em] text-white/70">Assistant</div>
          <div className="text-sm font-semibold leading-tight">Local guide is live</div>
        </div>
        {badge > 0 && (
          <div className="absolute -top-1 -right-1 h-6 min-w-6 px-1.5 rounded-full bg-rose-600 text-white text-xs font-bold inline-flex items-center justify-center shadow">
            {badge > 99 ? '99+' : badge}
          </div>
        )}
      </button>
    </div>
  )
}

