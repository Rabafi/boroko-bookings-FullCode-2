// Managed-Supabase fixture prerequisites for the cutover SQL acceptance
// suite. Supabase does not grant customers superuser, so the fixture must
// prove the NARROW capabilities it actually uses instead of asserting
// usesuper. This helper has two halves:
//
// - requiredFixturePrerequisites(): the static, reviewable list of what
//   the suite needs (fixture tables with exact DML rights, setup RPC
//   EXECUTE rights by exact signature, assertion-role switching, and the
//   auth helper). No connection required.
// - probeFixturePrerequisites(client): runs read-only privilege probes on
//   a live connection (has_*_privilege checks plus guarded SET ROLE trials
//   with RESET, all side-effect free) and returns a profile object.
// - evaluateFixturePrerequisites(profile, required): pure decision —
//   { ok, missing[] } with each gap naming the exact capability and the
//   operation that needs it. A superuser profile passes explicitly as a
//   documented bypass, never as an assumption.
//
// Nothing here opens connections, prints credentials, or mutates data.

export function requiredFixturePrerequisites() {
  return {
    tables: [
      { table: 'public.settings', privileges: ['INSERT', 'SELECT'], usedFor: 'synthetic lodge settings rows' },
      { table: 'public.users', privileges: ['INSERT', 'SELECT'], usedFor: 'synthetic actor rows (capability lookups read them)' },
      { table: 'public.licenses', privileges: ['INSERT', 'SELECT'], usedFor: 'commercial license provisioning row' },
      { table: 'public.commercial_entitlement_overrides', privileges: ['INSERT', 'SELECT'], usedFor: 'restaurant_accounting entitlement override row' },
      { table: 'public.pos_orders', privileges: ['INSERT', 'SELECT'], usedFor: 'source-drift fixture order' },
      { table: 'public.pos_order_items', privileges: ['INSERT', 'SELECT'], usedFor: 'source-drift fixture order lines' },
      { table: 'public.restaurant_historical_cutover_batches', privileges: ['SELECT', 'UPDATE'], usedFor: 'batch state reads plus drift/rollback fixture updates' },
      { table: 'public.restaurant_journal_entries', privileges: ['SELECT'], usedFor: 'exactly-once journal counts' },
      { table: 'public.restaurant_journal_lines', privileges: ['SELECT'], usedFor: 'exactly-once journal counts' }
    ],
    functions: [
      { signature: 'public.create_restaurant_account(uuid,text,text,text,uuid,numeric,text)', usedFor: 'readiness account fixtures' },
      { signature: 'public.set_restaurant_pos_gl_mapping_v2(uuid,text,text,uuid,date,date,text)', usedFor: 'tender/category mapping fixtures' },
      { signature: 'public.prepare_restaurant_historical_cutover(uuid,date,jsonb,jsonb,text)', usedFor: 'cutover preparation' },
      { signature: 'public.approve_restaurant_historical_cutover(uuid,uuid,text,text,text,uuid)', usedFor: 'revision-bound approval' },
      { signature: 'public.apply_restaurant_historical_cutover(uuid,uuid)', usedFor: 'opening-balance application' },
      { signature: 'public.activate_restaurant_accounting(uuid,date,text,text,uuid)', usedFor: 'activation' },
      { signature: 'public.suspend_restaurant_accounting(uuid,text)', usedFor: 'suspension' },
      { signature: 'public.get_restaurant_accounting_readiness(uuid)', usedFor: 'readiness gate reads' },
      { signature: 'public.get_restaurant_accounting_activation_state(uuid)', usedFor: 'activation-state readback' },
      { signature: 'public.get_restaurant_historical_cutover_batches(uuid,integer)', usedFor: 'batch list reads' },
      { signature: 'public.get_restaurant_historical_cutover_batch(uuid,uuid)', usedFor: 'batch detail reads' },
      { signature: 'public.get_lodge_entitlement(uuid)', usedFor: 'entitlement provisioning check' }
    ],
    roleswitch: [
      { role: 'authenticated', usedFor: 'restricted assertion sessions (SET ROLE)' },
      { role: 'anon', usedFor: 'unauthenticated denial sessions (SET ROLE)' }
    ],
    needAuthHelper: true
  }
}

export function evaluateFixturePrerequisites(profile = {}, required = requiredFixturePrerequisites()) {
  const missing = []
  const tables = profile.tables || {}
  for (const need of required.tables) {
    const have = tables[need.table] || {}
    for (const privilege of need.privileges) {
      if (have[privilege] !== true) {
        missing.push(`${need.table}: missing ${privilege} (needed for ${need.usedFor})`)
      }
    }
  }
  const functions = profile.functions || {}
  for (const need of required.functions) {
    if (functions[need.signature] !== true) {
      missing.push(`${need.signature}: missing EXECUTE (needed for ${need.usedFor})`)
    }
  }
  const roleswitch = profile.roleswitch || {}
  for (const need of required.roleswitch) {
    if (roleswitch[need.role] !== true) {
      missing.push(`SET ROLE ${need.role}: not assumable (needed for ${need.usedFor})`)
    }
  }
  if (required.needAuthHelper && profile.authHelper !== true) {
    missing.push('auth.role(): not callable (needed to verify assertion-session identity)')
  }
  if (missing.length === 0) {
    return { ok: true, missing: [], bypass: profile.isSuperuser === true ? 'superuser' : null }
  }
  return { ok: false, missing, bypass: null }
}

function cell(value) {
  return value === true
}

export async function probeFixturePrerequisites(client, required = requiredFixturePrerequisites()) {
  const profile = { user: null, sessionUser: null, isSuperuser: false, tables: {}, functions: {}, roleswitch: {}, authHelper: false, probeErrors: [] }
  const identity = (await client.query('select current_user as u, session_user as s')).rows[0]
  profile.user = identity.u
  profile.sessionUser = identity.s
  try {
    const superRow = await client.query('select exists(select 1 from pg_user where usename = current_user and usesuper) as v')
    profile.isSuperuser = superRow.rows[0].v === true
  } catch (error) {
    profile.probeErrors.push(`superuser probe: ${error?.message || error}`)
  }
  for (const need of required.tables) {
    const entry = {}
    for (const privilege of need.privileges) {
      try {
        const row = await client.query('select has_table_privilege(current_user, $1, $2) as v', [need.table, privilege])
        entry[privilege] = cell(row.rows[0].v)
      } catch (error) {
        profile.probeErrors.push(`${need.table} ${privilege} probe: ${error?.message || error}`)
        entry[privilege] = false
      }
    }
    profile.tables[need.table] = entry
  }
  for (const need of required.functions) {
    try {
      const row = await client.query('select has_function_privilege(current_user, $1, $2) as v', [need.signature, 'EXECUTE'])
      profile.functions[need.signature] = cell(row.rows[0].v)
    } catch (error) {
      profile.probeErrors.push(`${need.signature} probe: ${error?.message || error}`)
      profile.functions[need.signature] = false
    }
  }
  for (const need of required.roleswitch) {
    // Role names come from the static requirement list; still validate
    // the identifier shape before interpolating into SET ROLE.
    if (!/^[a-z_][a-z0-9_]*$/.test(need.role)) {
      profile.roleswitch[need.role] = false
      profile.probeErrors.push(`refusing to probe malformed role name: ${need.role}`)
      continue
    }
    try {
      await client.query(`set role ${need.role}`)
      const check = await client.query('select current_user as u')
      profile.roleswitch[need.role] = check.rows[0].u === need.role
    } catch {
      profile.roleswitch[need.role] = false
    } finally {
      try {
        await client.query('reset role')
      } catch {
        profile.roleswitch[need.role] = false
      }
    }
  }
  try {
    await client.query('select auth.role()')
    profile.authHelper = true
  } catch {
    profile.authHelper = false
  }
  return profile
}
