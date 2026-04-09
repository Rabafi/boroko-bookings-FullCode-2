import { useState } from 'react'
import { HelpCircle } from 'lucide-react'

/**
 * P3-9: Tooltip component for contextual help
 * Shows helpful information on hover
 */
export function Tooltip({ children, text, position = 'top' }) {
  const [visible, setVisible] = useState(false)

  const positions = {
    top: 'bottom-full mb-2 left-1/2 -translate-x-1/2',
    bottom: 'top-full mt-2 left-1/2 -translate-x-1/2',
    left: 'right-full mr-2 top-1/2 -translate-y-1/2',
    right: 'left-full ml-2 top-1/2 -translate-y-1/2'
  }

  return (
    <div className="relative inline-block">
      <div
        onMouseEnter={() => setVisible(true)}
        onMouseLeave={() => setVisible(false)}
      >
        {children}
      </div>

      {visible && (
        <div
          className={`absolute z-50 px-2 py-1 text-xs text-white bg-slate-800 rounded whitespace-nowrap pointer-events-none ${positions[position]}`}
        >
          {text}
        </div>
      )}
    </div>
  )
}

/**
 * Help icon with tooltip
 */
export function HelpIcon({ text, size = 16 }) {
  return (
    <Tooltip text={text} position="top">
      <HelpCircle size={size} className="inline text-slate-400 cursor-help hover:text-slate-600 ml-1" />
    </Tooltip>
  )
}
