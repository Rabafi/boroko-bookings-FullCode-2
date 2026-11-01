import test from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import pg from 'pg'
import { loadTarget, connectionConfig, assertClusterIdentity } from '../scripts/lib/db-target.mjs'
import { runMigrations, listMigrations } from '../scripts/lib/migrate.mjs'

test('two installers sharing a fresh disposable database apply each migration exactly once', async()=>{
 const target=loadTarget({maintenance:true})
 const admin=new pg.Client(connectionConfig(target));await admin.connect()
 const name=`bar_local_test_migration_${randomBytes(6).toString('hex')}`
 const clients=[]
 try{
  await assertClusterIdentity(admin,target,{allowAbsentMarker:true})
  const create=(await admin.query("SELECT format('CREATE DATABASE %I OWNER %I',$1::text,$2::text) AS sql",[name,process.env.BAR_LOCAL_MIGRATOR_USER])).rows[0].sql
  await admin.query(create)
  for(let i=0;i<2;i++){
   const c=new pg.Client(connectionConfig({...target,database:name,user:process.env.BAR_LOCAL_MIGRATOR_USER,maintenance:false}));await c.connect();clients.push(c)
  }
  const expected=await listMigrations()
  const applied=await Promise.all(clients.map(c=>runMigrations(c)))
  assert.equal(applied[0].length+applied[1].length,expected.length)
  const versions=(await clients[0].query('SELECT version FROM bar_local.schema_migrations ORDER BY version')).rows.map(r=>r.version)
  assert.deepEqual(versions,expected)
 }finally{
  for(const c of clients)await c.end()
  await assertClusterIdentity(admin,target,{allowAbsentMarker:true})
  const drop=(await admin.query("SELECT format('DROP DATABASE IF EXISTS %I',$1::text) AS sql",[name])).rows[0].sql
  await admin.query(drop);await admin.end()
 }
})
