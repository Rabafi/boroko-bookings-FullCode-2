import { AlertCircle, Trash2 } from 'lucide-react'
import { Modal } from './Modal'

/**
 * P3-1: Consistent confirmation dialog for destructive actions
 * Replaces browser confirm() with a proper modal dialog
 */
export function ConfirmDialog({
  isOpen,
  title = 'Confirm Action',
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  isDangerous = false,
  isLoading = false,
  onConfirm,
  onCancel
}) {
  return (
    <Modal isOpen={isOpen} onClose={onCancel} size="sm">
      <div className="flex items-start gap-4">
        <div className={`flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center ${isDangerous ? 'bg-red-100' : 'bg-blue-100'}`}>
          {isDangerous ? (
            <Trash2 className={isDangerous ? 'text-red-600' : 'text-blue-600'} size={20} />
          ) : (
            <AlertCircle className="text-blue-600" size={20} />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
          {message && (
            <p className="mt-1 text-sm text-slate-600">{message}</p>
          )}
        </div>
      </div>

      <div className="mt-6 flex gap-3 justify-end">
        <button
          onClick={onCancel}
          disabled={isLoading}
          className="px-4 py-2 text-sm font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 disabled:opacity-50 rounded-lg transition-colors"
        >
          {cancelLabel}
        </button>
        <button
          onClick={onConfirm}
          disabled={isLoading}
          className={`px-4 py-2 text-sm font-medium text-white rounded-lg transition-colors disabled:opacity-50 ${
            isDangerous
              ? 'bg-red-600 hover:bg-red-700'
              : 'bg-blue-600 hover:bg-blue-700'
          }`}
        >
          {isLoading ? 'Processing...' : confirmLabel}
        </button>
      </div>
    </Modal>
  )
}
