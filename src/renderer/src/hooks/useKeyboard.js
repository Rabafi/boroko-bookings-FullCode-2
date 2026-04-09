import { useEffect } from 'react'

/**
 * P3-8: useKeyboard hook for keyboard shortcuts
 * Provides common shortcuts like Escape, Enter, etc.
 */
export function useKeyboard(shortcuts) {
  useEffect(() => {
    const handleKeyDown = (e) => {
      // Escape key
      if (e.key === 'Escape' && shortcuts.onEscape) {
        e.preventDefault()
        shortcuts.onEscape()
        return
      }

      // Enter key (when not in textarea)
      if (e.key === 'Enter' && !e.shiftKey && e.target.tagName !== 'TEXTAREA' && shortcuts.onEnter) {
        e.preventDefault()
        shortcuts.onEnter()
        return
      }

      // Ctrl+S or Cmd+S for save
      if ((e.ctrlKey || e.metaKey) && e.key === 's' && shortcuts.onSave) {
        e.preventDefault()
        shortcuts.onSave()
        return
      }

      // Ctrl+Z or Cmd+Z for undo
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && shortcuts.onUndo) {
        e.preventDefault()
        shortcuts.onUndo()
        return
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [shortcuts])
}
