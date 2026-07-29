/**
 * Deterministic, lodge-scoped fixture rows for Phase 0.
 *
 * IDs intentionally live in a reserved UUID range and are only inserted by
 * scripts/test/seed-reset.mjs after the disposable-target guard passes. The
 * fixture contains no customer, booking, payment, or financial ledger rows.
 */

export const FIXTURE_IDS = Object.freeze({
  foodOutlet: '00000000-0000-4000-8000-000000000101',
  beverageOutlet: '00000000-0000-4000-8000-000000000102',
  room: '00000000-0000-4000-8000-000000000103',
  inventoryCoffee: '00000000-0000-4000-8000-000000000104',
  inventorySoda: '00000000-0000-4000-8000-000000000105',
  menuCoffee: '00000000-0000-4000-8000-000000000106',
  menuSoda: '00000000-0000-4000-8000-000000000107',
  testFeature: '00000000-0000-4000-8000-000000000108'
})

export function buildFixtureRows(lodgeId) {
  return {
    settings: {
      lodge_id: lodgeId,
      lodge_name: 'Boroko Automated Test Lodge',
      company_name: 'Boroko Automated Test Lodge',
      business_type: 'lodge',
      currency: 'P',
      setup_complete: true,
      vat_enabled: false,
      vat_rate: 0,
      slug: `boroko-test-${lodgeId.slice(0, 8).toLowerCase()}`
    },
    feature: {
      id: FIXTURE_IDS.testFeature,
      lodge_id: lodgeId,
      feature_name: 'test_mode_enabled',
      enabled: true,
      reason: 'Phase 0 disposable integration tenant',
      expires_at: null
    },
    outlets: [
      {
        id: FIXTURE_IDS.foodOutlet,
        lodge_id: lodgeId,
        name: 'Test Restaurant',
        type: 'food',
        is_active: true,
        sort_order: 1
      },
      {
        id: FIXTURE_IDS.beverageOutlet,
        lodge_id: lodgeId,
        name: 'Test Bar',
        type: 'beverage',
        is_active: true,
        sort_order: 2
      }
    ],
    rooms: [
      {
        id: FIXTURE_IDS.room,
        lodge_id: lodgeId,
        room_number: 'TEST-01',
        room_type: 'Test Room',
        rate_per_night: 0,
        max_occupancy: 2,
        status: 'available',
        housekeeping_status: 'clean'
      }
    ],
    inventoryItems: [
      {
        id: FIXTURE_IDS.inventoryCoffee,
        lodge_id: lodgeId,
        outlet_id: FIXTURE_IDS.foodOutlet,
        name: 'Test Coffee Beans',
        category: 'Restaurant Test',
        unit: 'unit',
        current_stock: 100,
        reorder_level: 10,
        latest_unit_cost: 2,
        selling_price: 5
      },
      {
        id: FIXTURE_IDS.inventorySoda,
        lodge_id: lodgeId,
        outlet_id: FIXTURE_IDS.beverageOutlet,
        name: 'Test Soda',
        category: 'Bar Test',
        unit: 'unit',
        current_stock: 100,
        reorder_level: 10,
        latest_unit_cost: 3,
        selling_price: 8
      }
    ],
    menuItems: [
      {
        id: FIXTURE_IDS.menuCoffee,
        lodge_id: lodgeId,
        outlet_id: FIXTURE_IDS.foodOutlet,
        inventory_item_id: FIXTURE_IDS.inventoryCoffee,
        name: 'Test Coffee',
        category: 'Restaurant Test',
        price: 5,
        is_available: true,
        depletion_qty: 1,
        auto_from_inventory: true,
        template_kind: 'standard'
      },
      {
        id: FIXTURE_IDS.menuSoda,
        lodge_id: lodgeId,
        outlet_id: FIXTURE_IDS.beverageOutlet,
        inventory_item_id: FIXTURE_IDS.inventorySoda,
        name: 'Test Soda',
        category: 'Bar Test',
        price: 8,
        is_available: true,
        depletion_qty: 1,
        auto_from_inventory: true,
        template_kind: 'standard'
      }
    ]
  }
}

export function allFixtureRows(lodgeId) {
  const fixture = buildFixtureRows(lodgeId)
  return [
    fixture.settings,
    fixture.feature,
    ...fixture.outlets,
    ...fixture.rooms,
    ...fixture.inventoryItems,
    ...fixture.menuItems
  ]
}
