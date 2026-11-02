import { writeFileSync, renameSync } from 'node:fs'

// Optional installer telemetry. A reporting failure must never change a
// committed migration's outcome. Only fixed task text and counters belong here.
export function reportSetupProgress(task, completed = null, total = null) {
  const destination = process.env.BAR_LOCAL_SETUP_PROGRESS_FILE
  if (!destination) return
  try {
    const temporary = `${destination}.${process.pid}.tmp`
    writeFileSync(temporary, JSON.stringify({ task, completed, total, updated_at: new Date().toISOString() }), { mode: 0o600 })
    renameSync(temporary, destination)
  } catch { /* Status reporting is advisory; database errors remain authoritative. */ }
}
