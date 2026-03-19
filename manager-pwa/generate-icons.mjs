// Generates icon-192.png and icon-512.png for the PWA manifest
// Run with: node generate-icons.mjs

import { createCanvas } from 'canvas'
import { writeFileSync, mkdirSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __dir = dirname(fileURLToPath(import.meta.url))

function generateIcon(size) {
  const canvas = createCanvas(size, size)
  const ctx = canvas.getContext('2d')
  const r = size * 0.13 // corner radius

  // Background — dark green rounded rect
  ctx.beginPath()
  ctx.moveTo(r, 0)
  ctx.lineTo(size - r, 0)
  ctx.quadraticCurveTo(size, 0, size, r)
  ctx.lineTo(size, size - r)
  ctx.quadraticCurveTo(size, size, size - r, size)
  ctx.lineTo(r, size)
  ctx.quadraticCurveTo(0, size, 0, size - r)
  ctx.lineTo(0, r)
  ctx.quadraticCurveTo(0, 0, r, 0)
  ctx.closePath()
  ctx.fillStyle = '#14532d'
  ctx.fill()

  // Tent / lodge shape in white
  const cx = size / 2
  const scale = size / 192

  ctx.fillStyle = '#ffffff'
  ctx.beginPath()
  // Triangle roof
  ctx.moveTo(cx, 52 * scale)
  ctx.lineTo(148 * scale, 118 * scale)
  ctx.lineTo(44 * scale, 118 * scale)
  ctx.closePath()
  ctx.fill()

  // Door rectangle
  ctx.fillRect(82 * scale, 118 * scale, 28 * scale, 36 * scale)

  // Small chimney
  ctx.fillRect(118 * scale, 90 * scale, 10 * scale, 28 * scale)

  return canvas.toBuffer('image/png')
}

mkdirSync(join(__dir, 'public', 'icons'), { recursive: true })
writeFileSync(join(__dir, 'public', 'icons', 'icon-192.png'), generateIcon(192))
writeFileSync(join(__dir, 'public', 'icons', 'icon-512.png'), generateIcon(512))
console.log('✅ PNG icons generated: public/icons/icon-192.png, icon-512.png')
