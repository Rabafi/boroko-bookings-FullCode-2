import { AlertCircle, CheckCircle } from 'lucide-react'

/**
 * P3-5: FormField component with real-time validation
 * Provides consistent validation feedback across the app
 */
export function FormField({
  label,
  type = 'text',
  value,
  onChange,
  onBlur,
  placeholder,
  required = false,
  error,
  hint,
  success = false,
  disabled = false,
  autoComplete,
  maxLength,
  min,
  max,
  step
}) {
  const hasError = !!error
  const showSuccess = success && !hasError && value

  return (
    <div className="space-y-2">
      {label && (
        <label className="block text-sm font-medium text-slate-700">
          {label}
          {required && <span className="text-red-500">*</span>}
        </label>
      )}

      <div className="relative">
        <input
          type={type}
          value={value}
          onChange={onChange}
          onBlur={onBlur}
          placeholder={placeholder}
          disabled={disabled}
          autoComplete={autoComplete}
          maxLength={maxLength}
          min={min}
          max={max}
          step={step}
          className={`w-full px-3 py-2 border rounded-lg text-sm transition-colors ${
            disabled ? 'bg-slate-50 text-slate-500 cursor-not-allowed border-slate-200' : 'bg-white border-slate-300'
          } ${hasError ? 'border-red-500 focus:ring-red-500' : showSuccess ? 'border-emerald-500 focus:ring-emerald-500' : 'focus:ring-blue-500'} focus:outline-none focus:ring-2 focus:border-transparent`}
        />

        {/* Validation icons */}
        {hasError && (
          <AlertCircle className="absolute right-3 top-2.5 w-5 h-5 text-red-500" />
        )}
        {showSuccess && (
          <CheckCircle className="absolute right-3 top-2.5 w-5 h-5 text-emerald-500" />
        )}
      </div>

      {/* Error or hint message */}
      {hasError && (
        <p className="text-xs text-red-600 flex items-center gap-1">
          <AlertCircle size={14} />
          {error}
        </p>
      )}
      {hint && !hasError && (
        <p className="text-xs text-slate-500">{hint}</p>
      )}
    </div>
  )
}

/**
 * Textarea variant with validation
 */
export function FormFieldTextarea({
  label,
  value,
  onChange,
  onBlur,
  placeholder,
  required = false,
  error,
  hint,
  success = false,
  disabled = false,
  rows = 4
}) {
  const hasError = !!error
  const showSuccess = success && !hasError && value

  return (
    <div className="space-y-2">
      {label && (
        <label className="block text-sm font-medium text-slate-700">
          {label}
          {required && <span className="text-red-500">*</span>}
        </label>
      )}

      <textarea
        value={value}
        onChange={onChange}
        onBlur={onBlur}
        placeholder={placeholder}
        disabled={disabled}
        rows={rows}
        className={`w-full px-3 py-2 border rounded-lg text-sm transition-colors resize-none ${
          disabled ? 'bg-slate-50 text-slate-500 cursor-not-allowed border-slate-200' : 'bg-white border-slate-300'
        } ${hasError ? 'border-red-500 focus:ring-red-500' : showSuccess ? 'border-emerald-500 focus:ring-emerald-500' : 'focus:ring-blue-500'} focus:outline-none focus:ring-2 focus:border-transparent`}
      />

      {/* Error or hint message */}
      {hasError && (
        <p className="text-xs text-red-600 flex items-center gap-1">
          <AlertCircle size={14} />
          {error}
        </p>
      )}
      {hint && !hasError && (
        <p className="text-xs text-slate-500">{hint}</p>
      )}
    </div>
  )
}
