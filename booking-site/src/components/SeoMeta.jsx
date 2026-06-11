import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'

/**
 * SeoMeta — injects per-page SEO tags into <head> via runtime DOM manipulation.
 * React Helmet is not used to keep the bundle lean.
 */
export default function SeoMeta({
  title,
  description,
  ogImage,
  canonicalPath,
  noindex = false
}) {
  const location = useLocation()

  useEffect(() => {
    const baseUrl = window.location.origin
    const canonical = canonicalPath
      ? `${baseUrl}${canonicalPath}`
      : `${baseUrl}${location.pathname}`

    // Title
    document.title = title ? `${title} — Reservations` : 'Reservations'

    // Meta description
    setMeta('name', 'description', description || 'Book your stay directly with the property.')

    // Canonical
    setLink('canonical', canonical)

    // Robots
    setMeta('name', 'robots', noindex ? 'noindex' : 'index, follow')

    // Open Graph
    setMeta('property', 'og:title', title || 'Reservations')
    setMeta('property', 'og:description', description || 'Book your stay directly with the property.')
    setMeta('property', 'og:image', ogImage || '')
    setMeta('property', 'og:url', canonical)
    setMeta('property', 'og:type', 'website')

    // Twitter
    setMeta('property', 'twitter:card', 'summary_large_image')
    setMeta('property', 'twitter:title', title || 'Reservations')
    setMeta('property', 'twitter:description', description || 'Book your stay directly with the property.')
    setMeta('property', 'twitter:image', ogImage || '')

    // JSON-LD: LodgingBusiness schema when we have lodge data
    if (window.__LODGE_SCHEMA__) {
      injectJsonLd(window.__LODGE_SCHEMA__)
    }

    return () => {
      // Cleanup is optional; tags are overwritten on next page
    }
  }, [title, description, ogImage, canonicalPath, noindex, location.pathname])

  return null
}

function setMeta(attrType, attrValue, content) {
  const selector = attrType === 'name'
    ? `meta[name="${attrValue}"]`
    : `meta[${attrType}="${attrValue}"]`
  let el = document.head.querySelector(selector)
  if (!el) {
    el = document.createElement('meta')
    el.setAttribute(attrType, attrValue)
    document.head.appendChild(el)
  }
  el.setAttribute('content', content)
}

function setLink(rel, href) {
  let el = document.head.querySelector(`link[rel="${rel}"]`)
  if (!el) {
    el = document.createElement('link')
    el.setAttribute('rel', rel)
    document.head.appendChild(el)
  }
  el.setAttribute('href', href)
}

function injectJsonLd(schema) {
  const id = 'boroko-jsonld-schema'
  let el = document.getElementById(id)
  if (!el) {
    el = document.createElement('script')
    el.id = id
    el.type = 'application/ld+json'
    document.head.appendChild(el)
  }
  el.textContent = JSON.stringify(schema)
}

/**
 * Helper to set global lodge schema from pages.
 */
export function setLodgeSchema(lodge) {
  if (!lodge || typeof window === 'undefined') return
  const schema = {
    '@context': 'https://schema.org',
    '@type': 'LodgingBusiness',
    name: lodge.lodge_name,
    description: lodge.booking_description || lodge.description,
    image: lodge.hero_image || lodge.logo,
    telephone: lodge.phone,
    email: lodge.email,
    url: lodge.website,
    address: {
      '@type': 'PostalAddress',
      addressLocality: lodge.city,
      addressCountry: lodge.country
    }
  }
  window.__LODGE_SCHEMA__ = schema
}
