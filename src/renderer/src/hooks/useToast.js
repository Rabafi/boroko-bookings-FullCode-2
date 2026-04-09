import { useCallback, useState } from 'react'

/**
 * P3-3: useToast hook for managing toast notifications
 * Provides a simple API to show success, error, and info messages
 */
export function useToast() {
  const [toasts, setToasts] = useState([])

  const addToast = useCallback((message, type = 'info', duration = 4000) => {
    const id = crypto.randomUUID()
    setToasts((prev) => [...prev, { id, message, type, duration }])
    return id
  }, [])

  const removeToast = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }, [])

  const success = useCallback((message, duration) => {
    return addToast(message, 'success', duration ?? 3000)
  }, [addToast])

  const error = useCallback((message, duration) => {
    return addToast(message, 'error', duration ?? 5000)
  }, [addToast])

  const info = useCallback((message, duration) => {
    return addToast(message, 'info', duration ?? 4000)
  }, [addToast])

  return {
    toasts,
    addToast,
    removeToast,
    success,
    error,
    info
  }
}
