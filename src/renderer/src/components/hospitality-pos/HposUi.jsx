/** Product-native primitives shared by Restaurant and Bar POS workspaces. */
import { ErrorNotice } from '../shared/ErrorNotice'

export function HposPageHero({ eyebrow, title, description, actions, children }) {
  return <header className="hpos-page-hero"><div><p className="hpos-eyebrow">{eyebrow}</p><h1>{title}</h1><p>{description}</p>{children}</div>{actions}</header>
}

export function HposButton({ tone = 'secondary', icon: Icon, children, className = '', ...props }) {
  return <button type="button" className={`${tone === 'primary' ? 'hpos-primary-action' : 'hpos-secondary-action'} ${className}`.trim()} {...props}>{Icon && <Icon size={16}/>} {children}</button>
}

export function HposNotice({ tone = 'info', children }) {
  // Error notices bring themselves into view so a failure below the fold is never missed.
  if (tone === 'error') {
    return <ErrorNotice className="hpos-inline-error" role="alert">{children}</ErrorNotice>
  }
  return <div className="hpos-inline-notice" role="status" aria-live="polite">{children}</div>
}

export function HposEmptyState({ icon: Icon, title, description }) {
  return <div className="hpos-empty-state"><Icon size={28}/><h2>{title}</h2><p>{description}</p></div>
}

export function HposStatusBadge({ tone = 'neutral', children }) {
  return <span className={`hpos-status-badge is-${tone}`}>{children}</span>
}

/**
 * Small add-on ownership sign for Bar pages.
 * Shows which commercial add-on a page belongs to, e.g. "Stock & Purchasing Pro".
 * Render nothing for base-package pages so core till flows stay uncluttered.
 */
export function BarAddonBadge({ addonName, featureKey }) {
  const label = addonName || null
  if (!label) return null
  return (
    <span
      className="hpos-addon-badge"
      title={featureKey ? `Part of the ${label} add-on (${String(featureKey).replace(/_/g, ' ')})` : `Part of the ${label} add-on`}
    >
      {label} · add-on
    </span>
  )
}
