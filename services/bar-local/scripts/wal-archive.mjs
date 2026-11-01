#!/usr/bin/env node
import { resolve } from 'node:path'
import { archiveWalSegment, readWalArchiveKey, restoreWalSegment } from '../dist/operations/walArchive.js'

function usage() {
  throw new Error('Usage: wal-archive.mjs <archive|restore> --wal-name <24-hex> --archive-dir <directory> --key-file <file> [--source <file>|--target <file>]')
}

function parse(argv) {
  const [mode, ...rest] = argv
  if (!['archive', 'restore'].includes(mode)) usage()
  const values = new Map()
  for (let index = 0; index < rest.length; index += 1) {
    const flag = rest[index]
    if (!['--wal-name', '--archive-dir', '--key-file', '--source', '--target'].includes(flag)) usage()
    const value = rest[index + 1]
    if (!value || value.startsWith('--') || values.has(flag)) usage()
    values.set(flag, value)
    index += 1
  }
  const required = ['--wal-name', '--archive-dir', '--key-file', mode === 'archive' ? '--source' : '--target']
  if (required.some((flag) => !values.has(flag)) || values.has(mode === 'archive' ? '--target' : '--source')) usage()
  return { mode, values }
}

try {
  const { mode, values } = parse(process.argv.slice(2))
  const key = await readWalArchiveKey(resolve(values.get('--key-file')))
  const common = {
    walName: values.get('--wal-name'),
    archiveDir: resolve(values.get('--archive-dir')),
    key
  }
  const result = mode === 'archive'
    ? await archiveWalSegment({ ...common, sourcePath: resolve(values.get('--source')) })
    : await restoreWalSegment({ ...common, targetPath: resolve(values.get('--target')) })
  process.stdout.write(`${JSON.stringify({ ok: true, mode, ...result })}\n`)
} catch (error) {
  const value = error && typeof error === 'object' ? error : {}
  process.stderr.write(`${JSON.stringify({ ok: false, code: typeof value.code === 'string' ? value.code : 'WAL_ARCHIVE_FAILED', message: error instanceof Error ? error.message : 'The WAL archive operation failed.' })}\n`)
  process.exitCode = 1
}
