export const THEME_MODE_KEY = 'bb_theme_mode'
export const LEGACY_DARK_MODE_KEY = 'bb_dark_mode'
export const THEME_MODES = ['light', 'dark', 'system']

export function getStoredThemeMode() {
  const stored = localStorage.getItem(THEME_MODE_KEY)
  if (THEME_MODES.includes(stored)) return stored
  return localStorage.getItem(LEGACY_DARK_MODE_KEY) === 'true' ? 'dark' : 'system'
}

export function resolveThemeMode(mode = getStoredThemeMode()) {
  if (mode === 'dark') return true
  if (mode === 'light') return false
  return window.matchMedia?.('(prefers-color-scheme: dark)')?.matches === true
}

export function applyThemeMode(mode = getStoredThemeMode()) {
  const dark = resolveThemeMode(mode)
  document.documentElement.classList.toggle('dark-mode', dark)
  document.documentElement.dataset.themeMode = mode
  document.documentElement.style.colorScheme = dark ? 'dark' : 'light'
  return dark
}

export function saveThemeMode(mode) {
  const nextMode = THEME_MODES.includes(mode) ? mode : 'system'
  localStorage.setItem(THEME_MODE_KEY, nextMode)
  localStorage.removeItem(LEGACY_DARK_MODE_KEY)
  return applyThemeMode(nextMode)
}
