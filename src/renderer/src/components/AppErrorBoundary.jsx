import { Component } from 'react'

export default class AppErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false }
  }

  static getDerivedStateFromError() {
    return { hasError: true }
  }

  componentDidCatch(error, info) {
    console.error('[Renderer] Unhandled app error:', error, info)

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

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex min-h-screen items-center justify-center bg-slate-950 px-6 py-10">
          <div className="bb-card max-w-lg space-y-5 p-8 text-center">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-red-100 text-3xl text-red-600">
              !
            </div>
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-red-600">Recovery Screen</p>
              <h1 className="text-2xl font-bold text-slate-900">Something went wrong</h1>
              <p className="text-sm leading-6 text-slate-500">
                The app hit an unexpected problem on this screen. Reload the Tsa Bonno application to recover and continue working.
              </p>
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
