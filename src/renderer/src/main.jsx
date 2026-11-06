import React from 'react'
import ReactDOM from 'react-dom/client'
import './index.css'
import './styles/hospitality-pos.css'
import './styles/restaurant-workspaces.css'
import './components/hotel/hotelTheme.css'
import App from './App'

console.info('[STARTUP] renderer-module-ready', { at_ms: Math.round(performance.now()) })

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
