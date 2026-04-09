import { useEffect, useState } from 'react'
import { AlertCircle, CheckCircle, Info, X } from 'lucide-react'

/**
 * P3-2: Toast notification system for user feedback
 * Provides non-intrusive notifications for success, error, and info messages
 */
export function Toast({ message, type = 'info', duration = 4000, onClose }) {
  const [isExiting, setIsExiting] = useState(false)

  useEffect(() => {
    if (duration === 0) return // Manual dismiss only

    const timer = setTimeout(() => {
      setIsExiting(true)
      setTimeout(onClose, 300)
    }, duration)

    return () => clearTimeout(timer)
  }, [duration, onClose])

  const icons = {
    success: <CheckCircle size={20} className="text-emerald-600" />,
    error: <AlertCircle size={20} className="text-red-600" />,
    info: <Info size={20} className="text-blue-600" />
  }

  const backgrounds = {
    success: 'bg-emerald-50 border-emerald-200',
    error: 'bg-red-50 border-red-200',
    info: 'bg-blue-50 border-blue-200'
  }

  const textColors = {
    success: 'text-emerald-800',
    error: 'text-red-800',
    info: 'text-blue-800'
  }

  return (
    <div
      className={`transform transition-all duration-300 ${isExiting ? 'opacity-0 translate-x-4' : 'opacity-100 translate-x-0'}`}
    >
      <div className={`flex items-center gap-3 px-4 py-3 rounded-lg border ${backgrounds[type]}`}>
        {icons[type]}
        <p className={`text-sm font-medium ${textColors[type]}`}>{message}</p>
        <button
          onClick={() => {
            setIsExiting(true)
            setTimeout(onClose, 300)
          }}
          className="ml-auto text-slate-400 hover:text-slate-600"
        >
          <X size={16} />
        </button>
      </div>
    </div>
  )
}

/**
 * Toast container component - place at top-right of app
 */
export function ToastContainer({ toasts }) {
  return (
    <div className="fixed top-4 right-4 z-50 space-y-2 max-w-sm pointer-events-auto">
      {toasts.map((toast) => (
        <Toast key={toast.id} {...toast} />
      ))}
    </div>
  )
}
