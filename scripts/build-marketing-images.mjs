import fs from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'

const root = process.cwd()
const sourceDir = path.join(root, 'marketing-site', 'assets', 'screenshots')
const outputDir = path.join(root, 'marketing-site', 'assets', 'generated', 'screenshots')

const widthTargets = {
  landscape: [640, 960, 1280, 1600],
  portrait: [240, 320, 400, 480]
}

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true })
}

async function buildImageVariants(fileName) {
  const inputPath = path.join(sourceDir, fileName)
  const image = sharp(inputPath)
  const metadata = await image.metadata()
  const orientation = metadata.width >= metadata.height ? 'landscape' : 'portrait'
  const targets = widthTargets[orientation].filter((width) => width < metadata.width)
  const widths = [...targets, metadata.width]
  const baseName = path.parse(fileName).name

  for (const width of widths) {
    const resized = sharp(inputPath).resize({ width, withoutEnlargement: true })
    await Promise.all([
      resized
        .clone()
        .avif({ quality: 58, effort: 6 })
        .toFile(path.join(outputDir, `${baseName}-${width}.avif`)),
      resized
        .clone()
        .webp({ quality: 74, effort: 6 })
        .toFile(path.join(outputDir, `${baseName}-${width}.webp`))
    ])
  }

  return { fileName, width: metadata.width, height: metadata.height, orientation, widths }
}

async function main() {
  await ensureDir(outputDir)
  const entries = await fs.readdir(sourceDir)
  const pngs = entries.filter((file) => file.toLowerCase().endsWith('.png'))
  const manifest = {}

  for (const fileName of pngs) {
    const result = await buildImageVariants(fileName)
    manifest[fileName] = result
    console.log(`built ${fileName}`)
  }

  await fs.writeFile(
    path.join(outputDir, 'manifest.json'),
    JSON.stringify(manifest, null, 2) + '\n',
    'utf8'
  )
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
