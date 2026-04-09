import { Copy, Check } from 'lucide-react'
import { useState } from 'react'

/**
 * P3-7: CopyButton component for copy-to-clipboard functionality
 * Provides feedback when text is copied
 */
export function CopyButton({ text, label = 'Copy', className = '' }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (err) {
      console.error('Failed to copy:', err)
    }
  }

  return (
    <button
      onClick={handleCopy}
      title={copied ? 'Copied!' : 'Copy to clipboard'}
      className={`inline-flex items-center gap-2 px-3 py-1.5 text-xs font-medium transition-all ${
        copied
          ? 'text-emerald-700 bg-emerald-50'
          : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
      } rounded ${className}`}
    >
      {copied ? (
        <>
          <Check size={14} />
          Copied!
        </>
      ) : (
        <>
          <Copy size={14} />
          {label}
        </>
      )}
    </button>
  )
}

/**
 * Inline copyable text - shows text with copy button on hover
 */
export function CopyableText({ text, className = '' }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (err) {
      console.error('Failed to copy:', err)
    }
  }

  return (
    <div className="group inline-flex items-center gap-2">
      <code className={`px-2 py-1 bg-slate-100 rounded text-xs font-mono ${className}`}>
        {text}
      </code>
      <button
        onClick={handleCopy}
        className="opacity-0 group-hover:opacity-100 transition-opacity p-1 hover:bg-slate-200 rounded"
        title={copied ? 'Copied!' : 'Copy to clipboard'}
      >
        {copied ? (
          <Check size={14} className="text-emerald-600" />
        ) : (
          <Copy size={14} className="text-slate-600" />
        )}
      </button>
    </div>
  )
}
