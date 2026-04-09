import { CheckCircle, Circle } from 'lucide-react'

/**
 * P3-10: Stepper component for multi-step processes
 * Shows progress through a series of steps
 */
export function Stepper({ steps, currentStep, onStepClick }) {
  return (
    <div className="mb-8">
      <div className="flex items-center">
        {steps.map((step, index) => {
          const isActive = index === currentStep
          const isCompleted = index < currentStep
          const isClickable = index < currentStep || isActive

          return (
            <div key={index} className="flex items-center flex-1">
              {/* Step circle */}
              <button
                onClick={() => isClickable && onStepClick?.(index)}
                disabled={!isClickable}
                className={`relative z-10 flex items-center justify-center w-10 h-10 rounded-full transition-all ${
                  isCompleted
                    ? 'bg-emerald-600 text-white cursor-pointer hover:bg-emerald-700'
                    : isActive
                    ? 'bg-blue-600 text-white ring-4 ring-blue-100'
                    : 'bg-slate-200 text-slate-600 cursor-not-allowed'
                }`}
                title={step.label}
              >
                {isCompleted ? (
                  <CheckCircle size={20} />
                ) : (
                  <span className="font-semibold">{index + 1}</span>
                )}
              </button>

              {/* Connector line */}
              {index < steps.length - 1 && (
                <div
                  className={`flex-1 h-1 mx-2 transition-colors ${
                    isCompleted ? 'bg-emerald-600' : 'bg-slate-200'
                  }`}
                />
              )}
            </div>
          )
        })}
      </div>

      {/* Step labels */}
      <div className="flex mt-4">
        {steps.map((step, index) => (
          <div key={index} className="flex-1">
            <p className="text-xs font-medium text-slate-700">{step.label}</p>
            {step.description && (
              <p className="text-xs text-slate-500 mt-0.5">{step.description}</p>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

/**
 * Progress bar
 */
export function ProgressBar({ current, total, label }) {
  const percentage = (current / total) * 100

  return (
    <div className="space-y-2">
      {label && (
        <div className="flex justify-between items-center">
          <p className="text-sm font-medium text-slate-700">{label}</p>
          <p className="text-xs text-slate-600">{current} of {total}</p>
        </div>
      )}
      <div className="w-full bg-slate-200 rounded-full h-2 overflow-hidden">
        <div
          className="bg-gradient-to-r from-blue-500 to-emerald-500 h-full transition-all duration-300"
          style={{ width: `${percentage}%` }}
        />
      </div>
    </div>
  )
}
