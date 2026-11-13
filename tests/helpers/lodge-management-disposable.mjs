// Keep the server identity check in the same transaction as every fixture
// mutation, including concurrent requests and cleanup.
const serverGuard = `
do $lodge_disposable_guard$
begin
  if to_regclass('public.luna_remediation_db_marker') is null then
    raise exception 'Disposable marker table missing; refusing fixture SQL';
  end if;
  if (select count(*) from public.luna_remediation_db_marker where singleton is true) <> 1
     or not exists (
       select 1 from public.luna_remediation_db_marker
        where singleton is true
          and marker = 'LUNA-REMEDIATION-DISPOSABLE-v1'
          and environment_kind = 'disposable'
          and database_name = current_database()
          and database_name = 'postgres'
          and project_ref = 'repsrmlomedqrmrdsbga'
          and allow_mutation is true
     ) then
    raise exception 'Disposable database identity or mutation marker mismatch; refusing fixture SQL';
  end if;
end;
$lodge_disposable_guard$;
`

export function guardLodgeDisposableQuery(query) {
  if (typeof query !== 'string' || !query.trim()) throw new Error('Fixture SQL is required')
  return /^\s*begin;/i.test(query)
    ? query.replace(/^\s*begin;/i, `begin;${serverGuard}`)
    : `begin;${serverGuard}\n${query}\ncommit;`
}
