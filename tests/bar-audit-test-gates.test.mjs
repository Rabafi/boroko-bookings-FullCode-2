import test from 'node:test'
import assert from 'node:assert/strict'
import { childProcessExitCode } from '../scripts/test-run-result.mjs'
import { collectBarTests, runBarSuite } from './run-bar-suite.mjs'
import { rejectsSqlState } from './helpers/sql-state.mjs'
import { runRestaurantSuite } from './run-restaurant-suite.mjs'
const log = { log() {}, error() {} }

test('restaurant keep-going collects later failures without declaring success', () => {
  let count = 0
  assert.equal(runRestaurantSuite({ files:['restaurant-a.test.mjs','restaurant-b.test.mjs'], keepGoing:true, log, run:()=>({status:++count}) }),1)
  assert.equal(count,2)
})
test('restaurant default remains fail-fast and an empty suite fails', () => {
  let count = 0
  assert.equal(runRestaurantSuite({ files:['restaurant-a.test.mjs','restaurant-b.test.mjs'], log, run:()=>{count++;return {status:2}} }),2)
  assert.equal(count,1)
  assert.equal(runRestaurantSuite({files:[],log}),1)
})

test('Bar discovery includes every matching test, not only the historical handpicked list', () => {
  assert.deepEqual(collectBarTests(['notes.md','bar-cash-scroll.test.mjs','bar-cashier-boot-context.test.mjs','bar-future-feature.test.mjs','restaurant-other.test.mjs','run-bar-suite.mjs']), [
    'bar-cash-scroll.test.mjs','bar-cashier-boot-context.test.mjs','bar-future-feature.test.mjs'
  ])
})
test('child process status keeps success zero and rejects missing/crashed status', () => {
  assert.equal(childProcessExitCode({status:0}),0)
  assert.equal(childProcessExitCode({status:2}),2)
  assert.equal(childProcessExitCode({status:null}),1)
  assert.equal(childProcessExitCode({error:new Error('spawn failed')}),1)
})
test('Bar gate invokes Node tests without a shell and propagates failure', () => {
  let invocation
  const exit = runBarSuite({ files:['bar-example.test.mjs'], log, run:(...args) => { invocation=args; return {status:3} } })
  assert.equal(exit,3)
  assert.equal(invocation[0],process.execPath)
  assert.equal(invocation[1][0],'--test')
  assert.equal(invocation[2].shell,false)
  assert.match(invocation[1][1],/bar-example\.test\.mjs$/)
})
test('Bar gate cannot silently succeed when no test files exist', () => {
  assert.equal(runBarSuite({files:[],log,run:()=>{throw new Error('must not run')}}),1)
})
test('SQLSTATE rejection checks require the intended error code', async () => {
  await rejectsSqlState(async()=>{throw Object.assign(new Error('permission denied'),{code:'42501'})},'42501')
  await assert.rejects(()=>rejectsSqlState(async()=>{throw Object.assign(new Error('bad column'),{code:'42703'})},'42501'),{code:'ERR_ASSERTION'})
  await assert.rejects(()=>rejectsSqlState(async()=>{throw new Error('unrelated connection error')},'42501'),{code:'ERR_ASSERTION'})
})
