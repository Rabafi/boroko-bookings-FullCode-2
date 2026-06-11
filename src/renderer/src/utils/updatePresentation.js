export function normalizeReleaseNotes(notes) {
  if (!notes) return ''

  if (typeof notes === 'string') {
    return notes.trim()
  }

  if (Array.isArray(notes)) {
    return notes
      .map((entry) => {
        if (typeof entry === 'string') return entry.trim()
        if (!entry || typeof entry !== 'object') return ''
        return String(entry.note || entry.text || entry.name || '').trim()
      })
      .filter(Boolean)
      .join('\n\n')
      .trim()
  }

  if (typeof notes === 'object') {
    return String(notes.note || notes.text || notes.name || '').trim()
  }

  return String(notes).trim()
}

function sanitizeReleaseLine(line) {
  return String(line || '')
    .replace(/^[-*•]\s*/, '')
    .replace(/^\d+\.\s*/, '')
    .replace(/^#{1,6}\s*/, '')
    .replace(/^\s*>\s*/, '')
    .replace(/\[(.*?)\]\((.*?)\)/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/_([^_]+)_/g, '$1')
    .replace(/\r/g, '')
    .trim()
}

export function extractReleaseHighlights(notes, limit = 4) {
  const normalized = normalizeReleaseNotes(notes)
  if (!normalized) return []

  return normalized
    .split(/\r?\n/)
    .map(sanitizeReleaseLine)
    .filter(Boolean)
    .filter((line, index, collection) => collection.indexOf(line) === index)
    .filter((line) => !/^release notes?$/i.test(line))
    .filter((line) => !/^what('?s| is) new$/i.test(line))
    .filter((line) => !/^fixes$/i.test(line))
    .slice(0, limit)
}

export function toReleaseSections(notes) {
  const normalized = normalizeReleaseNotes(notes)
  if (!normalized) return []

  const lines = normalized.split(/\r?\n/)
  const sections = []
  let current = { title: 'Overview', items: [] }

  const pushCurrent = () => {
    if (current.items.length > 0) {
      sections.push(current)
    }
  }

  for (const rawLine of lines) {
    const line = String(rawLine || '').trim()
    if (!line) continue

    const headingMatch = line.match(/^#{1,6}\s+(.+)$/)
    if (headingMatch) {
      pushCurrent()
      current = { title: sanitizeReleaseLine(headingMatch[1]), items: [] }
      continue
    }

    const sanitized = sanitizeReleaseLine(line)
    if (!sanitized) continue
    if (/^release notes?$/i.test(sanitized)) continue

    current.items.push(sanitized)
  }

  pushCurrent()

  if (sections.length === 0) {
    return [
      {
        title: 'Overview',
        items: extractReleaseHighlights(normalized, 8)
      }
    ].filter((section) => section.items.length > 0)
  }

  return sections.map((section) => ({
    ...section,
    items: section.items.filter((item, index, collection) => collection.indexOf(item) === index)
  }))
}

export function formatReleaseDate(value) {
  if (!value) return ''
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return ''

  return parsed.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  })
}
