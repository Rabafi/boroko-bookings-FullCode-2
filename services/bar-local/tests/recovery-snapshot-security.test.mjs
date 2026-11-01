import test from 'node:test'
import assert from 'node:assert/strict'
import { probeReadonlyRuntimeSecurity } from '../dist/operations/backup.js'

test('snapshot verification proves actual runtime identity and read isolation without writable probes', async () => {
  for (const variant of ['valid', 'wrong-role', 'not-recovery', 'writable', 'read-granted', 'readonly-error']) {
    const calls = []
    const checks = await probeReadonlyRuntimeSecurity(async () => ({
      query: async sql => {
        calls.push(sql)
        assert.equal(/INSERT|UPDATE|CREATE|cmd_sale_commit/.test(sql), false)
        if (sql.includes('service_authority')) return { rows: [{ role: variant === 'wrong-role' ? 'postgres' : 'bar_local_runtime', recovering: variant !== 'not-recovery', read_only: variant === 'writable' ? 'off' : 'on', authority: {} }] }
        if (variant === 'read-granted') return { rows: [] }
        throw Object.assign(new Error('refused'), { code: variant === 'readonly-error' ? '25006' : '42501' })
      }, end: async () => {}
    }))
    assert.equal(checks.every(check => check.status === 'pass'), variant === 'valid', variant)
    assert.equal(calls.length, 2)
  }
})
