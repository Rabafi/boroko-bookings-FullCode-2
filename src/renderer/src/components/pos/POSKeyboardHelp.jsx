import { memo } from 'react'
import { Modal } from '../shared/Modal'

const shortcuts = [
  ['Ctrl+F or /', 'Focus search'],
  ['F2', 'Set cash payment'],
  ['F3', 'Set card payment'],
  ['F9 / Ctrl+Enter', 'Complete order'],
  ['Escape', 'Clear order / Close help'],
  ['+ or =', 'Increment selected line qty'],
  ['−', 'Decrement selected line qty'],
  ['Delete / Backspace', 'Remove selected line'],
  ['↑ / ↓', 'Navigate cart lines'],
  ['?', 'Toggle this help']
]

const POSKeyboardHelp = memo(function POSKeyboardHelp({ onClose }) {
  return (
    <Modal title="Keyboard Shortcuts" onClose={onClose} size="sm">
      <div className="space-y-3">
        {shortcuts.map(([key, desc]) => (
          <div key={key} className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2">
            <span className="text-sm text-slate-700">{desc}</span>
            <kbd className="rounded-md border border-slate-200 bg-white px-2 py-0.5 text-xs font-mono font-semibold text-slate-600 shadow-sm">{key}</kbd>
          </div>
        ))}
      </div>
    </Modal>
  )
})

export default POSKeyboardHelp
