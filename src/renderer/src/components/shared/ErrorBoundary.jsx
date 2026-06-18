import { Component } from 'react'
import { AlertTriangle } from 'lucide-react'

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    console.error(`[CommandCentral] Section error:`, error, info)
  }

  render() {
    if (this.state.error) {
      return (
        <div className="bg-gray-800 rounded-xl p-8 text-center">
          <AlertTriangle size={32} className="mx-auto mb-3 text-red-400" />
          <p className="text-red-300 font-semibold text-sm">This section encountered an error</p>
          <p className="text-gray-500 text-xs mt-1 max-w-md mx-auto">{this.state.error.message}</p>
          <button
            onClick={() => this.setState({ error: null })}
            className="mt-4 px-4 py-2 bg-gray-700 hover:bg-gray-600 text-gray-200 text-xs rounded-lg"
          >
            Try again
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
