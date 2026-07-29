import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { execFileSync } from 'node:child_process'
import sharp from 'sharp'
import { ECOSYSTEM_BRAND, PRODUCT_BRANDS } from '../src/shared/brandIdentity.js'
import { PRODUCT_DEFINITIONS } from '../src/shared/productIdentity.js'

const root = process.cwd()
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8')

test('canonical public product names are exact', () => {
  assert.equal(ECOSYSTEM_BRAND.name, 'Tsa Bonno HospitalityOS')
  assert.equal(PRODUCT_BRANDS['lodge-camp'].name, 'Tsa Bonno LodgingOS')
  assert.equal(PRODUCT_BRANDS.hotel.name, 'Tsa Bonno HotelOS')
  assert.equal(PRODUCT_BRANDS['hospitality-pos'].name, 'Tsa Bonno Restaurant & Bar POS')
})

test('private workspace package identities use the Tsa Bonno scope', () => {
  const expectedNames = {
    'package.json': 'tsa-bonno-hospitalityos',
    'apps/lodge-camp/package.json': '@tsa-bonno/lodging-os',
    'apps/hotel/package.json': '@tsa-bonno/hotel-os',
    'apps/hospitality-pos/package.json': '@tsa-bonno/restaurant-bar-pos',
    'packages/product-config/package.json': '@tsa-bonno/product-config'
  }
  for (const [manifestPath, expectedName] of Object.entries(expectedNames)) {
    assert.equal(JSON.parse(read(manifestPath)).name, expectedName)
  }
  assert.match(read('electron.vite.config.js'), /__TSA_BONNO_PRODUCT__/)
  assert.doesNotMatch(read('electron.vite.config.js'), /__BOROKO_PRODUCT__/)
})

test('desktop product launchers fail closed instead of silently becoming LodgingOS', () => {
  const rootPackage = JSON.parse(read('package.json'))
  assert.equal(rootPackage.scripts.dev, 'node ./scripts/product-app.mjs lodge-camp dev')
  assert.equal(rootPackage.scripts['dev:hotel'], 'node ./scripts/product-app.mjs hotel dev')
  assert.equal(rootPackage.scripts['dev:restaurant-bar'], 'node ./scripts/product-app.mjs hospitality-pos dev')
  assert.equal(rootPackage.main, 'scripts/electron-product-entry.cjs')
  assert.match(read('scripts/electron-product-entry.cjs'), /BOROKO_PRODUCT must explicitly select a desktop product/)
  assert.match(read('scripts/electron-product-entry.cjs'), /out', productId, 'main', 'index\.js/)
  assert.match(read('electron.vite.config.js'), /BOROKO_PRODUCT must be explicitly set/)
  assert.doesNotMatch(read('electron.vite.config.js'), /BOROKO_PRODUCT\?\.trim\(\) \|\| 'lodge-camp'/)
  assert.doesNotMatch(read('docs/PRODUCT_WORKSPACE.md'), /@boroko\/(?:lodge-camp|hotel|hospitality-pos)/)
})

test('desktop products compile and package from isolated output directories', () => {
  const config = read('electron.vite.config.js')
  assert.match(config, /out\/\$\{productId\}\/main/)
  assert.match(config, /out\/\$\{productId\}\/preload/)
  assert.match(config, /out\/\$\{productId\}\/renderer/)

  for (const productId of ['lodge-camp', 'hotel', 'hospitality-pos']) {
    const builder = JSON.parse(read(`apps/${productId}/electron-builder.json`))
    assert.equal(builder.extraMetadata.main, `out/${productId}/main/index.js`)
    assert.ok(builder.files.includes(`out/${productId}/**/*`))
    assert.equal(builder.files.some((entry) => entry === 'out/**/*'), false)
  }
})

test('packaged app.asar trees remain product-isolated when dist artifacts exist', async () => {
  const products = [
    {
      id: 'lodge-camp',
      asar: 'dist/lodge-camp/win-unpacked/resources/app.asar',
      main: 'out/lodge-camp/main/index.js',
      productName: 'Tsa Bonno LodgingOS',
      releaseRepo: 'boroko-bookings-releases',
      productJson: 'dist/lodge-camp/win-unpacked/resources/product.json',
      updateYml: 'dist/lodge-camp/win-unpacked/resources/app-update.yml',
      logoStem: 'tsa-bonno-lodgingos'
    },
    {
      id: 'hotel',
      asar: 'dist/hotel/win-unpacked/resources/app.asar',
      main: 'out/hotel/main/index.js',
      productName: 'Tsa Bonno HotelOS',
      releaseRepo: 'boroko-hotel-releases',
      productJson: 'dist/hotel/win-unpacked/resources/product.json',
      updateYml: 'dist/hotel/win-unpacked/resources/app-update.yml',
      logoStem: 'tsa-bonno-hotelos'
    },
    {
      id: 'hospitality-pos',
      asar: 'dist/hospitality-pos/win-unpacked/resources/app.asar',
      main: 'out/hospitality-pos/main/index.js',
      productName: 'Tsa Bonno Restaurant & Bar POS',
      releaseRepo: 'boroko-hospitality-pos-releases',
      productJson: 'dist/hospitality-pos/win-unpacked/resources/product.json',
      updateYml: 'dist/hospitality-pos/win-unpacked/resources/app-update.yml',
      logoStem: 'tsa-bonno-restaurant-bar-os'
    }
  ]

  const present = products.filter((product) => fs.existsSync(path.join(root, product.asar)))
  if (present.length === 0) {
    // Local dist artifacts are optional in CI checkouts without packaging.
    return
  }

  assert.equal(present.length, products.length, 'all three product packages must be present together for isolation proof')
  const asar = await import('@electron/asar')

  for (const product of present) {
    const asarPath = path.join(root, product.asar)
    const files = asar.default.listPackage(asarPath).map((file) => file.replace(/\\/g, '/'))
    const foreignProducts = ['lodge-camp', 'hotel', 'hospitality-pos'].filter((id) => id !== product.id)
    for (const foreign of foreignProducts) {
      const foreignHits = files.filter((file) => file.includes(`/out/${foreign}/`) || file.startsWith(`out/${foreign}/`))
      assert.equal(foreignHits.length, 0, `${product.id} asar must not include out/${foreign}`)
    }

    const intendedMainHits = files.filter((file) => file === product.main || file.endsWith(`/${product.main}`))
    assert.ok(intendedMainHits.length >= 1, `${product.id} asar must include ${product.main}`)

    const packaged = JSON.parse(asar.default.extractFile(asarPath, 'package.json').toString('utf8'))
    assert.equal(packaged.main, product.main)
    assert.equal(packaged.description, product.productName)

    const builder = JSON.parse(read(`apps/${product.id}/electron-builder.json`))
    // Packaged package.json name remains the installed-client data/updater bridge identity.
    assert.equal(packaged.name, builder.extraMetadata.name)
    assert.equal(builder.nsis.deleteAppDataOnUninstall, false)
    assert.equal(builder.nsis.shortcutName, product.productName)
    assert.equal(builder.nsis.uninstallDisplayName, product.productName)

    const productJson = JSON.parse(read(product.productJson))
    assert.equal(productJson.id, product.id)
    assert.equal(productJson.name, product.productName)

    const updateYml = read(product.updateYml)
    assert.match(updateYml, new RegExp(`repo:\\s*${product.releaseRepo}`))

    const assetsDir = path.join(root, path.dirname(product.asar), 'assets')
    assert.equal(fs.existsSync(path.join(assetsDir, `${product.logoStem}-icon.ico`)), true)
    assert.equal(fs.existsSync(path.join(assetsDir, `${product.logoStem}-logo-color.png`)), true)
  }
})

test('release helper help and invalid modes cannot mutate or publish', () => {
  const versionBefore = JSON.parse(read('package.json')).version
  const help = execFileSync(process.execPath, ['scripts/release.mjs', '--help'], { cwd: root, encoding: 'utf8' })
  assert.match(help, /Usage: node scripts\/release\.mjs/)
  assert.equal(JSON.parse(read('package.json')).version, versionBefore)
})

test('public rename does not break installed-client compatibility identities', () => {
  assert.equal(PRODUCT_DEFINITIONS['lodge-camp'].appId, 'com.boroko.bookings')
  assert.equal(PRODUCT_DEFINITIONS['lodge-camp'].appDataName, 'boroko-bookings')
  assert.equal(PRODUCT_DEFINITIONS['lodge-camp'].releaseRepo, 'boroko-bookings-releases')
  assert.equal(PRODUCT_DEFINITIONS.hotel.releaseRepo, 'boroko-hotel-releases')
  assert.equal(PRODUCT_DEFINITIONS['hospitality-pos'].releaseRepo, 'boroko-hospitality-pos-releases')
})

test('forward Supabase migration publishes Tsa Bonno labels without renaming product keys', () => {
  const sql = read('supabase/migrations/20260713013000_tsa_bonno_public_brand_labels.sql')
  assert.match(sql, /when 'lodge-camp' then 'Tsa Bonno LodgingOS'/)
  assert.match(sql, /when 'hotel' then 'Tsa Bonno HotelOS'/)
  assert.match(sql, /when 'hospitality-pos' then 'Tsa Bonno Restaurant & Bar POS'/)
  assert.match(sql, /pg_get_functiondef\('public\.calculate_commercial_quote\(jsonb\)'::regprocedure\)/)
  assert.doesNotMatch(sql, /update\s+(?:public\.)?(?:payments|bookings|pos_orders|audit_log)/i)
})

test('installer presentation is renamed while updater feeds remain isolated', () => {
  const expected = {
    'lodge-camp': ['Tsa Bonno LodgingOS', 'boroko-bookings-releases', 'src/main/assets/tsa-bonno-lodgingos-icon.ico'],
    hotel: ['Tsa Bonno HotelOS', 'boroko-hotel-releases', 'src/main/assets/tsa-bonno-hotelos-icon.ico'],
    'hospitality-pos': ['Tsa Bonno Restaurant & Bar POS', 'boroko-hospitality-pos-releases', 'src/main/assets/tsa-bonno-restaurant-bar-os-icon.ico']
  }
  for (const [productId, [productName, releaseRepo, iconPath]] of Object.entries(expected)) {
    const builder = JSON.parse(read(`apps/${productId}/electron-builder.json`))
    assert.equal(fs.existsSync(path.join(root, iconPath)), true)
    assert.equal(builder.productName, productName)
    assert.equal(builder.extraMetadata.description, productName)
    assert.equal(builder.publish.repo, releaseRepo)
    assert.match(builder.artifactName, /^Tsa-Bonno-/)
    assert.equal(builder.icon, iconPath)
    assert.equal(builder.win.icon, iconPath)
    assert.equal(builder.nsis.installerIcon, iconPath)
    assert.equal(builder.nsis.uninstallerIcon, iconPath)
  }
})

test('generated wordmark PNGs keep transparent padding for light and dark surfaces', async () => {
  const logoStems = [
    'tsa-bonno-hospitalityos',
    'tsa-bonno-lodgingos',
    'tsa-bonno-hotelos',
    'tsa-bonno-restaurant-bar-os'
  ]

  for (const stem of logoStems) {
    for (const variant of ['color', 'light']) {
      const { data, info } = await sharp(path.join(root, `src/main/assets/${stem}-logo-${variant}.png`))
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true })
      const cornerIndexes = [
        3,
        (info.width - 1) * 4 + 3,
        ((info.height - 1) * info.width) * 4 + 3,
        (info.height * info.width - 1) * 4 + 3
      ]
      assert.deepEqual(cornerIndexes.map((index) => data[index]), [0, 0, 0, 0], `${stem} ${variant} padding must be transparent`)
    }
  }
})

test('line-by-line brand audit has no unclassified references', () => {
  const report = JSON.parse(execFileSync(process.execPath, ['scripts/audit-brand-migration.mjs', '--json'], {
    cwd: root,
    encoding: 'utf8'
  }))
  assert.equal(report.unresolvedOccurrences, 0)
  const pending = report.findings.filter((finding) => finding.disposition.startsWith('pending-'))
  assert.ok(pending.length <= 1)
  if (pending.length === 1) {
    assert.equal(pending[0].file, 'supabase/.temp/linked-project.json')
    assert.equal(pending[0].disposition, 'pending-authenticated-external-rename')
  }
})
