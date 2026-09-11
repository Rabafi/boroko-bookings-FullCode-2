function commandSearchValues(command = {}) {
  const keywords = Array.isArray(command.keywords) ? command.keywords : [command.keywords]
  return [command.label, command.group, command.route, ...keywords]
    .filter((value) => value !== null && value !== undefined)
    .map((value) => String(value).toLowerCase())
}

export function filterCommandPaletteCommands(commands = [], query = '', limit = 12) {
  const normalizedQuery = String(query ?? '').trim().toLowerCase()
  return (Array.isArray(commands) ? commands : [])
    .filter((command) => normalizedQuery === '' || commandSearchValues(command).some((value) => value.includes(normalizedQuery)))
    .slice(0, limit)
}

export function normalizeCommandPaletteIndex(index, length) {
  if (!Number.isInteger(length) || length <= 0) return 0
  const numericIndex = Number.isInteger(index) ? index : 0
  return ((numericIndex % length) + length) % length
}

export function moveCommandPaletteSelection(index, direction, length) {
  if (!Number.isInteger(length) || length <= 0) return 0
  return normalizeCommandPaletteIndex(normalizeCommandPaletteIndex(index, length) + direction, length)
}

export function getSelectedCommand(commands = [], index = 0) {
  if (!Array.isArray(commands) || commands.length === 0) return null
  return commands[normalizeCommandPaletteIndex(index, commands.length)] || null
}
