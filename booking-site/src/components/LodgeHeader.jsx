import { Globe, Mail, MapPin, MessageCircle, Phone } from 'lucide-react'

function buildWhatsAppUrl(number) {
  const digits = String(number || '').replace(/[^\d]/g, '')
  return digits ? `https://wa.me/${digits}` : null
}

function sanitizeWebsiteUrl(value) {
  if (!value) return null
  try {
    const parsed = new URL(value)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.toString() : null
  } catch {
    return null
  }
}

export default function LodgeHeader({ lodge }) {
  const location = [lodge?.city, lodge?.country].filter(Boolean).join(', ')
  const whatsappUrl = buildWhatsAppUrl(lodge?.whatsapp_number)
  const websiteUrl = sanitizeWebsiteUrl(lodge?.website)
  const quickActions = [
    whatsappUrl ? { key: 'whatsapp', href: whatsappUrl, label: 'WhatsApp', icon: MessageCircle, extra: { target: '_blank', rel: 'noreferrer' }, className: 'border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100' } : null,
    lodge?.phone ? { key: 'phone', href: `tel:${lodge.phone}`, label: 'Call', icon: Phone, className: 'border-[var(--line)] bg-white text-[var(--text)] hover:border-[var(--line-strong)] hover:bg-[var(--surface-soft)]' } : null,
    lodge?.email ? { key: 'email', href: `mailto:${lodge.email}`, label: 'Email', icon: Mail, className: 'border-[var(--line)] bg-white text-[var(--text)] hover:border-[var(--line-strong)] hover:bg-[var(--surface-soft)]' } : null,
    websiteUrl ? { key: 'website', href: websiteUrl, label: 'Website', icon: Globe, extra: { target: '_blank', rel: 'noreferrer' }, className: 'border-[var(--line)] bg-white text-[var(--text)] hover:border-[var(--line-strong)] hover:bg-[var(--surface-soft)]' } : null
  ].filter(Boolean)

  return (
    <header className="sticky top-0 z-20 border-b border-[var(--line)] bg-[rgba(255,253,249,0.88)] backdrop-blur-xl">
      <div className="mx-auto max-w-6xl px-4 py-3 sm:px-6 sm:py-4">
        <div className="flex items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3 sm:gap-4">
          {lodge?.logo ? (
            <img
              src={lodge.logo}
              alt={lodge.lodge_name}
              className="h-12 w-12 rounded-2xl border border-[var(--line)] bg-white object-cover p-1 shadow-sm sm:h-13 sm:w-13"
              loading="eager"
              decoding="async"
            />
          ) : (
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-[var(--line-strong)] bg-[var(--brand-soft)] text-base font-bold text-[var(--brand)] shadow-sm sm:h-13 sm:w-13 sm:text-lg">
              {(lodge?.lodge_name || '?')[0].toUpperCase()}
            </div>
          )}

          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-[0.28em] text-[var(--muted)]">Reservations</p>
            <h1 className="font-display truncate text-lg font-semibold text-[var(--text)] sm:text-2xl">
              {lodge?.lodge_name}
            </h1>
            {location && (
              <p className="mt-1 flex items-center gap-1 text-xs text-[var(--muted)] sm:text-sm">
                <MapPin size={13} />
                <span className="truncate">{location}</span>
              </p>
            )}
          </div>
        </div>

        <div className="hidden items-center gap-2 lg:flex">
          {quickActions.map(({ key, href, label, icon: Icon, extra, className }) => (
            <a key={key} href={href} {...(extra || {})} className={`inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-semibold transition-colors ${className}`}>
              <Icon size={14} />
              {label}
            </a>
          ))}
        </div>
        </div>

        {quickActions.length > 0 && (
          <div className="mt-3 flex gap-2 overflow-x-auto pb-1 lg:hidden">
            {quickActions.map(({ key, href, label, icon: Icon, extra, className }) => (
              <a key={key} href={href} {...(extra || {})} className={`inline-flex shrink-0 items-center gap-2 rounded-full border px-3.5 py-2 text-sm font-semibold transition-colors ${className}`}>
                <Icon size={14} />
                {label}
              </a>
            ))}
          </div>
        )}
      </div>
    </header>
  )
}
