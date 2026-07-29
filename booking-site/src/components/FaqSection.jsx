import { useState } from 'react'
import { ChevronDown, HelpCircle } from 'lucide-react'

function buildDefaultFaqs(lodge = {}) {
  const checkIn = lodge.booking_check_in_from || '14:00'
  const checkOut = lodge.booking_check_out_until || '10:00'
  const paymentTerms = lodge.booking_payment_terms
    || 'Payment methods and deposit requirements are confirmed by the property when they accept your booking request.'
  const cancellation = lodge.booking_cancellation_policy
    || 'Cancellation terms are confirmed by the property with your booking confirmation.'

  return [
    {
      question: 'How do I make a reservation?',
      answer: 'Choose your check-in and check-out dates, then click "Search rooms." Pick the room that suits you, fill in your details, and send your booking request. The property will review it and confirm within 24 hours.'
    },
    {
      question: 'Is my booking confirmed immediately?',
      answer: 'No — your request is sent to the property for review. You will receive a confirmation or follow-up message within 24 hours. Your booking reference is saved instantly, so the property can see it even before email delivery.'
    },
    {
      question: 'What payment methods do you accept?',
      answer: paymentTerms
    },
    {
      question: 'What is your cancellation policy?',
      answer: cancellation
    },
    {
      question: 'What are the check-in and check-out times?',
      answer: `Check-in is from ${checkIn} and check-out is by ${checkOut}. Early check-in or late check-out may be available on request — please include it in your special requests when booking.`
    },
    {
      question: 'How do I contact the property?',
      answer: 'You can call, send a WhatsApp message, or email using the buttons on this page. Response times depend on the property’s operating hours.'
    },
    {
      question: 'What should I do if I need to modify my dates?',
      answer: 'Contact the property as soon as possible with your booking reference. Changes depend on availability and the property’s policies.'
    }
  ]
}

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
  const faqs = lodgeFaqs || buildDefaultFaqs(lodge)

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
