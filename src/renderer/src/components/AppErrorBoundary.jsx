import { Component } from 'react'

function buildErrorReport(state) {
  return JSON.stringify({
    at: state.at || new Date().toISOString(),
    route: state.route || '',
    message: state.message || 'Unknown renderer error',
    stack: state.stack || '',
    componentStack: state.componentStack || ''
  }, null, 2)
}

export default class AppErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false, message: '', stack: '', componentStack: '', route: '', at: '', copied: false }
  }

  static getDerivedStateFromError(error) {
    return {
      hasError: true,
      message: error?.message || 'Unknown renderer error',
      stack: error?.stack || '',
      route: typeof window !== 'undefined' ? window.location?.hash || '' : '',
      at: new Date().toISOString()
    }
  }

  componentDidCatch(error, info) {
    console.error('[Renderer] Unhandled app error:', error, info)
    this.setState({ componentStack: info?.componentStack || '' })

    window.api?.app?.logRendererError?.({
      message: error?.message || 'Unknown renderer error',
      stack: error?.stack || '',
      componentStack: info?.componentStack || '',
      route: window.location?.hash || '',
      at: new Date().toISOString()
    }).catch(() => {})
  }

  handleReload = () => {
    window.location.reload()
  }

  handleCopy = async () => {
    const text = buildErrorReport(this.state)
    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(text)
      } else {
        const area = document.createElement('textarea')
        area.value = text
        document.body.appendChild(area)
        area.select()
        document.execCommand('copy')
        document.body.removeChild(area)
      }
      this.setState({ copied: true })
    } catch {
      this.setState({ copied: false })
      window.alert?.('Copy failed — select the error text manually.')
    }
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex min-h-screen items-center justify-center bg-slate-950 px-6 py-10">
          <div className="bb-card max-w-2xl space-y-5 p-8 text-center">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-red-100 text-3xl text-red-600">
              !
            </div>
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-red-600">Recovery Screen</p>
              <h1 className="text-2xl font-bold text-slate-900">Something went wrong</h1>
              <p className="text-sm leading-6 text-slate-500">
                The app hit an unexpected problem on this screen. Reload the Tsa Bonno application to recover and continue working.
                The full error report below is also saved on this computer (System Health can show it) — quote it when reporting.
              </p>
              <div className="mx-auto max-w-xl rounded-xl bg-slate-50 px-4 py-3 text-left">
                <p className="break-words text-sm font-bold text-slate-800">{this.state.message}</p>
                {this.state.at && <p className="mt-1 text-[11px] text-slate-400">{this.state.at}{this.state.route ? ` · ${this.state.route}` : ''}</p>}
                <details className="mt-2">
                  <summary className="cursor-pointer text-xs font-bold text-slate-600">Full report (stack + component trail)</summary>
                  {this.state.stack && <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-slate-900 p-3 text-[11px] leading-5 text-slate-100">{this.state.stack}</pre>}
                  {this.state.componentStack && <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-slate-800 p-3 text-[11px] leading-5 text-slate-200">{this.state.componentStack}</pre>}
                  {!this.state.stack && !this.state.componentStack && <p className="mt-2 text-xs text-slate-500">No stack trace was captured for this error.</p>}
                </details>
                <button
                  type="button"
                  onClick={this.handleCopy}
                  className="mt-3 inline-flex min-h-11 items-center rounded-xl border border-slate-300 bg-white px-4 py-2 text-xs font-bold text-slate-700 hover:bg-slate-100"
                >
                  {this.state.copied ? 'Copied — paste it into your report' : 'Copy full error report'}
                </button>
              </div>
            </div>
            <button
              type="button"
              onClick={this.handleReload}
              className="btn-primary mx-auto"
            >
              Reload App
            </button>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}
