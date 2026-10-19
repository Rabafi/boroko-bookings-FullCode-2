// @ts-check

import { existsSync, readFileSync } from 'fs'
import { join, resolve } from 'path'

/** @typedef {{ packaged?: boolean, resourcesPath?: string, currentDir?: string }} BarGuideRuntimeOptions */
/** @typedef {{ productId?: unknown, operatingMode?: unknown, appVersion?: unknown, supportedVersionRange?: unknown, reviewDate?: unknown, documents?: Array<Record<string, unknown>> }} BarGuideManifest */

export const BAR_GUIDE_DOCUMENTS = Object.freeze({
  'bar-manual': Object.freeze({
    id: 'bar-manual',
    label: 'Bar customer manual',
    filename: 'Tsa-Bonno-Bar-Customer-Manual.pdf'
  }),
  'bar-quick-start': Object.freeze({
    id: 'bar-quick-start',
    label: 'Bar quick-start',
    filename: 'Tsa-Bonno-Bar-Quick-Start.pdf'
  })
})

/** @param {string} currentDir @param {string} relativePath */
function candidateRoot(currentDir, relativePath) {
  return [
    resolve(currentDir, '../../../', relativePath),
    resolve(currentDir, '../../', relativePath),
    resolve(process.cwd(), relativePath)
  ]
}

/** @param {BarGuideRuntimeOptions} [options] */
export function getBarGuideRoot({ packaged = false, resourcesPath = '', currentDir = process.cwd() } = {}) {
  if (packaged) return join(resourcesPath, 'bar-guides')
  return candidateRoot(currentDir, 'output/pdf').find((path) => existsSync(path)) || candidateRoot(currentDir, 'output/pdf')[0]
}

/** @param {BarGuideRuntimeOptions} [options] */
export function getBarGuideManifestPath({ packaged = false, resourcesPath = '', currentDir = process.cwd() } = {}) {
  if (packaged) return join(resourcesPath, 'bar-guides', 'document-manifest.json')
  return candidateRoot(currentDir, 'docs/bar-manual').map((path) => join(path, 'document-manifest.json')).find((path) => existsSync(path)) || join(candidateRoot(currentDir, 'docs/bar-manual')[0], 'document-manifest.json')
}

/** @param {string} documentId @returns {unknown} */
export function getBarGuideDefinition(documentId) {
  const definition = BAR_GUIDE_DOCUMENTS[/** @type {keyof typeof BAR_GUIDE_DOCUMENTS} */ (documentId)]
  if (!definition) throw new Error('Unknown Bar guide.')
  return definition
}

/** @param {string} documentId @param {BarGuideRuntimeOptions} [options] */
export function resolveBarGuideFile(documentId, options = {}) {
  // This assertion reflects the statically declared guide rows; it does not validate or reject inherited-key lookups.
  const definition = /** @type {typeof BAR_GUIDE_DOCUMENTS[keyof typeof BAR_GUIDE_DOCUMENTS]} */ (getBarGuideDefinition(documentId))
  const root = getBarGuideRoot(options)
  const filePath = resolve(root, definition.filename)
  const resolvedRoot = resolve(root)
  if (!filePath.startsWith(`${resolvedRoot}\\`) && !filePath.startsWith(`${resolvedRoot}/`)) {
    throw new Error('Bar guide path is outside the approved resource directory.')
  }
  if (!existsSync(filePath)) throw new Error(`${definition.label} is not included in this app build.`)
  return { ...definition, path: filePath, root }
}

/** @param {BarGuideRuntimeOptions} [options] @returns {BarGuideManifest} */
export function readBarGuideManifest(options = {}) {
  const manifestPath = getBarGuideManifestPath(options)
  if (!existsSync(manifestPath)) throw new Error('Bar guide applicability information is not included in this app build.')
  // The exact document-manifest producer is the approved Bar manual manifest.
  // This compile-time view does not parse-validate or alter malformed-file behavior.
  return /** @type {BarGuideManifest} */ (JSON.parse(readFileSync(manifestPath, 'utf8')))
}
