import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowRight, Search } from 'lucide-react'
import {
  filterCommandPaletteCommands,
  getSelectedCommand,
  moveCommandPaletteSelection,
  normalizeCommandPaletteIndex,
} from './hposCommandPaletteState'

const EMPTY_COMMANDS = []

export default function HposCommandPalette({ open, onClose, commands, onSelect }) {
  const [query, setQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const inputRef = useRef(null)
  const dialogRef = useRef(null)
  const listRef = useRef(null)
  const previousFocusRef = useRef(null)
  const selectionGuardRef = useRef(false)
  const commandList = Array.isArray(commands) ? commands : EMPTY_COMMANDS
  const filtered = useMemo(
    () => filterCommandPaletteCommands(commandList, query),
    [commandList, query]
  )

  useEffect(() => {
    if (!open) {
      setQuery('')
      setSelectedIndex(0)
      return undefined
    }

    previousFocusRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null
    const focusTimer = window.setTimeout(() => {
      inputRef.current?.focus()
      inputRef.current?.select()
    }, 0)
    const containFocus = (event) => {
      if (!dialogRef.current?.contains(event.target)) inputRef.current?.focus()
    }
    document.addEventListener('focusin', containFocus)

    return () => {
      window.clearTimeout(focusTimer)
      document.removeEventListener('focusin', containFocus)
      const previous = previousFocusRef.current
      previousFocusRef.current = null
      if (previous?.isConnected) {
        window.setTimeout(() => previous.focus(), 0)
      }
    }
  }, [open])

  useEffect(() => {
    if (!open) return undefined
    const handleEscape = (event) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      onClose?.()
    }
    window.addEventListener('keydown', handleEscape)
    return () => window.removeEventListener('keydown', handleEscape)
  }, [onClose, open])

  useEffect(() => {
    setSelectedIndex((current) => normalizeCommandPaletteIndex(current, filtered.length))
  }, [filtered.length])

  useEffect(() => {
    if (!open) return
    const active = listRef.current?.querySelector('[data-command-index="' + selectedIndex + '"]')
    active?.scrollIntoView?.({ block: 'nearest' })
  }, [filtered.length, open, selectedIndex])

  const selectCommand = (command) => {
    if (!command || selectionGuardRef.current) return
    selectionGuardRef.current = true
    onSelect?.(command)
    window.setTimeout(() => {
      selectionGuardRef.current = false
    }, 0)
  }

  const handleDialogKeyDown = (event) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      onClose?.()
      return
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      event.stopPropagation()
      if (!filtered.length) return
      setSelectedIndex((current) => moveCommandPaletteSelection(
        current,
        event.key === 'ArrowDown' ? 1 : -1,
        filtered.length
      ))
      return
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      event.stopPropagation()
      if (!filtered.length) return
      selectCommand(getSelectedCommand(filtered, selectedIndex))
      return
    }
    if (event.key !== 'Tab') return

    const focusable = Array.from(dialogRef.current?.querySelectorAll(
     'input:not([disabled]), button:not([disabled])'
    ) || []).filter((element) => {
      if (element.hidden) return false
      const style = window.getComputedStyle?.(element)
      return !style || (style.display !== 'none' && style.visibility !== 'hidden')
    })
    if (!focusable.length) return
    const currentIndex = focusable.indexOf(document.activeElement)
    const nextIndex = event.shiftKey
      ? (currentIndex <= 0 ? focusable.length - 1 : currentIndex - 1)
      : (currentIndex === focusable.length - 1 ? 0 : currentIndex + 1)
    event.preventDefault()
    focusable[nextIndex]?.focus()
  }

  if (!open) return null

  return <div className="hpos-command-backdrop" onMouseDown={() => onClose?.()}>
    <section
      ref={dialogRef}
      className="hpos-command"
      role="dialog"
      aria-modal="true"
      aria-label="Search Tsa Bonno Restaurant and Bar POS"
      onMouseDown={(event) => event.stopPropagation()}
      onKeyDown={handleDialogKeyDown}
    >
      <div className="hpos-command-search">
        <Search size={19} />
        <input
          ref={inputRef}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value)
            setSelectedIndex(0)
          }}
          placeholder="Go to a workspace or start an action…"
          aria-label="Search commands"
          aria-controls="hpos-command-results"
          aria-activedescendant={filtered.length ? 'hpos-command-result-' + selectedIndex : undefined}
        />
        <kbd>Esc</kbd>
      </div>
      <div
        ref={listRef}
        id="hpos-command-results"
        className="hpos-command-results"
        role="listbox"
        aria-label="Command results"
      >
        {filtered.map((command, index) => {
          const selected = index === selectedIndex
          return <button
            key={(command.route || '') + '-' + (command.label || '') + '-' + index}
            id={'hpos-command-result-' + index}
            type="button"
            role="option"
            aria-selected={selected}
            data-command-index={index}
            className={selected ? 'is-selected is-first' : ''}
            onMouseEnter={() => setSelectedIndex(index)}
            onFocus={() => setSelectedIndex(index)}
            onClick={(event) => {
              event.preventDefault()
              selectCommand(command)
            }}
          >
            <span><small>{command.group || 'Workspace'}</small><strong>{command.label}</strong></span>
            {command.badge != null && <em>{command.badge}</em>}
            <ArrowRight size={15} />
          </button>
        })}
        {!filtered.length && <p role="status">No matching workspace or action.</p>}
      </div>
      <footer><span>↑↓ Move · ↵ Open selected result</span><span>Ctrl/⌘ K Search anywhere</span></footer>
    </section>
  </div>
}
