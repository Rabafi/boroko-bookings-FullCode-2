(() => {
  const startedAt = performance.now()
  const message = document.getElementById('startup-message')
  const retry = document.getElementById('startup-retry')
  const root = document.getElementById('root')
  const showProblem = (text) => {
    if (!message || !retry) return
    message.textContent = text
    retry.hidden = false
  }

  console.info('[STARTUP] html-ready', { at_ms: Math.round(startedAt) })
  retry?.addEventListener('click', () => window.location.reload())
  window.addEventListener('error', (event) => {
    const target = event.target
    if (target instanceof HTMLScriptElement && target.type === 'module') {
      console.error('[STARTUP] module-load-failed', { at_ms: Math.round(performance.now()), source: target.src })
      showProblem('The application screen could not be loaded. Your saved records are unchanged. Try again.')
    }
  }, true)
  window.addEventListener('unhandledrejection', () => {
    console.error('[STARTUP] unhandled-rejection', { at_ms: Math.round(performance.now()) })
    showProblem('The application could not finish starting. Your saved records are unchanged. Try again.')
  })
  setTimeout(() => {
    if (root?.querySelector('.startup-fallback')) {
      console.error('[STARTUP] react-mount-timeout', { at_ms: Math.round(performance.now()) })
      showProblem('The screen is taking longer than expected. Your saved records are unchanged. Try again.')
    }
  }, 15000)
})()
