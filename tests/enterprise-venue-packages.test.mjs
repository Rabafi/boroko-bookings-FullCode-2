import { readFileSync } from 'fs'
import { describe, it } from 'node:test'
import assert from 'node:assert'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const read = (path) => readFileSync(join(root, path), 'utf8')
const migration = read('supabase/migrations/20260714230000_venue_packages.sql')

const indexJs = read('src/main/index.js')
const preloadJs = read('src/preload/index.js')
const databaseJs = read('src/main/database.js')

describe('Venue Packages', () => {
  describe('SQL Migration', () => {
    it('creates venue_packages table', () => {
      assert.match(migration, /CREATE TABLE.*venue_packages/)
    })
    it('creates get_venue_packages RPC', () => {
      assert.match(migration, /get_venue_packages/)
    })
    it('creates create_venue_package RPC', () => {
      assert.match(migration, /create_venue_package/)
    })
    it('creates update_venue_package RPC', () => {
      assert.match(migration, /update_venue_package/)
    })
    it('creates delete_venue_package RPC', () => {
      assert.match(migration, /delete_venue_package/)
    })
    it('creates apply_venue_package_to_event RPC', () => {
      assert.match(migration, /apply_venue_package_to_event/)
    })
    it('enables RLS', () => {
      assert.match(migration, /ENABLE ROW LEVEL SECURITY/)
    })
    it('grants EXECUTE to authenticated', () => {
      const gc = (migration.match(/GRANT EXECUTE/g) || []).length
      assert.ok(gc >= 5, `Expected >=5 GRANT EXECUTE, found ${gc}`)
    })
    it('uses SECURITY DEFINER and app_require_feature', () => {
      assert.match(migration, /SECURITY DEFINER/)
      assert.match(migration, /app_require_feature/)
    })
    it('has no placeholder patterns', () => {
      assert.doesNotMatch(migration, /TODO|FIXME|placeholder|replace_me/i)
    })
  })

  describe('Database Facade', () => {
    it('re-exports getVenuePackages', () => assert.match(databaseJs, /getVenuePackages/))
    it('re-exports createVenuePackage', () => assert.match(databaseJs, /createVenuePackage/))
    it('re-exports updateVenuePackage', () => assert.match(databaseJs, /updateVenuePackage/))
    it('re-exports deleteVenuePackage', () => assert.match(databaseJs, /deleteVenuePackage/))
    it('re-exports applyVenuePackageToEvent', () => assert.match(databaseJs, /applyVenuePackageToEvent/))
  })

  describe('IPC Handlers', () => {
    it('registers events:getVenuePackages', () => assert.match(indexJs, /events:getVenuePackages/))
    it('registers events:createVenuePackage', () => assert.match(indexJs, /events:createVenuePackage/))
    it('registers events:updateVenuePackage', () => assert.match(indexJs, /events:updateVenuePackage/))
    it('registers events:deleteVenuePackage', () => assert.match(indexJs, /events:deleteVenuePackage/))
    it('registers events:applyPackage', () => assert.match(indexJs, /events:applyPackage/))
  })

  describe('Preload Bridge', () => {
    it('has getVenuePackages method', () => assert.match(preloadJs, /getVenuePackages:/))
    it('has createVenuePackage method', () => assert.match(preloadJs, /createVenuePackage:/))
    it('has deleteVenuePackage method', () => assert.match(preloadJs, /deleteVenuePackage:/))
    it('has applyPackage method', () => assert.match(preloadJs, /applyPackage:/))
  })

  describe('Domain Module', () => {
    it('venue package functions exist in events.js', () => {
      const eventsJs = read('src/main/domains/events.js')
      assert.match(eventsJs, /export async function createVenuePackage/)
      assert.match(eventsJs, /export async function updateVenuePackage/)
      assert.match(eventsJs, /export async function deleteVenuePackage/)
      assert.match(eventsJs, /export async function applyVenuePackageToEvent/)
      assert.match(eventsJs, /export const getVenuePackages/)
    })
  })
})
