import assert from 'node:assert/strict'

// A permission, conflict, or invariant test must not pass on an unrelated error.
export async function rejectsSqlState(action, expectedCode) {
  await assert.rejects(action, error => error?.code === expectedCode, `Expected SQLSTATE ${expectedCode}`)
}
