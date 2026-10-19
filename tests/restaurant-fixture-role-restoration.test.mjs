import test from 'node:test'
import assert from 'node:assert/strict'
import {probeFixturePrerequisites} from './helpers/disposable-prerequisites.mjs'

for (const failRole of [null, 'authenticated']) {
  test(`fixture probe preserves an assumed role when ${failRole || 'both assertion roles succeed'}`, async () => {
    let role = 'postgres'
    const client = { async query(sql) {
      if (sql === 'select current_user as u, session_user as s') return {rows:[{u:role,s:'cli_login_postgres'}]}
      if (sql.startsWith('select exists')) return {rows:[{v:false}]}
      if (sql === 'select current_user as u') return {rows:[{u:role}]}
      if (sql.startsWith('set role ')) {
        const next=sql.slice(9)
        if(next===failRole) throw new Error('permission denied to set role')
        role=next;return {rows:[]}
      }
      if(sql==='reset role') {role='cli_login_postgres';return {rows:[]}}
      if(sql==='select auth.role()') {
        if(role!=='postgres') throw new Error('permission denied for schema auth')
        return {rows:[{role:null}]}
      }
      throw new Error('Unexpected SQL: '+sql)
    }}
    const result=await probeFixturePrerequisites(client,{tables:[],functions:[],roleswitch:[{role:'authenticated'},{role:'anon'}],needAuthHelper:true})
    assert.equal(role,'postgres')
    assert.equal(result.authHelper,true)
    assert.equal(result.roleswitch.authenticated,failRole!=='authenticated')
    assert.equal(result.roleswitch.anon,true)
  })
}
