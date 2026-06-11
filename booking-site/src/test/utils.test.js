import { describe, it, expect } from 'vitest'
import {
  buildWhatsAppUrl,
  sanitizeWebsiteUrl,
  buildCalendarUrl,
  isValidSlug,
  SLUG_REGEX
} from '../lib/utils.js'

describe('buildWhatsAppUrl', () => {
  it('formats a plain number', () => {
    expect(buildWhatsAppUrl('+267 71 234 567')).toBe('https://wa.me/26771234567')
  })

  it('returns null for empty input', () => {
    expect(buildWhatsAppUrl('')).toBeNull()
    expect(buildWhatsAppUrl(null)).toBeNull()
  })

  it('strips non-digit characters', () => {
    expect(buildWhatsAppUrl('(267) 71-234-567')).toBe('https://wa.me/26771234567')
  })
})

describe('sanitizeWebsiteUrl', () => {
  it('accepts valid https URLs', () => {
    expect(sanitizeWebsiteUrl('https://example.com')).toBe('https://example.com/')
  })

  it('accepts valid http URLs', () => {
    expect(sanitizeWebsiteUrl('http://example.com')).toBe('http://example.com/')
  })

  it('rejects javascript: protocol', () => {
    expect(sanitizeWebsiteUrl('javascript:alert(1)')).toBeNull()
  })

  it('rejects invalid URLs', () => {
    expect(sanitizeWebsiteUrl('not a url')).toBeNull()
  })

  it('returns null for empty input', () => {
    expect(sanitizeWebsiteUrl('')).toBeNull()
    expect(sanitizeWebsiteUrl(null)).toBeNull()
  })
})

describe('buildCalendarUrl', () => {
  it('builds a valid Google Calendar URL', () => {
    const url = buildCalendarUrl({
      check_in: '2026-06-15',
      check_out: '2026-06-20',
      lodge_name: 'Test Lodge',
      reference: 'REF-123',
      room_number: 'Room 101'
    })
    expect(url).toContain('calendar.google.com')
    expect(url).toContain('20260615')
    expect(url).toContain('20260620')
    expect(url).toContain('Test%20Lodge')
  })

  it('returns null for missing dates', () => {
    expect(buildCalendarUrl({ check_in: '', check_out: '' })).toBeNull()
  })
})

describe('isValidSlug', () => {
  it('accepts valid kebab-case slugs', () => {
    expect(isValidSlug('my-lodge')).toBe(true)
    expect(isValidSlug('lodge123')).toBe(true)
  })

  it('rejects empty or too short slugs', () => {
    expect(isValidSlug('')).toBe(false)
    expect(isValidSlug('a')).toBe(false)
  })

  it('rejects slugs with underscores or spaces', () => {
    expect(isValidSlug('my_lodge')).toBe(false)
    expect(isValidSlug('my lodge')).toBe(false)
  })

  it('rejects non-string values', () => {
    expect(isValidSlug(null)).toBe(false)
    expect(isValidSlug(123)).toBe(false)
  })
})

describe('SLUG_REGEX', () => {
  it('matches expected patterns', () => {
    expect(SLUG_REGEX.test('kebab-case')).toBe(true)
    expect(SLUG_REGEX.test('123-numbers')).toBe(true)
    expect(SLUG_REGEX.test('no--double')).toBe(false)
  })
})
