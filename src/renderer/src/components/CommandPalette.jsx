import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowRight, CornerDownLeft, Search } from 'lucide-react'

function scoreSearch(item, query) {
  if (!query) return 100

  const q = query.trim().toLowerCase()
  if (!q) return 100

  const haystacks = [
    item.label,
    item.group,
    item.to,
    ...(Array.isArray(item.keywords) ? item.keywords : [])
  ]
    .filter(Boolean)
    .map((value) => String(value).toLowerCase())

  let best = -1
  for (const text of haystacks) {
    if (text === q) best = Math.max(best, 1000)
    else if (text.startsWith(q)) best = Math.max(best, 700 - (text.length - q.length))
    else if (text.includes(q)) best = Math.max(best, 450 - text.indexOf(q))
    else {
      let cursor = 0
      let matched = 0
      for (const char of q) {
        const idx = text.indexOf(char, cursor)
        if (idx === -1) {
          matched = 0
          break
        }
        matched += 1
        cursor = idx + 1
      }
      if (matched === q.length) {
        best = Math.max(best, 180 - (cursor - matched))
      }
    }
  }

  return best
}

function buildResultGroups(items, query) {
  const filtered = items
    .map((item) => ({ ...item, score: scoreSearch(item, query) }))
    .filter((item) => item.score >= 0)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score
      return a.label.localeCompare(b.label)
    })

  const groups = []
  for (const item of filtered) {
    const groupName = item.group || 'Workspace'
    let group = groups.find((entry) => entry.name === groupName)
    if (!group) {
      group = { name: groupName, items: [] }
      groups.push(group)
    }
    group.items.push(item)
  }
  return groups
}

export default function CommandPalette({ open, onClose, items, onSelect, currentPath }) {
  const [query, setQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const inputRef = useRef(null)
  const listRef = useRef(null)

  useEffect(() => {
    if (!open) {
      setQuery('')
      setSelectedIndex(0)
      return
    }

    const frame = window.requestAnimationFrame(() => {
      inputRef.current?.focus()
      inputRef.current?.select()
    })

    return () => window.cancelAnimationFrame(frame)
  }, [open])

  useEffect(() => {
    if (!open) return undefined

    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previousOverflow
    }
  }, [open])

  const groups = useMemo(() => buildResultGroups(items, query), [items, query])
  const flatResults = useMemo(() => groups.flatMap((group) => group.items), [groups])

  useEffect(() => {
    if (selectedIndex > flatResults.length - 1) {
      setSelectedIndex(0)
    }
  }, [flatResults.length, selectedIndex])

  useEffect(() => {
    if (!open) return

    const active = listRef.current?.querySelector(`[data-command-index="${selectedIndex}"]`)
    active?.scrollIntoView({ block: 'nearest' })
  }, [open, selectedIndex, flatResults.length])

  useEffect(() => {
    if (open) onClose()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPath])

  useEffect(() => {
    if (!open) return undefined

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
        return
      }

      if (event.key === 'ArrowDown') {
        event.preventDefault()
        if (!flatResults.length) return
        setSelectedIndex((current) => (current + 1) % flatResults.length)
        return
      }

      if (event.key === 'ArrowUp') {
        event.preventDefault()
        if (!flatResults.length) return
        setSelectedIndex((current) => (current - 1 + flatResults.length) % flatResults.length)
        return
      }

      if (event.key === 'Enter') {
        if (!flatResults.length) return
        event.preventDefault()
        onSelect(flatResults[selectedIndex])
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [flatResults, onClose, onSelect, open, selectedIndex])

  if (!open) return null

  let runningIndex = -1

  return (
    <div className="fixed inset-0 z-[70] bg-slate-950/40 px-4 py-10 backdrop-blur-sm" onClick={onClose}>
      <div
        className="mx-auto flex w-full max-w-3xl flex-col overflow-hidden rounded-[28px] border border-white/60 bg-white/95 shadow-[0_32px_90px_rgba(15,23,42,0.28)]"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="border-b border-slate-200/80 px-5 py-4">
          <div className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50/80 px-4 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.7)]">
            <Search size={18} className="text-slate-500" />
            <input
              ref={inputRef}
              value={query}
              onChange={(event) => {
                setQuery(event.target.value)
                setSelectedIndex(0)
              }}
              placeholder="Search bookings, reports, rooms, guests, settings, and more…"
              className="w-full border-0 bg-transparent p-0 text-[15px] text-slate-900 outline-none placeholder:text-slate-500"
            />
            <span className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-[11px] font-medium text-slate-500">
              ESC
            </span>
          </div>
        </div>

        <div ref={listRef} className="max-h-[60vh] overflow-y-auto px-3 py-3">
          {groups.length > 0 ? (
            <div className="space-y-4">
              {groups.map((group) => (
                <div key={group.name}>
                  <div className="px-3 pb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                    {group.name}
                  </div>
                  <div className="space-y-1">
                    {group.items.map((item) => {
                      runningIndex += 1
                      const isSelected = runningIndex === selectedIndex
                      const Icon = item.icon
                      const isCurrent = currentPath === item.to

                      return (
                        <button
                          key={`${group.name}-${item.to}`}
                          type="button"
                          data-command-index={runningIndex}
                          onMouseEnter={() => setSelectedIndex(runningIndex)}
                          onClick={() => onSelect(item)}
                          title={item.label}
                          className={`flex w-full items-center gap-3 rounded-2xl border px-3.5 py-3 text-left transition-all ${
                            isSelected
                              ? 'border-emerald-200 bg-emerald-50/90 shadow-sm'
                              : 'border-transparent bg-transparent hover:border-slate-200 hover:bg-slate-50'
                          }`}
                        >
                          <div
                            className={`inline-flex h-10 w-10 items-center justify-center rounded-2xl ${
                              isSelected ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600'
                            }`}
                          >
                            <Icon size={17} />
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <span className="truncate text-sm font-semibold text-slate-900">{item.label}</span>
                              {isCurrent && (
                                <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.12em] text-slate-500">
                                  Current
                                </span>
                              )}
                            </div>
                            <div className="mt-1 flex items-center gap-2 text-xs text-slate-500">
                              <span>{item.to}</span>
                              {item.tier && (
                                <>
                                  <span className="text-slate-300">•</span>
                                  <span>{item.tier} plan</span>
                                </>
                              )}
                            </div>
                          </div>
                          <ArrowRight size={16} className={`${isSelected ? 'text-emerald-600' : 'text-slate-400'}`} />
                        </button>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="bb-empty-state min-h-[240px]">
              <div className="inline-flex h-14 w-14 items-center justify-center rounded-[18px] bg-slate-100 text-slate-500">
                <Search size={22} />
              </div>
              <div>
                <p className="text-base font-semibold text-slate-800">No matching workspace pages</p>
                <p className="mt-1 max-w-md text-sm text-slate-500">
                  Try searching for bookings, room grid, reports, guests, staff, inventory, or settings.
                </p>
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between border-t border-slate-200/80 bg-slate-50/80 px-5 py-3 text-xs text-slate-500">
          <div className="flex items-center gap-2">
            <span className="rounded-lg border border-slate-200 bg-white px-2 py-1 font-medium text-slate-600">↑</span>
            <span className="rounded-lg border border-slate-200 bg-white px-2 py-1 font-medium text-slate-600">↓</span>
            <span>Move</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="rounded-lg border border-slate-200 bg-white px-2 py-1 font-medium text-slate-600">
              <CornerDownLeft size={12} />
            </span>
            <span>Open module</span>
          </div>
        </div>
      </div>
    </div>
  )
}
