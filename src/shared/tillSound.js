// Optional till sound (default off). Shared by the top-bar icon toggle
// (HposNav, next to date/time) and the Till beep (HposTerminal). One
// AudioContext is armed only after a user gesture enables the sound.

const STORAGE_KEY = "hpos-till-sound";

let audioContext = null;
const listeners = new Set();

export function isTillSoundEnabled() {
  try {
    return typeof localStorage !== "undefined" && localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export function subscribeTillSound(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function notify() {
  const enabled = isTillSoundEnabled();
  for (const listener of listeners) {
    try {
      listener(enabled);
    } catch {
      /* UI listeners must never block sound state */
    }
  }
}

export async function ensureTillAudio() {
  const AudioCtor = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtor) return null;
  const context = audioContext || new AudioCtor();
  audioContext = context;
  if (context.state === "suspended") {
    try {
      await context.resume();
    } catch {
      return context;
    }
  }
  return context;
}

export async function toggleTillSound() {
  if (isTillSoundEnabled()) {
    try {
      localStorage.setItem(STORAGE_KEY, "0");
    } catch {
      /* optional preference */
    }
    notify();
    return false;
  }
  const context = await ensureTillAudio();
  if (context?.state === "running") {
    try {
      localStorage.setItem(STORAGE_KEY, "1");
    } catch {
      /* optional preference */
    }
    notify();
    return true;
  }
  notify();
  return false;
}

function playTone(frequency, durationMs = 160, type = "sine", delayMs = 0) {
  if (!isTillSoundEnabled()) return;
  const context = audioContext;
  if (!context || context.state !== "running") return;
  try {
    const startAt = context.currentTime + delayMs / 1000;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = type;
    oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(0.0001, startAt);
    gain.gain.exponentialRampToValueAtTime(0.1, startAt + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, startAt + durationMs / 1000);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start(startAt);
    oscillator.stop(startAt + durationMs / 1000 + 0.02);
  } catch {
    /* sound is never required to sell */
  }
}

// Scanner earcon: happy high double-beep for a good scan, low buzz for a
// bad one. Gated on the same till-sound toggle — silence stays silent.
export function playScanBeep(ok = true) {
  if (ok) {
    playTone(988, 110);
    playTone(1319, 140, "sine", 110);
  } else {
    playTone(196, 220, "sawtooth");
  }
}

export function playTillBeep() {
  if (!isTillSoundEnabled()) return;
  const context = audioContext;
  if (!context || context.state !== "running") return;
  try {
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = "sine";
    oscillator.frequency.value = 880;
    gain.gain.setValueAtTime(0.0001, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.1, context.currentTime + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.16);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + 0.18);
  } catch {
    /* sound is never required to sell */
  }
}
