import test from 'node:test'
import assert from 'node:assert/strict'
import {
  makeBarWorkspaceSelection,
  parseBarWorkspaceSelection,
  selectedWorkspaceUserDataPath
} from '../../src/shared/barWorkspaceSelection.js'

test('workspace selection accepts only explicit cloud or local Bar choices', () => {
  assert.equal(parseBarWorkspaceSelection(makeBarWorkspaceSelection('cloud')), 'cloud')
  assert.equal(parseBarWorkspaceSelection(makeBarWorkspaceSelection('local_bar')), 'local_bar')
  assert.equal(parseBarWorkspaceSelection('{"version":1,"workspace":"restaurant"}'), null)
  assert.equal(parseBarWorkspaceSelection('{"version":2,"workspace":"local_bar"}'), null)
  assert.equal(parseBarWorkspaceSelection('not-json'), null)
  assert.throws(() => makeBarWorkspaceSelection('guess_from_email'))
})

test('local Bar selection uses its isolated user-data folder while Restaurant keeps the ordinary folder', () => {
  assert.equal(selectedWorkspaceUserDataPath('C:/app-data', 'local_bar'), 'C:\\app-data\\local-bar-workspace')
  assert.equal(selectedWorkspaceUserDataPath('C:/app-data', 'cloud'), 'C:/app-data')
})
