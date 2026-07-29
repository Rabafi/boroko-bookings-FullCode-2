/**
 * Shared ops-first Hotel onboarding chrome.
 * Matches hotelTheme.css tokens so Login / Welcome / Setup / Chooser / App
 * guards use the same copper ops palette (not magazine/editorial).
 */

export const HOTEL_CHROME = Object.freeze({
  // Surfaces
  shell:
    'min-h-screen bg-[radial-gradient(circle_at_top_left,rgba(184,115,74,0.12),transparent_28%),radial-gradient(circle_at_top_right,rgba(232,213,192,0.32),transparent_24%),linear-gradient(180deg,#f0ebe4_0%,#f7f3ed_52%,#e6dfd5_100%)]',
  shellFlex: 'flex items-center justify-center p-4',
  shellFlexPad: 'flex items-center justify-center px-6 py-10',
  card:
    'w-full max-w-md overflow-hidden rounded-2xl border border-[rgba(42,33,26,0.1)] bg-[#fffcf8] shadow-[0_18px_48px_rgba(42,33,26,0.1)]',
  cardWide:
    'w-full max-w-4xl overflow-hidden rounded-2xl border border-[rgba(42,33,26,0.1)] bg-[#fffcf8] shadow-[0_18px_48px_rgba(42,33,26,0.1)]',
  cardSetup:
    'w-full max-w-lg overflow-hidden rounded-2xl border border-[rgba(42,33,26,0.1)] bg-[#fffcf8] shadow-[0_18px_48px_rgba(42,33,26,0.1)]',
  header:
    'border-b border-[rgba(42,33,26,0.08)] bg-gradient-to-b from-[#fffcf8] to-[#f7f3ed] px-8 py-5 text-[#1f1814]',
  headerCenter: 'mb-7 text-center',

  // Brand mark
  mark:
    'grid h-12 w-12 place-items-center rounded-xl border border-[rgba(184,115,74,0.4)] bg-[rgba(184,115,74,0.1)] text-xs font-extrabold tracking-[0.12em] text-[#935a36]',
  markLg:
    'mx-auto mb-5 grid h-16 w-16 place-items-center rounded-xl border border-[rgba(184,115,74,0.4)] bg-[rgba(184,115,74,0.1)] text-sm font-extrabold tracking-[0.14em] text-[#935a36]',
  markXl:
    'mx-auto mb-5 grid h-20 w-20 place-items-center rounded-xl border border-[rgba(184,115,74,0.4)] bg-[rgba(184,115,74,0.1)] text-sm font-extrabold tracking-[0.14em] text-[#935a36] shadow-[0_12px_28px_rgba(42,33,26,0.08)]',

  // Type
  brandLabel: 'text-[11px] font-bold uppercase tracking-[0.16em] text-[#935a36]',
  brandSub: 'text-sm text-[#7a6a5c]',
  brandTitle: 'text-xl font-bold tracking-[-0.02em] text-[#1f1814]',
  title: 'text-2xl font-bold tracking-[-0.02em] text-[#1f1814]',
  kicker: 'text-xs font-semibold uppercase tracking-[0.16em] text-[#935a36]',
  mute: 'text-[#7a6a5c]',
  ink: 'text-[#1f1814]',
  copper: 'text-[#b8734a]',
  copperDeep: 'text-[#935a36]',
  link: 'text-[#935a36] hover:text-[#7a4828]',

  // Panels / chips
  softPanel: 'rounded-xl border border-[rgba(184,115,74,0.28)] bg-[rgba(184,115,74,0.08)]',
  softPanelBorder: 'border-[rgba(184,115,74,0.28)]',
  softPanelBg: 'bg-[rgba(184,115,74,0.08)]',
  badge: 'bg-[rgba(184,115,74,0.12)] text-[#935a36]',
  selectOn: 'border-[#b8734a] bg-[rgba(184,115,74,0.1)] ring-1 ring-[rgba(184,115,74,0.25)]',
  selectOff:
    'border-[rgba(42,33,26,0.1)] bg-white/80 hover:border-[rgba(184,115,74,0.45)] hover:bg-[rgba(184,115,74,0.05)]',
  selectIconOn: 'bg-[rgba(184,115,74,0.14)] text-[#935a36]',
  selectTextOn: 'text-[#1f1814]',

  // Controls
  primaryBtn:
    'inline-flex items-center justify-center gap-2 rounded-[10px] bg-[#b8734a] px-4 py-2.5 font-semibold text-[#fffaf5] shadow-[0_8px_18px_rgba(184,115,74,0.22)] transition-colors hover:bg-[#a5633d] disabled:opacity-60',
  secondaryBtn:
    'inline-flex items-center justify-center gap-2 rounded-[10px] border border-[rgba(42,33,26,0.14)] bg-[#fffcf8] px-4 py-2.5 font-semibold text-[#1f1814] transition-colors hover:border-[rgba(184,115,74,0.4)] hover:bg-[rgba(184,115,74,0.06)]',
  useBtn:
    'inline-flex flex-shrink-0 items-center justify-center gap-2 rounded-[10px] bg-[#b8734a] px-4 py-2 font-semibold text-[#fffaf5] shadow-[0_8px_16px_rgba(184,115,74,0.2)] transition-colors hover:bg-[#a5633d] disabled:opacity-60 ml-3',
  stepOn: 'rounded-[10px] bg-[#b8734a] text-white',
  stepOnRing: 'rounded-[10px] bg-[#b8734a] text-white ring-4 ring-[rgba(184,115,74,0.18)]',
  stepLabel: 'text-[#935a36]',
  stepBar: 'bg-[#b8734a]',
  yesOn: 'rounded-[10px] bg-[#b8734a] text-white shadow-sm',
  uploadHover: 'hover:border-[#b8734a] hover:bg-[rgba(184,115,74,0.08)]',
  radius: 'rounded-[10px]',
  icon: 'text-[#935a36]',
  draftKicker: 'text-[#935a36]',
  draftMeta: 'text-[#7a6a5c]',
  subtitle: 'text-sm text-[#7a6a5c] mt-1',

  // Copy
  productLine: 'Front desk · Operations',
  opsLine: 'Hotel operations',
  setupSub: 'Property setup',
  chooserSub: 'Hotel profiles on this PC',
  loadingLine: 'Loading hotel workspace…'
})

/** Convenience: shell + flex centering */
export function hotelShellClass(extra = '') {
  return `${HOTEL_CHROME.shell} ${extra}`.trim()
}
