(() => {
  try {
    const saved = localStorage.getItem('boroko_pwa_theme')
    const prefersLight = window.matchMedia?.('(prefers-color-scheme: light)').matches
    const light = saved ? saved === 'light' : prefersLight
    document.documentElement.classList.toggle('light-mode', light)
    document.documentElement.classList.toggle('dark-mode', !light)
    document.documentElement.style.colorScheme = light ? 'light' : 'dark'
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', light ? '#f8f4ed' : '#174c3a')
    document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]')?.setAttribute('content', light ? 'default' : 'black-translucent')
  } catch {
    document.documentElement.classList.add('dark-mode')
    document.documentElement.style.colorScheme = 'dark'
  }
})()
