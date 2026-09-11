import sharp from 'sharp'
import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve('docs/bar-manual/assets/screenshots')
const raw = path.join(root, 'raw')
const annotated = path.join(root, 'annotated')
fs.mkdirSync(annotated, { recursive: true })

const marks = {
  '00-first-launch-splash.png': [[100,170,'1'],[220,255,'2']],
  '01-bar-workspace-sell.png': [[120,105,'1'],[460,155,'2'],[1160,720,'3']],
  '02-products-catalogue.png': [[130,115,'1'],[540,300,'2'],[1170,250,'3']],
  '03-service-stock.png': [[125,105,'1'],[1160,105,'2'],[1110,650,'3']],
  '04-cash-and-close.png': [[125,105,'1'],[920,310,'2'],[1110,645,'3']],
  '05-open-tabs.png': [[125,105,'1'],[530,300,'2'],[1160,570,'3']],
  '06-manage-workspace.png': [[130,110,'1'],[560,220,'2'],[1160,720,'3']],
  '07-opening-shift.png': [[720,350,'1'],[720,540,'2'],[720,690,'3']],
  '08-till-unlock.png': [[720,260,'1'],[720,520,'2'],[720,820,'3']],
  '09-payment-panel.png': [[120,105,'1'],[1030,560,'2'],[1120,710,'3']],
  '10-sales-report.png': [[260,145,'1'],[750,145,'2'],[1040,710,'3']],
  '11-customers-loyalty.png': [[130,105,'1'],[470,240,'2'],[1130,650,'3']],
  '12-expense-register.png': [[130,105,'1'],[470,240,'2'],[1120,650,'3']],
  '13-split-dialog.png': [[600,25,'1',120,25],[600,150,'2',520,150]],
  '14-transfer-waiter.png': [[530,56,'1',240,56],[530,156,'2',340,156],[530,290,'3',145,290]],
  '15-tab-recovery-inbox.png': [[210,150,'1'],[650,300,'2'],[1130,520,'3']],
  '17-completed-receipt.png': [[420,108,'1',55,108],[420,225,'2',90,225],[420,740,'3',120,740]],
  '18-sale-detail-reprint.png': [[330,120,'1'],[1110,120,'2'],[1070,440,'3']],
  '19-sale-correction-request.png': [[300,120,'1'],[1040,420,'2'],[1050,730,'3']],
  '20-product-edit.png': [[270,120,'1'],[560,360,'2'],[1100,820,'3']],
  '21-stock-delivery.png': [[210,255,'1',150,285],[355,330,'2',300,300],[550,420,'3',475,420]],
  '22-stock-count.png': [[365,18,'1',285,55],[505,220,'2',365,220],[545,382,'3',475,382]],
  '23-operator-cashup.png': [[360,120,'1'],[460,480,'2'],[760,720,'3']],
  '24-manager-cashup-review.png': [[360,120,'1'],[1010,350,'2'],[1080,690,'3']],
  '25-manager-cashup-approval.png': [[400,160,'1'],[900,530,'2'],[1060,760,'3']],
  '26-count-all.png': [[350,18,'1',285,55],[505,220,'2',365,220],[545,286,'3',475,286]]
}

for (const [file, points] of Object.entries(marks)) {
  const input = path.join(raw, file)
  if (!fs.existsSync(input)) continue
  const output = path.join(annotated, file.replace('.png', '-annotated.png'))
  const metadata = await sharp(input).metadata()
  const svg = '<svg width="' + metadata.width + '" height="' + metadata.height + '" xmlns="http://www.w3.org/2000/svg">' + points.map(([x, y, label, tx, ty]) => { const leader = tx == null ? '' : '<line x1="' + x + '" y1="' + y + '" x2="' + tx + '" y2="' + ty + '" stroke="#a65132" stroke-width="3" stroke-linecap="round" opacity="0.85"/>'; return leader + '<circle cx="' + x + '" cy="' + y + '" r="18" fill="#a65132" stroke="#fff8ef" stroke-width="5"/><text x="' + x + '" y="' + (y + 8) + '" text-anchor="middle" font-family="Arial" font-size="22" font-weight="700" fill="#fff8ef">' + label + '</text>' }).join('') + '</svg>'
  await sharp(input).composite([{ input: Buffer.from(svg), top: 0, left: 0 }]).png().toFile(output)
}
console.log('Annotated screenshots written to', annotated)