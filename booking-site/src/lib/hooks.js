// @ts-check
import { useEffect, useRef, useState, useCallback } from 'react'

/**
 * Swipe gesture hook for touch devices.
 * Pass `onLeft` for next and `onRight` for previous.
 */
/** @param {{onLeft?:()=>void,onRight?:()=>void}} options */
export function useSwipe({ onLeft, onRight }) {
  const touchStart = useRef(/** @type {number|null} */ (null))
  const touchEnd = useRef(/** @type {number|null} */ (null))
  const minSwipeDistance = 40

  const onTouchStart = useCallback(/** @param {import('react').TouchEvent<HTMLElement>} e */ (e) => {
    touchEnd.current = null
    touchStart.current = e.targetTouches[0].clientX
  }, [])

  const onTouchMove = useCallback(/** @param {import('react').TouchEvent<HTMLElement>} e */ (e) => {
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
      const vv = /** @type {VisualViewport} */ (window.visualViewport)
      const isOpen = vv.height < window.innerHeight - 100
      setKeyboardOpen(isOpen)
    }

    window.visualViewport.addEventListener('resize', handleResize)
    return () => /** @type {VisualViewport} */ (window.visualViewport).removeEventListener('resize', handleResize)
  }, [])

  return keyboardOpen
}

/**
 * Focus a ref element on mount (or when deps change).
 * Useful for resetting focus on route changes.
 */
/** @param {{current:HTMLElement|null}} ref @param {import('react').DependencyList} [deps] */
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
/**
 * @template {Record<string, unknown>} T
 * @param {string} key
 * @param {T} initialState
 * @returns {[T, import('react').Dispatch<import('react').SetStateAction<T>>]}
 */
export function useSessionForm(key, initialState) {
  const [form, setForm] = useState(/** @returns {T} */ () => {
    try {
      const raw = window.sessionStorage.getItem(key)
      if (raw) {
        const parsed = JSON.parse(raw)
        // This is an expected view over persisted session data, not validation.
        return /** @type {T} */ ({ ...initialState, ...parsed })
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
/** @param {boolean} isActive @returns {import('react').RefObject<HTMLElement|null>} */
export function useFocusTrap(isActive) {
  const containerRef = useRef(/** @type {HTMLElement|null} */ (null))
  const previousActiveElement = useRef(/** @type {(Element & {focus():void})|null} */ (null))

  useEffect(() => {
    if (!isActive) return

    previousActiveElement.current = /** @type {(Element & {focus():void})|null} */ (document.activeElement)

    const container = containerRef.current
    if (!container) return

    // Focus the first focusable element
    const focusableElements = /** @type {NodeListOf<HTMLElement>} */ (container.querySelectorAll(
      'a[href], button, input, textarea, select, [tabindex]:not([tabindex="-1"])'
    ))
    const first = focusableElements[0]
    const last = focusableElements[focusableElements.length - 1]

    if (first) {
      first.focus()
    }

    const handleKeyDown = (/** @type {KeyboardEvent} */ e) => {
      if (e.key !== 'Tab') return
      if (focusableElements.length === 0) {
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
    const el = /** @type {HTMLElement|null} */ (document.querySelector(selector))
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      el.focus()
    }
  }, [])
}

/**
 * Persist route-level state to sessionStorage so it survives refreshes.
 */
/** @param {string} key @param {unknown} state */
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
/** @param {string} key @returns {unknown|null} */
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
/** @param {string} key */
export function clearSessionState(key) {
  try {
    window.sessionStorage.removeItem(key)
  } catch {
    // ignore
  }
}
