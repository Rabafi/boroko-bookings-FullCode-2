import fs from 'fs/promises'
import path from 'path'
import sharp from 'sharp'
import pngToIco from 'png-to-ico'

const root = process.cwd()
const sourceSvg = path.join(root, 'src', 'main', 'assets', 'boroko-bookings-logo.svg')
const sourceDarkPng = path.join(root, 'src', 'main', 'assets', 'boroko-bookings-logo-dark.png')
const outDir = path.join(root, 'src', 'main', 'assets')
const pngSizes = [16, 32, 48, 64, 128, 256, 512]

async function main() {
  const iconSource = await fs.readFile(sourceDarkPng).catch(() => fs.readFile(sourceSvg))
  const pngBuffers = []

  for (const size of pngSizes) {
    const padding = Math.max(2, Math.round(size * 0.08))
    const png = await sharp(iconSource)
      .trim({ background: '#00000000' })
      .resize(size - padding * 2, size - padding * 2, {
        fit: 'contain',
        background: { r: 15, g: 61, b: 44, alpha: 0 }
      })
      .extend({
        top: padding,
        right: padding,
        bottom: padding,
        left: padding,
        background: { r: 15, g: 61, b: 44, alpha: 1 }
      })
      .png()
      .toBuffer()
    pngBuffers.push(png)
    await fs.writeFile(path.join(outDir, `boroko-bookings-icon-${size}.png`), png)
  }

  const ico = await pngToIco(pngBuffers)
  await fs.writeFile(path.join(outDir, 'boroko-bookings-icon.ico'), ico)

  console.log(`Wrote ${pngBuffers.length} PNG sizes and one ICO to ${outDir}`)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
