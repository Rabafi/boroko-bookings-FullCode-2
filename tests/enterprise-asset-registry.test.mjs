import { readFileSync } from 'fs'
import { describe, it } from 'node:test'
import assert from 'node:assert'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const read = (path) => readFileSync(join(root, path), 'utf8')
const migration = read('supabase/migrations/20260714220000_asset_registry_and_vendors.sql')

const indexJs = read('src/main/index.js')
const preloadJs = read('src/preload/index.js')
const databaseJs = read('src/main/database.js')

describe('Asset Registry & Vendor Management', () => {
  describe('SQL Migration', () => {
    it('creates property_assets table', () => {
      assert.match(migration, /CREATE TABLE.*property_assets/)
    })
    it('creates asset_maintenance_log table', () => {
      assert.match(migration, /CREATE TABLE.*asset_maintenance_log/)
    })
    it('creates maintenance_vendors table', () => {
      assert.match(migration, /CREATE TABLE.*maintenance_vendors/)
    })
    it('creates get_property_assets RPC', () => {
      assert.match(migration, /get_property_assets/)
    })
    it('creates create_property_asset RPC', () => {
      assert.match(migration, /create_property_asset/)
    })
    it('creates update_property_asset RPC', () => {
      assert.match(migration, /update_property_asset/)
    })
    it('creates delete_property_asset RPC', () => {
      assert.match(migration, /delete_property_asset/)
    })
    it('creates get_asset_maintenance_history RPC', () => {
      assert.match(migration, /get_asset_maintenance_history/)
    })
    it('creates log_asset_maintenance RPC', () => {
      assert.match(migration, /log_asset_maintenance/)
    })
    it('creates get_maintenance_vendors RPC', () => {
      assert.match(migration, /get_maintenance_vendors/)
    })
    it('creates create_maintenance_vendor RPC', () => {
      assert.match(migration, /create_maintenance_vendor/)
    })
    it('enables RLS on all tables', () => {
      const rlsCount = (migration.match(/ENABLE ROW LEVEL SECURITY/g) || []).length
      assert.ok(rlsCount >= 3, `Expected >=3 RLS, found ${rlsCount}`)
    })
    it('grants EXECUTE to authenticated on all RPCs', () => {
      const grantCount = (migration.match(/GRANT EXECUTE/g) || []).length
      assert.ok(grantCount >= 9, `Expected >=9 GRANT EXECUTE, found ${grantCount}`)
    })
    it('has SECURITY DEFINER on all RPCs', () => {
      const sdCount = (migration.match(/SECURITY DEFINER/g) || []).length
      assert.ok(sdCount >= 9, `Expected >=9 SECURITY DEFINER, found ${sdCount}`)
    })
    it('uses app_require_feature in all RPCs', () => {
      const rcCount = (migration.match(/app_require_feature/g) || []).length
      assert.ok(rcCount >= 9, `Expected >=9 app_require_feature, found ${rcCount}`)
    })
    it('has no placeholder patterns', () => {
      assert.doesNotMatch(migration, /TODO|FIXME|placeholder|replace_me/i)
    })
  })

  describe('Database Facade', () => {
    it('re-exports getPropertyAssets', () => assert.match(databaseJs, /getPropertyAssets/))
    it('re-exports createPropertyAsset', () => assert.match(databaseJs, /createPropertyAsset/))
    it('re-exports updatePropertyAsset', () => assert.match(databaseJs, /updatePropertyAsset/))
    it('re-exports deletePropertyAsset', () => assert.match(databaseJs, /deletePropertyAsset/))
    it('re-exports getMaintenanceVendors', () => assert.match(databaseJs, /getMaintenanceVendors/))
    it('re-exports createMaintenanceVendor', () => assert.match(databaseJs, /createMaintenanceVendor/))
  })

  describe('IPC Handlers', () => {
    it('registers assetRegistry:getAssets', () => assert.match(indexJs, /assetRegistry:getAssets/))
    it('registers assetRegistry:createAsset', () => assert.match(indexJs, /assetRegistry:createAsset/))
    it('registers assetRegistry:updateAsset', () => assert.match(indexJs, /assetRegistry:updateAsset/))
    it('registers assetRegistry:deleteAsset', () => assert.match(indexJs, /assetRegistry:deleteAsset/))
    it('registers assetRegistry:getMaintenanceHistory', () => assert.match(indexJs, /assetRegistry:getMaintenanceHistory/))
    it('registers assetRegistry:logMaintenance', () => assert.match(indexJs, /assetRegistry:logMaintenance/))
    it('registers assetRegistry:getVendors', () => assert.match(indexJs, /assetRegistry:getVendors/))
    it('registers assetRegistry:createVendor', () => assert.match(indexJs, /assetRegistry:createVendor/))
    it('registers assetRegistry:updateVendor', () => assert.match(indexJs, /assetRegistry:updateVendor/))
    it('registers assetRegistry:deleteVendor', () => assert.match(indexJs, /assetRegistry:deleteVendor/))
  })

  describe('Preload Bridge', () => {
    it('exports assetRegistry section', () => assert.match(preloadJs, /assetRegistry:/))
    it('has getAssets method', () => assert.match(preloadJs, /getAssets:/))
    it('has createAsset method', () => assert.match(preloadJs, /createAsset:/))
    it('has getVendors method', () => assert.match(preloadJs, /getVendors:/))
    it('has createVendor method', () => assert.match(preloadJs, /createVendor:/))
  })

  describe('Domain Module', () => {
    it('assetRegistry domain file exists', () => {
      try {
        read('src/main/domains/assetRegistry.js')
        assert.ok(true)
      } catch {
        assert.ok(false, 'assetRegistry.js not found')
      }
    })
  })
})
