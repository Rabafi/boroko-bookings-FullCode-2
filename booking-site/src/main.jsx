import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { initErrorTracking } from './lib/errorTracker.js'
import { flushPendingEmails } from './lib/publicApi.js'

// Start capturing JS errors and unhandled promise rejections immediately
initErrorTracking()

// Retry any queued confirmation emails from previous sessions
flushPendingEmails()

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>
)
