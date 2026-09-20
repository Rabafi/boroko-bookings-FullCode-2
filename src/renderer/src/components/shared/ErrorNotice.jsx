import { useEffect, useRef } from 'react'
import { friendlyErrorMessage } from './friendlyError'

// App-wide error banner. When a new error appears away from where the
// operator is working (for example a page-top banner while their hands are
// on the buttons below), it brings itself into view instead of staying
// hidden off-screen.
//
// Mount-driven: callers render `{error && <ErrorNotice>...</ErrorNotice>}`,
// so mounting coincides exactly with the error transitioning from empty to
// present. The scroll fires once per new error, never on re-renders.
// Banners that are already visible do not move (block: 'nearest'), and
// banners inside an open dialog do nothing at all by default — the dialog is
// usually already in front of the user, and stealing scroll or focus there
// would yank them out of the field they are typing in. Long scrolling
// dialogs (for example a Till unlock list with dozens of staff) opt back in
// with `scrollInDialog`, which scrolls within the dialog instead.
export function ErrorNotice({ children, className = '', style, testId, role = 'alert', scrollInDialog = false }) {
  const ref = useRef(null)
  useEffect(() => {
    const node = ref.current
    if (!node) return
    if (!scrollInDialog) {
      try {
        if (typeof node.closest === 'function' && node.closest('[role="dialog"], .hpos-modal-backdrop')) return
      } catch {
        /* DOM lookup is best-effort; fall through to scrolling */
      }
    }
    try {
      node.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    } catch {
      /* scrolling is best-effort */
    }
    try {
      node.focus?.({ preventScroll: true })
    } catch {
      /* older shells ignore focus options */
    }
  }, [])
  return (
    <div
      ref={ref}
      tabIndex={-1}
      role={role}
      aria-live={role === 'alert' ? 'assertive' : 'polite'}
      className={className}
      style={style}
      {...(testId ? { 'data-testid': testId } : {})}
    >
      {typeof children === 'string' ? friendlyErrorMessage(children) : children}
    </div>
  )
}
