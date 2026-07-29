function pdfText(value) {
  return String(value ?? '')
    .replace(/[\u0000-\u001f\u007f-\uffff]/g, ' ')
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)')
    .slice(0, 180)
}

function buildPdf(lines) {
  const streamLines = [
    'BT',
    '/F1 18 Tf',
    '50 750 Td',
    `(${pdfText(lines[0])}) Tj`,
    '/F1 10 Tf',
    '0 -28 Td',
    ...lines.slice(1).map((line) => `(${pdfText(line)}) Tj\n0 -18 Td`),
    'ET'
  ]
  const stream = `${streamLines.join('\n')}\n`
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${new TextEncoder().encode(stream).length} >>\nstream\n${stream}endstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'
  ]

  let pdf = '%PDF-1.4\n'
  const offsets = [0]
  objects.forEach((object, index) => {
    offsets[index + 1] = pdf.length
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`
  })
  const xrefOffset = pdf.length
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (let index = 1; index <= objects.length; index += 1) {
    pdf += `${String(offsets[index]).padStart(10, '0')} 00000 n \n`
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`
  return new TextEncoder().encode(pdf)
}

async function loadQuote(token) {
  const supabaseUrl = Netlify.env.get('SUPABASE_URL')
  const anonKey = Netlify.env.get('SUPABASE_ANON_KEY')
  if (!supabaseUrl || !anonKey) throw new Error('Quote service is not configured')
  const response = await fetch(`${supabaseUrl}/rest/v1/rpc/get_public_quote_download`, {
    method: 'POST',
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${anonKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ p_token: token })
  })
  const data = await response.json().catch(() => null)
  if (!response.ok || data?.success !== true) return null
  return data
}

export default async (request) => {
  if (request.method !== 'GET') return new Response('Method not allowed', { status: 405 })
  const token = new URL(request.url).searchParams.get('token')
  if (!token || token.length < 32) return new Response('Quote download is unavailable or expired', { status: 404 })

  try {
    const data = await loadQuote(token)
    if (!data) return new Response('Quote download is unavailable or expired', { status: 404 })
    const quote = data.quote_payload || {}
    const lines = [
      'TSA BONNO HOSPITALITYOS COMMERCIAL QUOTATION',
      `Quote: ${quote.document_number || data.quote_number || ''}`,
      `Product: ${quote.product_id || data.product_id || ''}`,
      `Package: ${quote.package_label || quote.package?.package_name || ''}`,
      `Issued: ${quote.issued_at || ''}`,
      '',
      'QUOTE LINES'
    ]
    for (const line of Array.isArray(quote.lines) ? quote.lines : Array.isArray(quote.pricing?.lines) ? quote.pricing.lines : []) {
      lines.push(`${line.label || line.key}: due now ${line.amount_due_now ?? 0}; recurring ${line.recurring_amount ?? 0}`)
    }
    lines.push('', `Total due now: ${quote.totals?.total_due_now ?? 0} ${quote.currency || 'BWP'}`)
    lines.push(`Recurring annual: ${quote.totals?.recurring_annual ?? 0} ${quote.currency || 'BWP'}`)
    lines.push('', 'Manual payment only. Use the quote number as reference and send proof of payment to Tsa Bonno.', 'Activation occurs only after manual review and approval.')
    const filename = `${String(quote.document_number || data.quote_number || 'tsa-bonno-quote').replace(/[^A-Za-z0-9_-]/g, '_')}.pdf`
    return new Response(buildPdf(lines.slice(0, 36)), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'private, no-store'
      }
    })
  } catch {
    return new Response('Quote download is unavailable', { status: 503, headers: { 'Cache-Control': 'no-store' } })
  }
}

export const config = {
  path: '/api/quote-download',
  method: ['GET']
}
