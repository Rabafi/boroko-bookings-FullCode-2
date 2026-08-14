import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import * as XLSX from '@e965/xlsx'
import { writePosHistoryExcelArtifact, writePosHistoryJsonArtifact, writePosHistoryPdfArtifact } from '../src/main/posHistoryExportArtifacts.js'

test('POS Excel artifact handler writes, reopens, and hashes a temporary output', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'tsa-pos-excel-'))
  try {
    const filePath = path.join(directory, 'pos-history.xlsx')
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([['Report run', 'test'], ['Dataset hash', 'abc']]), 'Summary')
    const result = writePosHistoryExcelArtifact(filePath, workbook)
    const reopened = XLSX.read(fs.readFileSync(filePath), { type: 'buffer' })
    assert.deepEqual(reopened.SheetNames, ['Summary'])
    assert.equal(result.byteCount, fs.statSync(filePath).size)
    assert.equal(result.fileHash, crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex'))
  } finally {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

test('POS PDF artifact handler writes, reopens, and hashes a temporary output', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'tsa-pos-pdf-'))
  try {
    const filePath = path.join(directory, 'pos-history.pdf')
    const pdf = Buffer.from('%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF\n', 'utf8')
    const result = writePosHistoryPdfArtifact(filePath, pdf)
    assert.equal(fs.readFileSync(filePath).subarray(0, 4).toString(), '%PDF')
    assert.equal(result.byteCount, pdf.length)
    assert.equal(result.fileHash, crypto.createHash('sha256').update(pdf).digest('hex'))
  } finally {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

test('POS detailed companion writes, reopens, and hashes the authoritative dataset', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'tsa-pos-json-'))
  try {
    const filePath = path.join(directory, 'pos-history.json')
    const dataset = { report_run_id: 'run-1', dataset_hash: 'abc', orders: [{ id: 'order-1', total: 12.5 }] }
    const result = writePosHistoryJsonArtifact(filePath, dataset)
    assert.deepEqual(JSON.parse(fs.readFileSync(filePath, 'utf8')), dataset)
    assert.equal(result.byteCount, fs.statSync(filePath).size)
    assert.equal(result.fileHash, crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex'))
  } finally {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})
