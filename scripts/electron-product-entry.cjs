const path = require('node:path')

const productId = String(process.env.BOROKO_PRODUCT || '').trim()
const allowedProducts = new Set(['lodge-camp', 'hotel', 'hospitality-pos'])

if (!allowedProducts.has(productId)) {
  throw new Error(`BOROKO_PRODUCT must explicitly select a desktop product before Electron starts; received: ${productId || '<empty>'}`)
}

require(path.join(__dirname, '..', 'out', productId, 'main', 'index.js'))
