(() => {
  const startedAt = performance.now()
  const message = document.getElementById('startup-message')
  const retry = document.getElementById('startup-retry')
  const root = document.getElementById('root')
  let failure = false
  const showProblem = (text) => {
    failure = true
    if (!message || !retry) return
    message.textContent = text
    retry.hidden = false
  }

  console.info('[STARTUP] html-ready', { at_ms: Math.round(startedAt) })
  retry?.addEventListener('click', () => {
    // Electron intercepts this exact action and reloads its existing app URL
    // without the HTTP cache. Cookies, local storage and journals are retained.
    if (window.api) window.location.href = 'hospitality-startup://retry/'
    else window.location.reload()
  })
  window.addEventListener('error', (event) => {
    const target = event.target
    if (target instanceof HTMLScriptElement && target.type === 'module') {
      let source = 'application-module'
      try { source = new URL(target.src).pathname } catch {}
      console.error('[STARTUP] module-load-failed', { at_ms: Math.round(performance.now()), source })
      showProblem('The application screen could not be loaded. Your saved records are unchanged. Try again.')
    }
  }, true)
  window.addEventListener('unhandledrejection', () => {
    console.error('[STARTUP] unhandled-rejection', { at_ms: Math.round(performance.now()) })
    if (!failure) showProblem('The application could not finish starting. Your saved records are unchanged. Try again.')
  })
  setTimeout(() => {
    if (root?.querySelector('.startup-fallback')) {
      console.error('[STARTUP] react-mount-timeout', { at_ms: Math.round(performance.now()) })
      if (!failure) showProblem('The screen is taking longer than expected. Your saved records are unchanged. Try again.')
    }
  // Cold development module transforms can take over 20 seconds on this PC.
  // Module failures still surface immediately; only the stalled-load timer waits.
  }, 45000)
})()
