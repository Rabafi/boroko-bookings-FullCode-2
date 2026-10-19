import sharp from 'sharp'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const captureRoot = process.env.BAR_GUIDE_CAPTURE_DIR ? path.resolve(process.env.BAR_GUIDE_CAPTURE_DIR) : path.join(root, 'assets', 'screenshots')
const directory = captureRoot
const files = [
  { raw: '27-mesh-identity-warning.png', annotated: '27-mesh-identity-warning-annotated.png', x: 42, y: 78, label: '1' },
  { raw: '28-mesh-network-warning.png', annotated: '28-mesh-network-warning-annotated.png', x: 38, y: 34, label: '2' }
]
for (const item of files) {
  const input = path.join(directory, 'raw', item.raw)
  const output = path.join(directory, 'annotated', item.annotated)
  const metadata = await sharp(input).metadata()
  const width = metadata.width || 1440
  const height = metadata.height || 1000
  const x = Math.min(item.x, width - 30)
  const y = Math.min(item.y, height - 30)
  const svg = '<svg width="' + width + '" height="' + height + '" xmlns="http://www.w3.org/2000/svg">' +
    '<circle cx="' + x + '" cy="' + y + '" r="18" fill="#a65132" stroke="#fff8ef" stroke-width="5"/>' +
    '<text x="' + x + '" y="' + (y + 7) + '" text-anchor="middle" font-family="Arial" font-size="22" font-weight="700" fill="#fff8ef">' + item.label + '</text></svg>'
  await sharp(input).composite([{ input: Buffer.from(svg), top: 0, left: 0 }]).png().toFile(output)
  console.log('Annotated:', output)
}