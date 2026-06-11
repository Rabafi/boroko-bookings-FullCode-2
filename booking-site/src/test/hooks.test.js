import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import {
  useSwipe,
  useKeyboardVisibility,
  useSessionForm,
  useFocusTrap,
  readSessionState,
  clearSessionState
} from '../lib/hooks.js'
import { useState } from 'react'

describe('useSwipe', () => {
  it('calls onLeft when swiping left', () => {
    const onLeft = vi.fn()
    const onRight = vi.fn()
    const { result } = renderHook(() => useSwipe({ onLeft, onRight }))

    act(() => {
      result.current.onTouchStart({ targetTouches: [{ clientX: 200 }] })
    })
    act(() => {
      result.current.onTouchMove({ targetTouches: [{ clientX: 100 }] })
    })
    act(() => {
      result.current.onTouchEnd()
    })

    expect(onLeft).toHaveBeenCalled()
    expect(onRight).not.toHaveBeenCalled()
  })

  it('calls onRight when swiping right', () => {
    const onLeft = vi.fn()
    const onRight = vi.fn()
    const { result } = renderHook(() => useSwipe({ onLeft, onRight }))

    act(() => {
      result.current.onTouchStart({ targetTouches: [{ clientX: 100 }] })
    })
    act(() => {
      result.current.onTouchMove({ targetTouches: [{ clientX: 200 }] })
    })
    act(() => {
      result.current.onTouchEnd()
    })

    expect(onRight).toHaveBeenCalled()
    expect(onLeft).not.toHaveBeenCalled()
  })

  it('does nothing for small movements', () => {
    const onLeft = vi.fn()
    const onRight = vi.fn()
    const { result } = renderHook(() => useSwipe({ onLeft, onRight }))

    act(() => {
      result.current.onTouchStart({ targetTouches: [{ clientX: 100 }] })
    })
    act(() => {
      result.current.onTouchMove({ targetTouches: [{ clientX: 110 }] })
    })
    act(() => {
      result.current.onTouchEnd()
    })

    expect(onLeft).not.toHaveBeenCalled()
    expect(onRight).not.toHaveBeenCalled()
  })
})

describe('useKeyboardVisibility', () => {
  it('returns false initially', () => {
    const { result } = renderHook(() => useKeyboardVisibility())
    expect(result.current).toBe(false)
  })
})

describe('useSessionForm', () => {
  beforeEach(() => {
    window.sessionStorage.clear()
  })

  it('initializes with initialState when no cache exists', () => {
    const { result } = renderHook(() => useSessionForm('test-key', { name: 'Alice' }))
    expect(result.current[0]).toEqual({ name: 'Alice' })
  })

  it('reads from sessionStorage on mount', () => {
    window.sessionStorage.setItem('boroko-booking-public:test-key', JSON.stringify({ savedAt: Date.now(), data: { name: 'Bob' } }))
    // Wait, useSessionForm reads from sessionStorage directly, not via readSessionCache
    // Actually, it uses window.sessionStorage.getItem(key) directly. Let me check the hook.
    // The hook uses `window.sessionStorage.getItem(key)` where key is passed directly.
    // But the test uses a prefixed key? No, the hook doesn't add the prefix in useSessionForm.
    // Wait, looking at hooks.js:
    // export function useSessionForm(key, initialState) {
    //   const [form, setForm] = useState(() => {
    //     try { const raw = window.sessionStorage.getItem(key); ... } catch {} return initialState;
    //   });
    // }
    // So the key is used directly, no prefix.
    window.sessionStorage.setItem('test-key', JSON.stringify({ name: 'Bob' }))
    const { result } = renderHook(() => useSessionForm('test-key', { name: 'Alice' }))
    expect(result.current[0]).toEqual({ name: 'Bob' })
  })

  it('persists to sessionStorage on change', () => {
    const { result } = renderHook(() => useSessionForm('test-key-2', { name: 'Alice' }))
    act(() => {
      result.current[1]({ name: 'Charlie' })
    })
    expect(window.sessionStorage.getItem('test-key-2')).toContain('Charlie')
  })
})

describe('useFocusTrap', () => {
  it('returns a ref object', () => {
    const { result } = renderHook(() => useFocusTrap(false))
    expect(result.current).toHaveProperty('current')
  })
})

describe('readSessionState', () => {
  beforeEach(() => {
    window.sessionStorage.clear()
  })

  it('returns parsed data for valid JSON', () => {
    window.sessionStorage.setItem('my-key', JSON.stringify({ foo: 'bar' }))
    expect(readSessionState('my-key')).toEqual({ foo: 'bar' })
  })

  it('returns null for missing key', () => {
    expect(readSessionState('missing-key')).toBeNull()
  })

  it('returns null for invalid JSON', () => {
    window.sessionStorage.setItem('bad-key', 'not json')
    expect(readSessionState('bad-key')).toBeNull()
  })
})

describe('clearSessionState', () => {
  it('removes a sessionStorage key', () => {
    window.sessionStorage.setItem('remove-me', 'value')
    clearSessionState('remove-me')
    expect(window.sessionStorage.getItem('remove-me')).toBeNull()
  })
})
