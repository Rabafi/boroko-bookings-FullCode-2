// Generates icon-192.png and icon-512.png for the PWA manifest
// Run with: node generate-icons.mjs

import { createCanvas, loadImage } from 'canvas'
import { writeFileSync, mkdirSync, copyFileSync, readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __dir = dirname(fileURLToPath(import.meta.url))
const sourceSvg = 'C:/Users/Botswapelo Studios/Documents/Work/Boroko Business/Logo/Boroko Bookings Logo-01.svg'

async function generateIcon(size) {
  const canvas = createCanvas(size, size)
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, size, size)

  const wrappedSvg = readFileSync(sourceSvg, 'utf8').replace(
    '<svg ',
    '<svg width="841.89" height="595.28" '
  )
  const logo = await loadImage(`data:image/svg+xml;base64,${Buffer.from(wrappedSvg).toString('base64')}`)
  const scale = Math.min((size * 0.78) / logo.width, (size * 0.78) / logo.height)
  const drawWidth = logo.width * scale
  const drawHeight = logo.height * scale
  const x = (size - drawWidth) / 2
  const y = (size - drawHeight) / 2
  ctx.drawImage(logo, x, y, drawWidth, drawHeight)

  return canvas.toBuffer('image/png')
}

mkdirSync(join(__dir, 'public', 'icons'), { recursive: true })

const logoCopyTarget = join(__dir, 'public', 'boroko-bookings-logo.svg')
copyFileSync(sourceSvg, logoCopyTarget)

const icon192 = await generateIcon(192)
const icon512 = await generateIcon(512)
writeFileSync(join(__dir, 'public', 'icons', 'icon-192.png'), icon192)
writeFileSync(join(__dir, 'public', 'icons', 'icon-512.png'), icon512)
console.log('✅ PNG icons generated: public/icons/icon-192.png, icon-512.png')
