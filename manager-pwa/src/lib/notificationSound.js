const DEFAULT_BEEP_FREQUENCY = 880
const DEFAULT_BEEP_DURATION_MS = 120
const DEFAULT_VOLUME = 0.3

let sharedAudioContext = null

function getAudioContext() {
  if (sharedAudioContext && sharedAudioContext.state !== 'closed') return sharedAudioContext
  try {
    sharedAudioContext = new (window.AudioContext || window.webkitAudioContext)()
  } catch {
    sharedAudioContext = null
  }
  return sharedAudioContext
}

function scheduleBeep(context) {
  const oscillator = context.createOscillator()
  const gain = context.createGain()
  oscillator.connect(gain)
  gain.connect(context.destination)
  oscillator.type = 'sine'
  oscillator.frequency.setValueAtTime(DEFAULT_BEEP_FREQUENCY, context.currentTime)
  gain.gain.setValueAtTime(DEFAULT_VOLUME, context.currentTime)
  gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + DEFAULT_BEEP_DURATION_MS / 1000)
  oscillator.start(context.currentTime)
  oscillator.stop(context.currentTime + DEFAULT_BEEP_DURATION_MS / 1000)
}

export function playNotificationSound(prefs) {
  if (!prefs?.sound) return
  try {
    const context = getAudioContext()
    if (!context) return
    if (context.state === 'suspended') {
      context.resume().then(() => {
        try { scheduleBeep(context) } catch { /* ignore */ }
      }).catch(() => {})
      return
    }
    scheduleBeep(context)
  } catch {
    // Silently ignore — devices without audio or blocked autoplay degrade gracefully.
  }
}

export function playTestSound(prefs) {
  if (!prefs?.sound) return
  try {
    const context = getAudioContext()
    if (!context) return
    const resumeAndPlay = async () => {
      if (context.state === 'suspended') await context.resume()
      scheduleBeep(context)
    }
    resumeAndPlay().catch(() => {})
  } catch {
    // Silently ignore.
  }
}

export function vibratePulse(type = 'reply', prefs) {
  if (!prefs?.vibration) return
  if (!('vibrate' in navigator)) return
  try {
    const patterns = {
      reply: [80],
      urgent: [60, 40, 60],
      ordinary: [40]
    }
    navigator.vibrate(patterns[type] || patterns.reply)
  } catch {
    // Ignore — vibration may be restricted on some devices.
  }
}
