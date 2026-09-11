/**
 * Prune unused chrono-node locales/builds after install.
 *
 * The AI assistant deep-imports English-only ESM (`chrono-node/en`), so the
 * TypeScript sources, non-English locales, maps, and type declarations are
 * dead weight in the packaged installer (~2.6 MB saved).
 *
 * Safe to run repeatedly and safe to skip: it only deletes inside
 * node_modules/chrono-node, guards every step, never throws, and exits 0
 * when there is nothing to do (e.g. package layout changed upstream).
 *
 * Run: node ./scripts/prune-chrono-locales.mjs
 */
import { existsSync, readdirSync, rmSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const chronoDir = join(root, 'node_modules', 'chrono-node')

function removeIfExists(path) {
  try {
    if (existsSync(path)) rmSync(path, { recursive: true, force: true })
  } catch (err) {
    console.warn(`[prune-chrono] skipping ${path}: ${err?.message || err}`)
  }
}

function pruneDevFiles(dir) {
  if (!existsSync(dir)) return
  let entries = []
  try {
    entries = readdirSync(dir)
  } catch {
    return
  }
  for (const entry of entries) {
    const full = join(dir, entry)
    try {
      if (statSync(full).isDirectory()) {
        pruneDevFiles(full)
      } else if (entry.endsWith('.map') || entry.endsWith('.d.ts') || entry.endsWith('.d.cts')) {
        rmSync(full, { force: true })
      }
    } catch {
      // best-effort only
    }
  }
}

if (!existsSync(chronoDir)) {
  console.log('[prune-chrono] chrono-node not installed, nothing to prune.')
} else {
  // TypeScript sources are never needed at runtime.
  removeIfExists(join(chronoDir, 'src'))
  // The app imports `chrono-node/en` as ESM only (the repo is type:module and
  // no caller requires chrono). The CJS build would be incomplete once its
  // shared files are pruned, so remove it outright rather than ship a
  // half-present tree that fails confusingly.
  removeIfExists(join(chronoDir, 'dist', 'cjs'))
  // Only the English locale is imported (`chrono-node/en`).
  for (const build of ['esm']) {
    const localesDir = join(chronoDir, 'dist', build, 'locales')
    if (!existsSync(localesDir)) continue
    let entries = []
    try {
      entries = readdirSync(localesDir)
    } catch {
      continue
    }
    for (const entry of entries) {
      if (entry !== 'en') removeIfExists(join(localesDir, entry))
    }
  }
  pruneDevFiles(join(chronoDir, 'dist'))
  console.log('[prune-chrono] pruned unused chrono-node files.')
}
