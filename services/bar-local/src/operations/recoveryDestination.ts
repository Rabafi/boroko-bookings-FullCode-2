import { lstat, mkdir, open, readFile, realpath, rename } from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import type { ServiceConfig } from '../config.js'

const fileFor = (config: ServiceConfig) => path.join(config.backup.dir, 'recovery-copy-destination.json')
function separated(config: ServiceConfig, candidate: string) {
  const second = candidate.toLowerCase()
  for (const directory of [config.backup.dir, config.replication.pgDataDir, config.updates.installDir, process.env.SystemRoot, process.env.ProgramFiles].filter((value): value is string => Boolean(value))) {
    const first = path.resolve(directory).toLowerCase()
    if (first === second || first.startsWith(second + path.sep) || second.startsWith(first + path.sep)) throw new Error('Choose a dedicated recovery folder separate from live data, backups and installed software.')
  }
}
export async function recoveryCopyDestination(config: ServiceConfig): Promise<string | null> {
  let value: unknown
  try { value = JSON.parse(await readFile(fileFor(config), 'utf8')) }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return config.backup.copyToDir; throw new Error('The saved recovery copy destination cannot be verified.') }
  if (!value || typeof value !== 'object' || typeof (value as { destination?: unknown }).destination !== 'string') throw new Error('The saved recovery copy destination is invalid.')
  const destination = (value as { destination: string }).destination
  if (!path.isAbsolute(destination) || destination.startsWith('\\\\') || destination.startsWith('//')) throw new Error('The recovery copy destination must be on a local attached drive.')
  separated(config, path.resolve(destination))
  return destination
}
export async function setRecoveryCopyDestination(config: ServiceConfig, selectedFolder: string, authorityId: string) {
  if (config.training || !/^[a-f0-9-]{36}$/i.test(authorityId) || selectedFolder.length > 4096 || !path.isAbsolute(selectedFolder) || selectedFolder.startsWith('\\\\') || selectedFolder.startsWith('//')) throw new Error('Choose an attached recovery drive for this local Bar.')
  const selected = path.resolve(selectedFolder)
  const metadata = await lstat(selected)
  if (!metadata.isDirectory() || metadata.isSymbolicLink() || (await realpath(selected)).toLowerCase() !== selected.toLowerCase()) throw new Error('Choose an existing folder on an attached drive; linked folders are refused.')
  const destination = path.join(selected, 'Tsa Bonno Bar Recovery', authorityId)
  separated(config, destination)
  await mkdir(destination, { recursive: true, mode: 0o700 })
  if ((await realpath(destination)).toLowerCase() !== destination.toLowerCase()) throw new Error('The recovery destination resolves through a linked folder.')
  const record = { version: 1, authority_id: authorityId, destination, chosen_at: new Date().toISOString(), independent_device_verified: false }
  await mkdir(config.backup.dir, { recursive: true })
  const temporary = `${fileFor(config)}.${randomUUID()}.tmp`, handle = await open(temporary, 'wx', 0o600)
  try { await handle.writeFile(JSON.stringify(record)); await handle.sync() } finally { await handle.close() }
  await rename(temporary, fileFor(config))
  return record
}
