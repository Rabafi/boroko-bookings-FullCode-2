import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { importUpdatePackageDirectory } from '../../src/main/bar-local/updates.js'

test('offline update import copies a selected directory atomically into the service inbox', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'bar-offline-update-import-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const source = path.join(root, 'usb', 'release')
  const inbox = path.join(root, 'service', 'updates', 'inbox')
  await mkdir(source, { recursive: true })
  await mkdir(path.join(source, 'payload'))
  await writeFile(path.join(source, 'update-manifest.json'), '{"format":"bar-local-update"}\n')
  await writeFile(path.join(source, 'payload', 'service.js'), 'signed release bytes\n')

  const result = await importUpdatePackageDirectory({ sourceDir: source, inboxDir: inbox })
  assert.match(result.package, /^offline-[0-9a-f-]{36}$/)
  assert.equal(result.files, 2)
  assert.ok(result.bytes > 0)
  assert.equal(await readFile(path.join(inbox, result.package, 'payload', 'service.js'), 'utf8'), 'signed release bytes\n')
  assert.deepEqual((await readdir(inbox)).sort(), [result.package])
})

test('offline update import refuses a symbolic-link package root', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'bar-offline-update-link-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const source = path.join(root, 'release')
  const link = path.join(root, 'release-link')
  const inbox = path.join(root, 'inbox')
  await mkdir(source)
  try {
    await import('node:fs/promises').then(({ symlink }) => symlink(source, link, 'dir'))
  } catch {
    t.skip('This Windows environment does not permit creating a directory symlink.')
    return
  }
  await assert.rejects(importUpdatePackageDirectory({ sourceDir: link, inboxDir: inbox }), /real update package folder/i)
})
