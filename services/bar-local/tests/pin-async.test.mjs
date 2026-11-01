import test from 'node:test'
import assert from 'node:assert/strict'
import {hashPin,verifyPinAsync} from '../dist/pin.js'

test('asynchronous approval PIN verification matches the verifier and rejects corrupt or unbounded work',async()=>{
 const valid=hashPin('123456',100000)
 assert.equal(await verifyPinAsync('123456',valid),true)
 assert.equal(await verifyPinAsync('123457',valid),false)
 for(const patch of [
  {pin_iterations:0},{pin_iterations:99999},{pin_iterations:2000001},{pin_iterations:NaN},
  {pin_hash:valid.pin_hash+'zz'},{pin_hash:valid.pin_hash.slice(1)},
  {pin_salt:valid.pin_salt+'z'},{pin_salt:'ab'.repeat(65)},{pin_salt:'ab'.repeat(7)}
 ])assert.equal(await verifyPinAsync('123456',{...valid,...patch}),false,JSON.stringify(patch))
 assert.equal(await verifyPinAsync('abc',valid),false)
 assert.equal(await verifyPinAsync('123456',null),false)
})
