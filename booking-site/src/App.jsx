import { useEffect, useRef } from 'react'
import { BrowserRouter, useLocation } from 'react-router'
import AppRoutes from './AppRoutes.jsx'

/**
 * Reset focus to the top of the document on route change.
 * This improves accessibility for screen reader users.
 */
function FocusManager() {
  const { pathname } = useLocation()

  useEffect(() => {
    // Small delay to ensure DOM has updated after navigation
    const timeout = setTimeout(() => {
      const main = document.querySelector('main') || document.body
      if (main && main.scrollTo) {
        main.scrollTo(0, 0)
      } else {
        window.scrollTo(0, 0)
      }
      // Focus the first heading or skip link if available
      const target = document.querySelector('h1, h2, h3, [tabindex="-1"]') || document.body
      if (target && target.focus) {
        target.setAttribute('tabIndex', '-1')
        target.focus({ preventScroll: true })
      }
    }, 0)
    return () => clearTimeout(timeout)
  }, [pathname])

  return null
}

export default function App() {
  return (
    <BrowserRouter>
      <FocusManager />
      <AppRoutes />
    </BrowserRouter>
  )
}
