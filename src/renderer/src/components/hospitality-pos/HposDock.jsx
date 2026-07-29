/* Compatibility export for older route tests. HposLayout owns the live rail. */
import { useMemo } from 'react'
import { getHposDockItems, getHposMoreItems } from '../../../../shared/barModeProfile'
import { isBarOnlyMode } from '../../../../shared/propertyTypes'
import { useSettings } from '../../app-context'

export default function HposDock({ currentPath = '', onNavigate = () => {} }) {
  const { settings } = useSettings()
  const barOnly = isBarOnlyMode(settings)
  const items = useMemo(() => [...getHposDockItems(barOnly), ...getHposMoreItems(barOnly)], [barOnly])
  return <nav className="hpos-compat-dock" aria-label="Restaurant & Bar POS tools">{items.map(item => <button key={`${item.route}-${item.label}`} type="button" className={currentPath === item.route ? 'is-active' : ''} onClick={() => onNavigate(item.route)}>{item.label}</button>)}</nav>
}
