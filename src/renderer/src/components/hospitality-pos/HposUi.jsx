/** Product-native primitives shared by Restaurant and Bar POS workspaces. */
export function HposPageHero({ eyebrow, title, description, actions, children }) {
  return <header className="hpos-page-hero"><div><p className="hpos-eyebrow">{eyebrow}</p><h1>{title}</h1><p>{description}</p>{children}</div>{actions}</header>
}

export function HposButton({ tone = 'secondary', icon: Icon, children, className = '', ...props }) {
  return <button type="button" className={`${tone === 'primary' ? 'hpos-primary-action' : 'hpos-secondary-action'} ${className}`.trim()} {...props}>{Icon && <Icon size={16}/>} {children}</button>
}

export function HposNotice({ tone = 'info', children }) {
  return <div className={tone === 'error' ? 'hpos-inline-error' : 'hpos-inline-notice'} role={tone === 'error' ? 'alert' : 'status'} aria-live={tone === 'error' ? 'assertive' : 'polite'}>{children}</div>
}

export function HposEmptyState({ icon: Icon, title, description }) {
  return <div className="hpos-empty-state"><Icon size={28}/><h2>{title}</h2><p>{description}</p></div>
}

export function HposStatusBadge({ tone = 'neutral', children }) {
  return <span className={`hpos-status-badge is-${tone}`}>{children}</span>
}
