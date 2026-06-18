import { useState, useCallback, createContext, useContext, useEffect, useRef } from 'react'
import { CheckCircle, AlertTriangle, Info, X } from 'lucide-react'

const ToastContext = createContext(null)

let globalId = 0

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([])

  const addToast = useCallback((message, { type = 'info', duration = 4000 } = {}) => {
    const id = ++globalId
    setToasts(prev => [...prev, { id, message, type }])
    if (duration > 0) {
      setTimeout(() => {
        setToasts(prev => prev.filter(t => t.id !== id))
      }, duration)
    }
    return id
  }, [])

  const removeToast = useCallback((id) => {
    setToasts(prev => prev.filter(t => t.id !== id))
  }, [])

  const toast = useCallback((message, opts) => addToast(message, { type: 'info', ...opts }), [addToast])
  toast.success = (msg, opts) => addToast(msg, { type: 'success', ...opts })
  toast.error = (msg, opts) => addToast(msg, { type: 'error', ...opts })
  toast.warning = (msg, opts) => addToast(msg, { type: 'warning', ...opts })

  return (
    <ToastContext.Provider value={toast}>
      {children}
      <div className="fixed bottom-4 right-4 z-[200] flex flex-col gap-2 pointer-events-none">
        {toasts.map(t => (
          <ToastItem key={t.id} toast={t} onRemove={() => removeToast(t.id)} />
        ))}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast() {
  const ctx = useContext(ToastContext)
  if (!ctx) {
    return (msg, opts) => {
      if (typeof window !== 'undefined') window.alert(msg)
    }
  }
  return ctx
}

const ICON_MAP = {
  success: CheckCircle,
  error: AlertTriangle,
  warning: AlertTriangle,
  info: Info
}

const COLOR_MAP = {
  success: 'bg-green-500/10 border-green-500/30 text-green-300',
  error: 'bg-red-500/10 border-red-500/30 text-red-300',
  warning: 'bg-amber-500/10 border-amber-500/30 text-amber-300',
  info: 'bg-blue-500/10 border-blue-500/30 text-blue-300'
}

const ICON_COLOR_MAP = {
  success: 'text-green-400',
  error: 'text-red-400',
  warning: 'text-amber-400',
  info: 'text-blue-400'
}

function ToastItem({ toast, onRemove }) {
  const [exiting, setExiting] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.animate([
      { opacity: 0, transform: 'translateX(40px)' },
      { opacity: 1, transform: 'translateX(0)' }
    ], { duration: 200, fill: 'forwards' })
  }, [])

  const handleRemove = () => {
    const el = ref.current
    if (el) {
      el.animate([
        { opacity: 1, transform: 'translateX(0)' },
        { opacity: 0, transform: 'translateX(40px)' }
      ], { duration: 150, fill: 'forwards' })
      setTimeout(onRemove, 150)
    } else {
      onRemove()
    }
  }

  const Icon = ICON_MAP[toast.type] || Info

  return (
    <div
      ref={ref}
      className={`pointer-events-auto flex items-start gap-3 px-4 py-3 rounded-xl border shadow-lg backdrop-blur-sm max-w-sm ${COLOR_MAP[toast.type] || COLOR_MAP.info}`}
    >
      <Icon size={16} className={`shrink-0 mt-0.5 ${ICON_COLOR_MAP[toast.type] || ICON_COLOR_MAP.info}`} />
      <p className="text-sm flex-1 min-w-0">{toast.message}</p>
      <button onClick={handleRemove} className="shrink-0 text-gray-500 hover:text-gray-300 mt-0.5"><X size={14} /></button>
    </div>
  )
}
