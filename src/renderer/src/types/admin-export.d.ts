export interface AdminExportColumn {
  key: string
  header: string
  width?: number
}

export interface AdminExportExcelRequest {
  title: string
  rows: Array<Record<string, unknown>>
  sheetName: string
  columns?: AdminExportColumn[]
}

export interface AdminExportPdfRequest {
  title: string
  rows: Array<Record<string, unknown>>
  columns?: AdminExportColumn[]
}

export interface AdminExportApi {
  exportExcel(payload: AdminExportExcelRequest): Promise<unknown>
  exportPdf(payload: AdminExportPdfRequest): Promise<unknown>
}
