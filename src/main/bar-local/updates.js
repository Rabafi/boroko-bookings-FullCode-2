// @ts-check
import { randomUUID } from 'node:crypto'
import { copyFile, lstat, mkdir, readdir, rename, rm } from 'node:fs/promises'
import path from 'node:path'

const MAX_UPDATE_BYTES = 2 * 1024 * 1024 * 1024
const MAX_UPDATE_FILES = 10000

/**
 * Copy a selected signed update package into the local service inbox.
 * Directory selection and destination discovery happen in the main process;
 * callers cannot supply an arbitrary destination path.
 * @param {{ sourceDir: string, inboxDir: string }} input
 */
export async function importUpdatePackageDirectory({ sourceDir, inboxDir }) {
  const sourceRoot = path.resolve(sourceDir)
  const inboxRoot = path.resolve(inboxDir)
  if (!path.isAbsolute(inboxDir) || sourceRoot === inboxRoot) {
    throw new Error('The selected update package and service inbox paths are invalid.')
  }
  const sourceInfo = await lstat(sourceRoot).catch(() => null)
  if (!sourceInfo?.isDirectory() || sourceInfo.isSymbolicLink()) {
    throw new Error('Choose a real update package folder. Shortcuts and symbolic links are not accepted.')
  }
  const manifestInfo = await lstat(path.join(sourceRoot, 'update-manifest.json')).catch(() => null)
  if (!manifestInfo?.isFile() || manifestInfo.isSymbolicLink()) {
    throw new Error('The selected folder does not contain a regular update-manifest.json file.')
  }
  const inboxInfo = await lstat(inboxRoot).catch(() => null)
  if (inboxInfo && (!inboxInfo.isDirectory() || inboxInfo.isSymbolicLink())) {
    throw new Error('The local update inbox is not a safe directory. Ask an owner to repair the service setup.')
  }
  await mkdir(inboxRoot, { recursive: true, mode: 0o700 })

  const packageName = `offline-${randomUUID()}`
  const temporary = path.join(inboxRoot, `.import-${randomUUID()}`)
  const destination = path.join(inboxRoot, packageName)
  let fileCount = 0
  let totalBytes = 0

  async function copyTree(from, to) {
    const entries = await readdir(from, { withFileTypes: true })
    await mkdir(to, { recursive: false, mode: 0o700 })
    for (const entry of entries) {
      if (!entry.name || entry.name === '.' || entry.name === '..' || entry.name.includes('\0')) {
        throw new Error('The update package contains an invalid file name.')
      }
      const source = path.join(from, entry.name)
      const target = path.join(to, entry.name)
      const info = await lstat(source)
      if (info.isSymbolicLink()) throw new Error('The update package contains a symbolic link. It was not copied.')
      if (info.isDirectory()) {
        await copyTree(source, target)
        continue
      }
      if (!info.isFile()) throw new Error('The update package contains a special file. It was not copied.')
      fileCount += 1
      totalBytes += info.size
      if (fileCount > MAX_UPDATE_FILES || totalBytes > MAX_UPDATE_BYTES) {
        throw new Error('The update package exceeds the local import limit of 10,000 files or 2 GiB.')
      }
      await copyFile(source, target)
      const copied = await lstat(target)
      if (!copied.isFile() || copied.size !== info.size) throw new Error(`The package file ${entry.name} changed while it was copied.`)
    }
  }

  try {
    await copyTree(sourceRoot, temporary)
    await rename(temporary, destination)
    return Object.freeze({ package: packageName, files: fileCount, bytes: totalBytes })
  } catch (error) {
    await rm(temporary, { recursive: true, force: true }).catch(() => {})
    throw error
  }
}
