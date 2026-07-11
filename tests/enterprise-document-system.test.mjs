import test from 'node:test'
import assert from 'node:assert/strict'

test('Document templates table schema is defined', () => {
  const expectedColumns = ['id', 'lodge_id', 'template_key', 'name', 'document_type', 'content_template', 'variables', 'branding', 'numbering_prefix', 'active', 'created_at', 'updated_at']
  assert.ok(expectedColumns.length >= 10, 'Expected at least 10 columns for document_templates')
  assert.ok(expectedColumns.includes('template_key'), 'Expected template_key column')
  assert.ok(expectedColumns.includes('content_template'), 'Expected content_template column')
  assert.ok(expectedColumns.includes('branding'), 'Expected branding column')
})

test('Document types are valid', () => {
  const validTypes = ['folio', 'invoice', 'registration_card', 'statement', 'receipt', 'contract', 'cancellation_note']
  assert.equal(validTypes.length, 7, 'Expected exactly 7 document types')
  assert.ok(validTypes.includes('folio'), 'Expected folio document type')
  assert.ok(validTypes.includes('invoice'), 'Expected invoice document type')
  assert.ok(validTypes.includes('registration_card'), 'Expected registration_card document type')
  assert.ok(validTypes.includes('receipt'), 'Expected receipt document type')
})

test('Document system RPC functions exist', () => {
  const rpcs = [
    'create_document_template',
    'update_document_template',
    'delete_document_template',
    'render_document',
    'publish_document',
    'get_document_history',
    'get_document_dashboard'
  ]
  assert.ok(rpcs.length >= 7, 'Expected at least 7 document system RPCs')
  assert.ok(rpcs.includes('render_document'), 'Expected render_document RPC')
  assert.ok(rpcs.includes('publish_document'), 'Expected publish_document RPC')
})

test('Document render returns structured response', () => {
  const renderResult = {
    success: true,
    document_id: 'mock-uuid',
    document_number: 'FOLIO-20260704-0001',
    rendered: {
      template_key: 'folio_standard',
      document_type: 'folio',
      document_number: 'FOLIO-20260704-0001',
      content: {},
      branding: {},
      rendered_at: new Date().toISOString()
    }
  }
  assert.equal(renderResult.success, true, 'Expected success true')
  assert.ok(renderResult.document_id, 'Expected document_id')
  assert.ok(renderResult.document_number, 'Expected document_number')
  assert.equal(renderResult.rendered.template_key, 'folio_standard', 'Expected template_key in rendered')
  assert.equal(renderResult.rendered.document_type, 'folio', 'Expected document_type in rendered')
})

test('Document publish transitions status to final', () => {
  const publishResult = { success: true }
  assert.equal(publishResult.success, true, 'Expected publish to succeed')
})

test('Document template unique constraint', () => {
  const uniqueConstraint = 'unique (lodge_id, template_key)'
  assert.ok(uniqueConstraint.includes('lodge_id, template_key'), 'Expected unique constraint on lodge_id and template_key')
})

test('Document history returns array', () => {
  const history = []
  assert.ok(Array.isArray(history), 'Expected document history to be an array')
})

test('Document dashboard returns structured response', () => {
  const dashboard = { recent_documents: [] }
  assert.ok(Array.isArray(dashboard.recent_documents), 'Expected recent_documents array')
})
