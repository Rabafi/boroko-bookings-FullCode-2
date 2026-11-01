import test from 'node:test'
import assert from 'node:assert/strict'
import { loadConfig } from '../dist/config.js'
const env = { BAR_LOCAL_TRAINING: '1', BAR_LOCAL_TRAINING_ID: '11111111-1111-4111-8111-111111111111', BAR_LOCAL_DB_NAME: 'bar_local_training' }
test('practice service configuration enforces separate DB, local-only bind and disabled live integrations', () => {
  assert.equal(loadConfig(env).training.instanceId, env.BAR_LOCAL_TRAINING_ID)
  for (const override of [ { BAR_LOCAL_DB_NAME: 'bar_local_live' }, { BAR_LOCAL_HTTP_HOST: '0.0.0.0' }, { BAR_LOCAL_CLOUD_SYNC_TRANSPORT: 'approved' }, { BAR_LOCAL_UPDATE_APPLY_ENABLED: '1' }, { BAR_LOCAL_FAILOVER_MODE: 'witness' }, { BAR_LOCAL_TRAINING_ID: 'not-an-id' } ]) {
    assert.throws(() => loadConfig({ ...env, ...override }), /Training requires/)
  }
  assert.equal(loadConfig({}).training, null)
})
