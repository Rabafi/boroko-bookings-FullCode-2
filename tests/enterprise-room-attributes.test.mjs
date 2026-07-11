import { test } from 'node:test'
import assert from 'node:assert/strict'

test('room attributes sql migration file exists', async () => {
  const fs = await import('fs')
  const files = fs.readdirSync('supabase/migrations')
  const migrationFile = files.find(f => f.includes('room_attributes'))
  assert.ok(migrationFile, 'No migration file found containing room_attributes')
})

test('migration creates room_attributes table', async () => {
  const fs = await import('fs')
  const files = fs.readdirSync('supabase/migrations')
  const migrationFile = files.find(f => f.includes('room_attributes'))
  const content = fs.readFileSync(`supabase/migrations/${migrationFile}`, 'utf8')
  assert.ok(content.includes('CREATE TABLE IF NOT EXISTS room_attributes'))
})

test('migration has required rpcs', async () => {
  const fs = await import('fs')
  const files = fs.readdirSync('supabase/migrations')
  const migrationFile = files.find(f => f.includes('room_attributes'))
  const content = fs.readFileSync(`supabase/migrations/${migrationFile}`, 'utf8')
  assert.ok(content.includes('get_room_attributes'))
  assert.ok(content.includes('create_room_attribute'))
  assert.ok(content.includes('update_room_attribute'))
  assert.ok(content.includes('delete_room_attribute'))
})

test('migration uses app_require_lodge_role pattern', async () => {
  const fs = await import('fs')
  const files = fs.readdirSync('supabase/migrations')
  const migrationFile = files.find(f => f.includes('room_attributes'))
  const content = fs.readFileSync(`supabase/migrations/${migrationFile}`, 'utf8')
  assert.ok(content.includes('app_require_lodge_role'))
})

test('migration enables rls on room_attributes table', async () => {
  const fs = await import('fs')
  const files = fs.readdirSync('supabase/migrations')
  const migrationFile = files.find(f => f.includes('room_attributes'))
  const content = fs.readFileSync(`supabase/migrations/${migrationFile}`, 'utf8')
  assert.ok(content.includes('ENABLE ROW LEVEL SECURITY'))
})

test('migration grants execute to authenticated on all rpcs', async () => {
  const fs = await import('fs')
  const files = fs.readdirSync('supabase/migrations')
  const migrationFile = files.find(f => f.includes('room_attributes'))
  const content = fs.readFileSync(`supabase/migrations/${migrationFile}`, 'utf8')
  assert.ok(content.includes('GRANT EXECUTE ON FUNCTION get_room_attributes TO authenticated'))
  assert.ok(content.includes('GRANT EXECUTE ON FUNCTION create_room_attribute TO authenticated'))
  assert.ok(content.includes('GRANT EXECUTE ON FUNCTION update_room_attribute TO authenticated'))
  assert.ok(content.includes('GRANT EXECUTE ON FUNCTION delete_room_attribute TO authenticated'))
})

test('room attributes domain file exists', async () => {
  const fs = await import('fs')
  assert.ok(fs.existsSync('src/main/domains/roomAttributes.js'))
})

test('room attributes domain exports required functions', async () => {
  const fs = await import('fs')
  const content = fs.readFileSync('src/main/domains/roomAttributes.js', 'utf8')
  assert.ok(content.includes('export const getAllRoomAttributes'))
  assert.ok(content.includes('export const createRoomAttribute'))
  assert.ok(content.includes('export const updateRoomAttribute'))
  assert.ok(content.includes('export const deleteRoomAttribute'))
})

test('room_attributes capabilities exist in access control', async () => {
  const { CAPABILITY_LABELS } = await import('../src/shared/accessControl.js')
  assert.equal(typeof CAPABILITY_LABELS['room_attributes.view'], 'string')
  assert.equal(typeof CAPABILITY_LABELS['room_attributes.manage'], 'string')
})

test('room_attributes module key exists in moduleCatalog', async () => {
  const { getModuleByKey } = await import('../src/shared/moduleCatalog.js')
  const mod = getModuleByKey('room_attributes')
  assert.notEqual(mod, null)
  assert.equal(mod.key, 'room_attributes')
})

test('room attributes route is /room-attributes', async () => {
  const { getModuleByKey } = await import('../src/shared/moduleCatalog.js')
  const mod = getModuleByKey('room_attributes')
  assert.ok(mod.routes.includes('/room-attributes'))
})

test('roomattributes react component file exists', async () => {
  const fs = await import('fs')
  assert.ok(fs.existsSync('src/renderer/src/components/RoomAttributes.jsx'))
})

test('roomattributes component uses window.api.roomAttributes', async () => {
  const fs = await import('fs')
  const content = fs.readFileSync('src/renderer/src/components/RoomAttributes.jsx', 'utf8')
  assert.ok(content.includes('window.api.roomAttributes'))
})

test('ipc handlers exist for roomAttributes', async () => {
  const fs = await import('fs')
  const content = fs.readFileSync('src/main/index.js', 'utf8')
  assert.ok(content.includes("ipcMain.handle('roomAttributes:getAll'"))
  assert.ok(content.includes("ipcMain.handle('roomAttributes:create'"))
  assert.ok(content.includes("ipcMain.handle('roomAttributes:update'"))
  assert.ok(content.includes("ipcMain.handle('roomAttributes:delete'"))
})

test('preload has roomAttributes section', async () => {
  const fs = await import('fs')
  const content = fs.readFileSync('src/preload/index.js', 'utf8')
  assert.ok(content.includes('roomAttributes:'))
  assert.ok(content.includes("roomAttributes:getAll'"))
  assert.ok(content.includes("roomAttributes:create'"))
  assert.ok(content.includes("roomAttributes:update'"))
  assert.ok(content.includes("roomAttributes:delete'"))
})

test('database.js exports roomAttributes', async () => {
  const fs = await import('fs')
  const content = fs.readFileSync('src/main/database.js', 'utf8')
  assert.ok(content.includes('getAllRoomAttributes'))
  assert.ok(content.includes('createRoomAttribute'))
  assert.ok(content.includes('updateRoomAttribute'))
  assert.ok(content.includes('deleteRoomAttribute'))
  assert.ok(content.includes("./domains/roomAttributes.js'"))
})

test('DEV_ENTERPRISE_PREVIEW_CAPABILITIES includes room_attributes caps', async () => {
  const fs = await import('fs')
  const content = fs.readFileSync('src/main/index.js', 'utf8')
  assert.ok(content.includes("'room_attributes.view'"))
  assert.ok(content.includes("'room_attributes.manage'"))
  assert.ok(content.includes('DEV_ENTERPRISE_PREVIEW_CAPABILITIES'))
})
