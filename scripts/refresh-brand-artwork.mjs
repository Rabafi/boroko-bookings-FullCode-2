import fs from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'
import { smoothLettering } from './brand-lettering-curves.mjs'

// Explicit refresh from the approved CURRENT design, never the smaller-corner refinement.
const root = process.cwd()
const sourceDir = path.join(root, 'logos')
const outputDir = process.argv.includes('--preview') ? path.join(root, 'output/brand-concepts/smoothed-candidate') : sourceDir
const backup = path.join(root, 'output/brand-concepts/pre-refresh-2026-10-16')
const chosen = await fs.readFile(path.join(root, 'output/brand-concepts/design-2-exact-wordmark/tsa-bonno-design-2.svg'), 'utf8')
const chosenIcon = await fs.readFile(path.join(root, 'output/brand-concepts/design-2-exact-wordmark/tsa-bonno-design-2-icon.svg'), 'utf8')
const wordmark = smoothLettering(chosen.match(/id="original-tsa-bonno-wordmark" d="([\s\S]*?)"/)[1])
const typeface = JSON.parse((await fs.readFile(path.join(root, 'scripts/brand-helvetica-outlines.json'), 'utf8')).replace(/^\uFEFF/, ''))
const configs = [
  { key: 'hospitalityos', color: '#123D28', label: 'HOSPITALITY' },
  { key: 'lodgingos', color: '#7E8E60', label: 'LODGING' },
  { key: 'hotelos', color: '#8A4F16', label: 'HOTEL' },
  { key: 'restaurant_bar_os', color: '#C84E24', label: 'RESTAURANT AND BAR' }
]
await fs.mkdir(backup, { recursive: true })
await fs.mkdir(outputDir, { recursive: true })
for (const file of await fs.readdir(sourceDir)) {
  const target = path.join(backup, file)
  try { await fs.copyFile(path.join(sourceDir, file), target, fs.constants.COPYFILE_EXCL) }
  catch (error) { if (error.code !== 'EEXIST') throw error }
}

function typeset(text) {
  let x = 0, paths = ''
  const tracking = 90
  for (const char of text) {
    const glyph = typeface.glyphs[char]
    if (!glyph) throw new Error(`Missing Helvetica outline: ${char}`)
    if (glyph.d) paths += `<path transform="translate(${x} 0)" d="${glyph.d}"/>`
    x += glyph.advance + tracking
  }
  return { paths, width: x - tracking }
}

async function writeArtwork(file, contents) {
  const data = Buffer.isBuffer(contents) ? contents : Buffer.from(contents)
  try { if ((await fs.readFile(file)).equals(data)) return } catch (error) { if (error.code !== 'ENOENT') throw error }
  const temporary = `${file}.brand-next`
  await fs.writeFile(temporary, data)
  await fs.rename(temporary, file)
}

const iconBody = chosenIcon.match(/aria-label="[^"]*">([\s\S]*)<\/svg>/)[1]
const tb = iconBody.match(/<path d="M126[\s\S]*?\/>/)[0]
const filledBadge = iconBody.replace(tb, '')
const knockout = tb.replace('stroke="#FFFFFF"', 'stroke="#000000"')
const wrap = (body, width = 1600, height = 570, label = '') => `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="tsa bonno ${label} logo">${body}</svg>`
const previews = []
for (const config of configs) {
  const filename = `tsa_bonno_${config.key}_transparent.svg`
  const base = typeset(config.label), os = typeset('OS')
  const gap = 360
  const width = base.width + gap + os.width
  const scale = Math.min(44 / (typeface.yMax - typeface.yMin), 1000 / width)
  const left = 993 - width * scale / 2
  const top = 369 - typeface.yMin * scale
  const badge = `<defs><mask id="tb-knockout" maskUnits="userSpaceOnUse" x="0" y="0" width="512" height="512"><rect width="512" height="512" fill="white"/>${knockout}</mask></defs><g mask="url(#tb-knockout)">${filledBadge.replaceAll('#123D28', config.color)}</g>`
  const body = `<g id="approved-current-icon" transform="translate(65 105) scale(.70)">${badge}</g>
    <g transform="translate(480 164) scale(.96) translate(-98 -640)"><path id="original-tsa-bonno-wordmark" d="${wordmark}" fill="${config.color}" fill-rule="evenodd"/></g>
    <g id="helvetica-subtext" data-font="${typeface.family}" aria-label="${config.label} OS" transform="translate(${left} ${top}) scale(${scale})"><g fill="${config.color}">${base.paths}</g><g transform="translate(${base.width + gap} 0)" fill="#AC8238">${os.paths}</g></g>`
  const svg = wrap(body, 1600, 570, config.key)
  if (svg.match(/id="original-tsa-bonno-wordmark" d="([\s\S]*?)"/)[1] !== wordmark) throw new Error('Wordmark changed')
  const icon = wrap(badge, 512, 512, config.key)
  await writeArtwork(path.join(outputDir, filename), svg)
  await writeArtwork(path.join(outputDir, `tsa_bonno_${config.key}_icon.svg`), icon)
  await writeArtwork(path.join(outputDir, filename.replace('.svg', '.png')), await sharp(Buffer.from(svg)).resize(3200).png().toBuffer())
  await writeArtwork(path.join(outputDir, `tsa_bonno_${config.key}_icon.png`), await sharp(Buffer.from(icon)).resize(1024).png().toBuffer())
  previews.push({ input: await sharp(Buffer.from(wrap(`<rect width="1600" height="570" fill="#FAF8F1"/>${body}`))).resize(1200).png().toBuffer(), left: (previews.length % 2) * 1200, top: Math.floor(previews.length / 2) * 428 })
}
// The old raster reference stays in the backup, not among approved replacement assets.
for (const file of await fs.readdir(outputDir)) {
  if (file === 'ChatGPT Image Jul 15, 2026, 02_19_06 AM.png') await fs.unlink(path.join(sourceDir, file))
}
await sharp({ create: { width: 2400, height: 856, channels: 4, background: '#FAF8F1' } }).composite(previews).png().toFile(path.join(root, process.argv.includes('--preview') ? 'output/brand-concepts/smoothed-candidate/family-preview.png' : 'output/brand-concepts/approved-current-brand-family.png'))
console.log('Refreshed 4 logos with curve-smoothed original lettering and actual Helvetica Now Text subtext; icons unchanged.')
