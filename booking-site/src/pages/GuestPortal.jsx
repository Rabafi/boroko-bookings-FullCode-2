import { useState, useRef, useEffect } from 'react'
import { CalendarDays, MessageCircle, ClipboardList, FileText, CreditCard, LogOut } from 'lucide-react'
import GuestPortalProvider, { useGuestPortal } from '../components/GuestPortalSession.jsx'
import GuestBookingView from '../components/GuestBookingView.jsx'
import GuestMessages from '../components/GuestMessages.jsx'
import GuestRequests from '../components/GuestRequests.jsx'
import GuestDocuments from '../components/GuestDocuments.jsx'
import GuestPayment from '../components/GuestPayment.jsx'

const TABS = [
  { key: 'booking', label: 'My Booking', icon: CalendarDays },
  { key: 'messages', label: 'Messages', icon: MessageCircle },
  { key: 'requests', label: 'Requests', icon: ClipboardList },
  { key: 'documents', label: 'Documents', icon: FileText },
  { key: 'payment', label: 'Payment', icon: CreditCard }
]

function PortalHeader({ activeTab, setActiveTab, session }) {
  const [scrolled, setScrolled] = useState(false)
  const tabsRef = useRef(null)

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8)
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  function handleTabChange(key) {
    setActiveTab(key)
    if (tabsRef.current) {
      const btn = tabsRef.current.querySelector(`[data-tab="${key}"]`)
      if (btn) btn.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' })
    }
  }

  return (
    <header
      className={`sticky top-0 z-30 transition-shadow ${
        scrolled ? 'shadow-md' : 'shadow-sm'
      }`}
      style={{ background: 'linear-gradient(180deg, rgba(255,253,249,0.98) 0%, rgba(255,253,249,0.95) 100%)', backdropFilter: 'blur(18px)' }}
    >
      <div className="mx-auto max-w-2xl px-4 pt-4 pb-0">
        <div className="flex items-center justify-between mb-3">
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-[0.28em] text-[var(--muted)]">Guest Portal</p>
            <h1 className="font-display truncate text-xl font-bold text-[var(--text)]">
              Welcome, {session?.customer_name?.split(' ')[0] || 'Guest'}
            </h1>
          </div>
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--brand-soft)] text-sm font-bold text-[var(--brand)]">
            {(session?.customer_name || 'G')[0].toUpperCase()}
          </div>
        </div>

        <nav ref={tabsRef} className="flex gap-1 overflow-x-auto pb-3" style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}>
          {TABS.map((tab) => {
            const Icon = tab.icon
            const isActive = activeTab === tab.key
            return (
              <button
                key={tab.key}
                data-tab={tab.key}
                onClick={() => handleTabChange(tab.key)}
                className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-4 py-2 text-xs font-bold uppercase tracking-[0.08em] transition-all ${
                  isActive
                    ? 'bg-[var(--brand)] text-white shadow-md'
                    : 'bg-[var(--surface-strong)] text-[var(--muted)] hover:bg-[var(--line)]'
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
                {tab.label}
              </button>
            )
          })}
        </nav>
      </div>
    </header>
  )
}

function PortalContent() {
  const session = useGuestPortal()
  const [activeTab, setActiveTab] = useState('booking')

  return (
    <div className="min-h-screen bg-[var(--bg)]">
      <PortalHeader activeTab={activeTab} setActiveTab={setActiveTab} session={session} />

      <main className="mx-auto max-w-2xl px-4 py-6 pb-16">
        <div className="transition-opacity duration-200">
          {activeTab === 'booking' && <GuestBookingView />}
          {activeTab === 'messages' && <GuestMessages />}
          {activeTab === 'requests' && <GuestRequests />}
          {activeTab === 'documents' && <GuestDocuments />}
          {activeTab === 'payment' && <GuestPayment />}
        </div>

        <footer className="mt-10 text-center">
          <a
            href="/"
            className="inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--muted)] hover:text-[var(--text)] transition-colors"
          >
            <LogOut className="h-3 w-3" />
            Back to booking site
          </a>
        </footer>
      </main>
    </div>
  )
}

export default function GuestPortal() {
  return (
    <GuestPortalProvider>
      <PortalContent />
    </GuestPortalProvider>
  )
}
