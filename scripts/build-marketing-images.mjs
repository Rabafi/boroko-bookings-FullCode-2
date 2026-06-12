import fs from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'

const root = process.cwd()
const sources = [
  {
    name: 'screenshots',
    sourceDir: path.join(root, 'marketing-site', 'assets', 'screenshots'),
    outputDir: path.join(root, 'marketing-site', 'assets', 'generated', 'screenshots')
  },
  {
    name: 'photos',
    sourceDir: path.join(root, 'marketing-site', 'assets', 'photos'),
    outputDir: path.join(root, 'marketing-site', 'assets', 'generated', 'photos')
  }
]

const widthTargets = {
  landscape: [640, 960, 1280, 1600],
  portrait: [240, 320, 400, 480]
}

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true })
}

async function buildImageVariants(sourceDir, outputDir, fileName) {
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
  for (const source of sources) {
    await ensureDir(source.outputDir)
    const entries = await fs.readdir(source.sourceDir).catch(() => [])
    const images = entries.filter((file) => /\.(png|jpe?g)$/i.test(file))
    const manifest = {}

    for (const fileName of images) {
      const result = await buildImageVariants(source.sourceDir, source.outputDir, fileName)
      manifest[fileName] = result
      console.log(`built ${source.name}/${fileName}`)
    }

    await fs.writeFile(
      path.join(source.outputDir, 'manifest.json'),
      JSON.stringify(manifest, null, 2) + '\n',
      'utf8'
    )
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
