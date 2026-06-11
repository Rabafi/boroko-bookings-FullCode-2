import { useState } from 'react'
import { ChevronDown, HelpCircle } from 'lucide-react'

const defaultFaqs = [
  {
    question: 'How do I make a reservation?',
    answer: 'Choose your check-in and check-out dates, then click "Search rooms." Pick the room that suits you, fill in your details, and send your booking request. The lodge will review it and confirm within 24 hours.'
  },
  {
    question: 'Is my booking confirmed immediately?',
    answer: 'No — your request is sent to the lodge for review. You will receive a confirmation or follow-up message within 24 hours. Your booking reference is saved instantly, so the lodge can see it even before email delivery.'
  },
  {
    question: 'What payment methods do you accept?',
    answer: 'We accept bank transfer, cash on arrival, and mobile money. A 50% deposit is required to confirm your reservation. The remaining balance is due at check-in.'
  },
  {
    question: 'What is your cancellation policy?',
    answer: 'Cancellations made 7 or more days before check-in receive a full refund. Cancellations within 7 days of check-in forfeit the deposit. No-shows are charged the full stay amount.'
  },
  {
    question: 'What are the check-in and check-out times?',
    answer: 'Check-in is from 14:00 (2 PM) and check-out is by 11:00 (11 AM). Early check-in or late check-out may be available on request — please include it in your special requests when booking.'
  },
  {
    question: 'Are children allowed?',
    answer: 'Yes, children are welcome. Our Family Suite accommodates up to 4 guests. Please specify the number of adults and children when making your request so we can prepare accordingly.'
  },
  {
    question: 'Is Wi-Fi available?',
    answer: 'Yes, complimentary Wi-Fi is available in all rooms and common areas. Please note that speeds may vary depending on the local network.'
  },
  {
    question: 'Can I bring my pet?',
    answer: 'Pets are not allowed in the rooms to ensure comfort for all guests. Please contact us directly if you have a service animal.'
  },
  {
    question: 'Is breakfast included?',
    answer: 'Breakfast is available at the lodge restaurant for an additional charge. It is not included in the room rate unless stated otherwise in your confirmation.'
  },
  {
    question: 'How do I contact the lodge?',
    answer: 'You can call us, send a WhatsApp message, or email us directly using the buttons at the top of this page. We typically respond to messages within a few hours during business hours.'
  },
  {
    question: 'Is parking available?',
    answer: 'Yes, free on-site parking is available for all guests. No reservation is needed for parking.'
  },
  {
    question: 'What should I do if I need to modify my dates?',
    answer: 'Contact the lodge as soon as possible with your booking reference. We will do our best to accommodate changes based on room availability.'
  }
]

function parseLodgeFaqs(lodge) {
  if (!lodge?.booking_faq) return null
  if (Array.isArray(lodge.booking_faq) && lodge.booking_faq.length > 0) return lodge.booking_faq
  try {
    const parsed = JSON.parse(lodge.booking_faq)
    if (Array.isArray(parsed) && parsed.length > 0) return parsed
  } catch {
    // ignore
  }
  return null
}

function FaqItem({ question, answer }) {
  const [open, setOpen] = useState(false)

  return (
    <div className="border-b border-[var(--line)] last:border-b-0">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between gap-4 py-4 text-left transition-colors hover:text-[var(--brand)]"
        aria-expanded={open}
      >
        <span className="text-sm font-semibold text-[var(--text)]">{question}</span>
        <ChevronDown
          size={18}
          className={`shrink-0 text-[var(--muted)] transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>
      <div
        className={`overflow-hidden text-sm leading-7 text-[var(--muted)] transition-all ${open ? 'max-h-96 pb-4' : 'max-h-0'}`}
      >
        {answer}
      </div>
    </div>
  )
}

export default function FaqSection({ lodge }) {
  const lodgeFaqs = parseLodgeFaqs(lodge)
  const faqs = lodgeFaqs || defaultFaqs

  return (
    <section className="surface-card mt-8 rounded-[32px] p-5 sm:p-8">
      <div className="mb-5 flex items-center gap-2">
        <HelpCircle size={18} className="text-[var(--brand)]" />
        <p className="text-[11px] font-bold uppercase tracking-[0.24em] text-[var(--muted)]">
          Frequently Asked Questions
        </p>
      </div>
      <div className="divide-y divide-[var(--line)]">
        {faqs.map((faq, index) => (
          <FaqItem key={index} question={faq.question} answer={faq.answer} />
        ))}
      </div>
    </section>
  )
}
