import { useEffect, useRef, useState, useCallback } from 'react'

/**
 * Swipe gesture hook for touch devices.
 * Pass `onLeft` for next and `onRight` for previous.
 */
export function useSwipe({ onLeft, onRight }) {
  const touchStart = useRef(null)
  const touchEnd = useRef(null)
  const minSwipeDistance = 40

  const onTouchStart = useCallback((e) => {
    touchEnd.current = null
    touchStart.current = e.targetTouches[0].clientX
  }, [])

  const onTouchMove = useCallback((e) => {
    touchEnd.current = e.targetTouches[0].clientX
  }, [])

  const onTouchEnd = useCallback(() => {
    if (!touchStart.current || !touchEnd.current) return
    const distance = touchStart.current - touchEnd.current
    const isLeftSwipe = distance > minSwipeDistance
    const isRightSwipe = distance < -minSwipeDistance
    if (isLeftSwipe) onLeft?.()
    if (isRightSwipe) onRight?.()
  }, [onLeft, onRight])

  return { onTouchStart, onTouchMove, onTouchEnd }
}

/**
 * Detect virtual keyboard open on mobile and hide fixed elements.
 */
export function useKeyboardVisibility() {
  const [keyboardOpen, setKeyboardOpen] = useState(false)

  useEffect(() => {
    if (typeof window === 'undefined' || !window.visualViewport) return

    const handleResize = () => {
      const vv = window.visualViewport
      const isOpen = vv.height < window.innerHeight - 100
      setKeyboardOpen(isOpen)
    }

    window.visualViewport.addEventListener('resize', handleResize)
    return () => window.visualViewport.removeEventListener('resize', handleResize)
  }, [])

  return keyboardOpen
}

/**
 * Focus a ref element on mount (or when deps change).
 * Useful for resetting focus on route changes.
 */
export function useFocusOnMount(ref, deps = []) {
  useEffect(() => {
    if (ref.current) {
      ref.current.focus()
      // Ensure focus is visible for accessibility
      ref.current.setAttribute('tabIndex', '-1')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
}

/**
 * Persist form state to sessionStorage so it survives refreshes.
 */
export function useSessionForm(key, initialState) {
  const [form, setForm] = useState(() => {
    try {
      const raw = window.sessionStorage.getItem(key)
      if (raw) {
        const parsed = JSON.parse(raw)
        return { ...initialState, ...parsed }
      }
    } catch {
      // ignore
    }
    return initialState
  })

  useEffect(() => {
    try {
      window.sessionStorage.setItem(key, JSON.stringify(form))
    } catch {
      // ignore
    }
  }, [key, form])

  return [form, setForm]
}

/**
 * Trap focus inside a container element (e.g., modal or lightbox).
 * Returns a ref to attach to the container.
 */
export function useFocusTrap(isActive) {
  const containerRef = useRef(null)
  const previousActiveElement = useRef(null)

  useEffect(() => {
    if (!isActive) return

    previousActiveElement.current = document.activeElement

    const container = containerRef.current
    if (!container) return

    // Focus the first focusable element
    const focusable = container.querySelectorAll(
      'a[href], button, input, textarea, select, [tabindex]:not([tabindex="-1"])'
    )
    const first = focusable[0]
    const last = focusable[focusable.length - 1]

    if (first) {
      first.focus()
    }

    const handleKeyDown = (e) => {
      if (e.key !== 'Tab') return
      if (focusable.length === 0) {
        e.preventDefault()
        return
      }
      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault()
          last.focus()
        }
      } else {
        if (document.activeElement === last) {
          e.preventDefault()
          first.focus()
        }
      }
    }

    container.addEventListener('keydown', handleKeyDown)
    return () => {
      container.removeEventListener('keydown', handleKeyDown)
      if (previousActiveElement.current) {
        previousActiveElement.current.focus()
      }
    }
  }, [isActive])

  return containerRef
}

/**
 * Scroll to and focus the first element matching a selector.
 */
export function useScrollToError() {
  return useCallback((selector = '.input-error, [aria-invalid="true"]') => {
    const el = document.querySelector(selector)
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      el.focus()
    }
  }, [])
}

/**
 * Persist route-level state to sessionStorage so it survives refreshes.
 */
export function useSessionState(key, state) {
  useEffect(() => {
    if (state !== undefined && state !== null) {
      try {
        window.sessionStorage.setItem(key, JSON.stringify(state))
      } catch {
        // ignore
      }
    }
  }, [key, state])
}

/**
 * Read state from sessionStorage by key.
 */
export function readSessionState(key) {
  try {
    const raw = window.sessionStorage.getItem(key)
    if (raw) return JSON.parse(raw)
  } catch {
    // ignore
  }
  return null
}

/**
 * Clear a sessionStorage key.
 */
export function clearSessionState(key) {
  try {
    window.sessionStorage.removeItem(key)
  } catch {
    // ignore
  }
}
