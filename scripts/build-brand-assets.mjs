import fs from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'
import pngToIco from 'png-to-ico'

const root = process.cwd()
const sourceDir = path.join(root, 'logos')
const assets = Object.freeze({
  ecosystem: {
    source: 'tsa_bonno_hospitalityos_transparent.svg',
    stem: 'tsa-bonno-hospitalityos',
    whiteReplacements: [['#123D28', '#FFFFFF']],
    mark: { left: 360, top: 145, width: 535, height: 470 }
  },
  lodging: {
    source: 'tsa_bonno_lodgingos_transparent.svg',
    stem: 'tsa-bonno-lodgingos',
    whiteReplacements: [['#7E8E60', '#FFFFFF']],
    mark: { left: 365, top: 130, width: 530, height: 500 }
  },
  hotel: {
    source: 'tsa_bonno_hotelos_transparent.svg',
    stem: 'tsa-bonno-hotelos',
    whiteReplacements: [['#D5A461', '#FFFFFF'], ['#8A4F16', '#FFFFFF']],
    mark: { left: 360, top: 130, width: 535, height: 500 }
  },
  restaurant: {
    source: 'tsa_bonno_restaurant_bar_os_transparent.svg',
    stem: 'tsa-bonno-restaurant-bar-os',
    whiteReplacements: [['#F0A23A', '#FFFFFF'], ['#C84E24', '#FFFFFF']],
    mark: { left: 350, top: 125, width: 555, height: 510 }
  }
})

const destinations = [
  path.join(root, 'src', 'main', 'assets'),
  path.join(root, 'src', 'renderer', 'src', 'assets'),
  path.join(root, 'manager-pwa', 'src', 'assets'),
  path.join(root, 'manager-pwa', 'public'),
  path.join(root, 'marketing-site', 'assets')
]

const iconSizes = [16, 32, 48, 64, 128, 192, 256, 512]
const generated = new Map()

function makeWhiteSvg(svg, replacements) {
  return replacements.reduce(
    (result, [from, to]) => result.replaceAll(from, to),
    svg
  )
}

for (const [key, config] of Object.entries(assets)) {
  const svg = await fs.readFile(path.join(sourceDir, config.source), 'utf8')
  const lightSvg = makeWhiteSvg(svg, config.whiteReplacements)
  const transparentCanvas = { r: 0, g: 0, b: 0, alpha: 0 }
  const colorPng = await sharp(Buffer.from(svg))
    .trim()
    .resize(1000, 400, { fit: 'contain', background: transparentCanvas })
    .png()
    .toBuffer()
  const lightPng = await sharp(Buffer.from(lightSvg))
    .trim()
    .resize(1000, 400, { fit: 'contain', background: transparentCanvas })
    .png()
    .toBuffer()

  for (const destination of destinations) {
    await fs.mkdir(destination, { recursive: true })
    await fs.writeFile(path.join(destination, `${config.stem}-logo.svg`), svg)
    await fs.writeFile(path.join(destination, `${config.stem}-logo-color.png`), colorPng)
    await fs.writeFile(path.join(destination, `${config.stem}-logo-light.png`), lightPng)
  }

  const iconBuffers = new Map()
  for (const size of iconSizes) {
    const padding = Math.max(2, Math.round(size * 0.12))
    const icon = await sharp(Buffer.from(svg))
      .extract(config.mark)
      .resize(size - padding * 2, size - padding * 2, { fit: 'contain' })
      .extend({
        top: padding,
        right: padding,
        bottom: padding,
        left: padding,
        background: { r: 250, g: 248, b: 244, alpha: 1 }
      })
      .png()
      .toBuffer()
    iconBuffers.set(size, icon)
    await fs.writeFile(
      path.join(root, 'src', 'main', 'assets', `${config.stem}-icon-${size}.png`),
      icon
    )
  }
  const ico = await pngToIco([16, 32, 48, 64, 128, 256].map((size) => iconBuffers.get(size)))
  await fs.writeFile(path.join(root, 'src', 'main', 'assets', `${config.stem}-icon.ico`), ico)
  generated.set(key, { svg, lightSvg, colorPng, lightPng, iconBuffers, ico })
}

// Preserve the established ecosystem filenames while replacing their contents
// with the owner-supplied official artwork.
for (const destination of destinations) {
  await fs.writeFile(path.join(destination, 'tsa-bonno-hospitalityos-logo.svg'), generated.get('ecosystem').svg)
  await fs.writeFile(path.join(destination, 'tsa-bonno-hospitalityos-logo-dark.png'), generated.get('ecosystem').colorPng)
  await fs.writeFile(path.join(destination, 'tsa-bonno-hospitalityos-logo-light.png'), generated.get('ecosystem').lightPng)
}

const bookingAssets = path.join(root, 'booking-site', 'src', 'assets')
await fs.mkdir(bookingAssets, { recursive: true })
await fs.writeFile(path.join(bookingAssets, 'tsa-bonno-lodgingos-logo.svg'), generated.get('lodging').svg)
await fs.writeFile(path.join(bookingAssets, 'tsa-bonno-lodgingos-logo-color.png'), generated.get('lodging').colorPng)
await fs.writeFile(path.join(bookingAssets, 'tsa-bonno-lodgingos-logo-light.png'), generated.get('lodging').lightPng)

const legacyAssets = path.join(root, 'legacy-pos', 'src', 'renderer', 'src', 'assets')
await fs.mkdir(legacyAssets, { recursive: true })
await fs.writeFile(path.join(legacyAssets, 'tsa-bonno-restaurant-bar-os-logo.svg'), generated.get('restaurant').svg)
await fs.writeFile(path.join(legacyAssets, 'tsa-bonno-restaurant-bar-os-logo-color.png'), generated.get('restaurant').colorPng)
await fs.writeFile(path.join(legacyAssets, 'tsa-bonno-restaurant-bar-os-logo-light.png'), generated.get('restaurant').lightPng)

await fs.writeFile(path.join(root, 'legacy-pos', 'src', 'main', 'assets', 'icon.ico'), generated.get('restaurant').ico)
await fs.writeFile(path.join(root, 'manager-pwa', 'public', 'icons', 'icon-192.png'), generated.get('ecosystem').iconBuffers.get(192))
await fs.writeFile(path.join(root, 'manager-pwa', 'public', 'icons', 'icon-512.png'), generated.get('ecosystem').iconBuffers.get(512))

console.log('Official owner-supplied ecosystem and product SVGs, white-on-dark variants, PNGs, desktop icons, Legacy POS icon, booking logo, and PWA icons generated.')
