// Rollback-only acceptance of the desktop transport grant. No real session is used.
import { readFileSync } from 'node:fs'
import dotenv from 'dotenv'
import { guardLodgeDisposableQuery } from './helpers/lodge-management-disposable.mjs'

dotenv.config({ path: '.env.disposable.local', quiet: true })
const ref = 'repsrmlomedqrmrdsbga'
if (!process.env.SUPABASE_ACCESS_TOKEN || process.env.LUNA_REMEDIATION_EXPECTED_PROJECT_REF !== ref ||
    process.env.LUNA_REMEDIATION_EXPECTED_DATABASE !== 'postgres' ||
    process.env.LUNA_REMEDIATION_TARGET_MARKER !== 'LUNA-REMEDIATION-DISPOSABLE-v1') {
  throw new Error('Disposable target guard failed')
}
const migration = readFileSync(new URL('../supabase/migrations/20261113010000_event_duplicate_void_desktop_transport.sql', import.meta.url), 'utf8')
const body = migration.replace(/^begin;$/m, '').replace(/^commit;$/m, '')
const query = guardLodgeDisposableQuery(`begin;
${body}
select set_config('request.headers','{}',true),
       set_config('request.jwt.claims','{"role":"anon"}',true),
       set_config('request.jwt.claim.role','anon',true),
       set_config('app.session_valid','false',true),
       set_config('app.actor_id','',true),
       set_config('app.lodge_id','',true),
       set_config('app.session_role','',true);
set local role anon;
do $$
declare v_result jsonb; v_blocked boolean := false;
begin
  if not has_function_privilege(current_user,
    'public.void_duplicate_event_payment(uuid,uuid,uuid,uuid,numeric,text,text)', 'EXECUTE') then
    raise exception 'Desktop transport cannot execute the correction RPC';
  end if;
  begin
    v_result := public.void_duplicate_event_payment(
      '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222',
      '33333333-3333-4333-8333-333333333333',
      '44444444-4444-4444-8444-444444444444',
      500, 'Disposable unauthenticated transport test', 'test:transport:unauthenticated');
    v_blocked := coalesce((v_result->>'success')::boolean, false) is false;
  exception when insufficient_privilege then
    v_blocked := true;
  end;
  if not v_blocked then raise exception 'Unauthenticated correction was accepted'; end if;
end $$;
reset role;
rollback;`)
const response = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
  method: 'POST',
  headers: { authorization: `Bearer ${process.env.SUPABASE_ACCESS_TOKEN}`, 'content-type': 'application/json' },
  body: JSON.stringify({ query }), signal: AbortSignal.timeout(30000)
})
const result = await response.json()
if (!response.ok) throw new Error(`Disposable transport acceptance failed: ${JSON.stringify(result).slice(0,1000)}`)
console.log('DUPLICATE_VOID_DESKTOP_TRANSPORT_PASS: grant reachable; no-session request denied; transaction rolled back')
