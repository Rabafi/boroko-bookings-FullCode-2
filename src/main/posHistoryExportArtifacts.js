import fs from 'fs'
import crypto from 'crypto'
import * as XLSX from '@e965/xlsx'

function verifiedFile(filePath, predicate, message) {
  const saved = fs.statSync(filePath)
  if (!saved.isFile() || saved.size <= 0) throw new Error(message)
  const bytes = fs.readFileSync(filePath)
  if (!predicate(bytes)) throw new Error(message)
  return {
    byteCount: saved.size,
    fileHash: crypto.createHash('sha256').update(bytes).digest('hex')
  }
}

export function writePosHistoryExcelArtifact(filePath, workbook) {
  const bytes = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' })
  fs.writeFileSync(filePath, bytes)
  const result = verifiedFile(filePath, () => true, 'The POS Excel file was not written.')
  const reopened = XLSX.read(fs.readFileSync(filePath), { type: 'buffer', bookSheets: true })
  if (!Array.isArray(reopened.SheetNames) || !reopened.SheetNames.includes('Summary')) {
    throw new Error('The POS Excel file could not be reopened for verification.')
  }
  return result
}

export function writePosHistoryPdfArtifact(filePath, pdfBuffer) {
  fs.writeFileSync(filePath, pdfBuffer)
  return verifiedFile(filePath, (bytes) => bytes.length >= 20 && bytes.subarray(0, 4).toString() === '%PDF', 'The POS PDF file could not be written or reopened.')
}

export function writePosHistoryJsonArtifact(filePath, dataset) {
  fs.writeFileSync(filePath, JSON.stringify(dataset, null, 2), 'utf8')
  const result = verifiedFile(filePath, (bytes) => bytes.length > 2, 'The POS detailed companion file was not written.')
  JSON.parse(fs.readFileSync(filePath, 'utf8'))
  return result
}
