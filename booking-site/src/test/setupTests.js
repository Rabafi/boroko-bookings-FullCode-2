import { vi } from 'vitest'
import '@testing-library/jest-dom'

// Mock window.matchMedia for responsive component tests
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation((query) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn()
  }))
})

// Mock window.requestIdleCallback / cancelIdleCallback
if (typeof window.requestIdleCallback === 'undefined') {
  Object.defineProperty(window, 'requestIdleCallback', {
    value: (cb) => setTimeout(cb, 1)
  })
  Object.defineProperty(window, 'cancelIdleCallback', {
    value: (id) => clearTimeout(id)
  })
}

// Mock window.visualViewport for keyboard visibility tests
if (!window.visualViewport) {
  Object.defineProperty(window, 'visualViewport', {
    value: {
      height: window.innerHeight,
      width: window.innerWidth,
      scale: 1,
      offsetTop: 0,
      offsetLeft: 0,
      pageTop: 0,
      pageLeft: 0,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn()
    }
  })
}

// Mock navigator.clipboard
Object.defineProperty(navigator, 'clipboard', {
  value: {
    writeText: vi.fn(() => Promise.resolve())
  }
})
