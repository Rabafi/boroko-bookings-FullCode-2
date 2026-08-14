-- Complete the server readiness matrix for typed POS, settlement, and stock mappings.

begin;

create or replace function public.get_restaurant_accounting_readiness(p_lodge_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_activation record;
  v_missing jsonb:='[]'::jsonb;
  v_unposted integer:=0;
  v_open_exceptions integer:=0;
  v_active boolean:=false;
  v_has_account boolean:=false;
  v_has_voucher boolean:=false;
  v_has_discount boolean:=false;
  v_has_tax boolean:=false;
  v_has_tips boolean:=false;
  v_has_stock boolean:=false;
  v_has_settlement boolean:=false;
begin
  perform public._restaurant_require_capability(p_lodge_id,'accounting.read');
  select * into v_activation from public.restaurant_accounting_activation where lodge_id=p_lodge_id;
  v_active:=public.restaurant_accounting_is_active(p_lodge_id);

  if not exists(select 1 from public.restaurant_accounts where lodge_id=p_lodge_id and account_type='asset' and is_active) then v_missing:=v_missing||jsonb_build_array('active asset account'); end if;
  if not exists(select 1 from public.restaurant_accounts where lodge_id=p_lodge_id and account_type='liability' and is_active) then v_missing:=v_missing||jsonb_build_array('active liability account'); end if;
  if not exists(select 1 from public.restaurant_accounts where lodge_id=p_lodge_id and account_type='revenue' and is_active) then v_missing:=v_missing||jsonb_build_array('active revenue account'); end if;
  if not exists(select 1 from public.restaurant_accounts where lodge_id=p_lodge_id and account_type='expense' and is_active) then v_missing:=v_missing||jsonb_build_array('active expense account'); end if;
  if not exists(select 1 from public.restaurant_pos_gl_mappings m join public.restaurant_accounts a on a.id=m.account_id and a.lodge_id=p_lodge_id and a.is_active and a.account_type='asset' where m.lodge_id=p_lodge_id and m.mapping_type='tender' and m.source_key='cash' and m.effective_from<=current_date and (m.effective_to is null or m.effective_to>=current_date)) then v_missing:=v_missing||jsonb_build_array('cash tender mapping'); end if;
  if not exists(select 1 from public.restaurant_pos_gl_mappings m join public.restaurant_accounts a on a.id=m.account_id and a.lodge_id=p_lodge_id and a.is_active and a.account_type='revenue' where m.lodge_id=p_lodge_id and m.mapping_type='category' and m.effective_from<=current_date and (m.effective_to is null or m.effective_to>=current_date)) then v_missing:=v_missing||jsonb_build_array('POS category revenue mapping'); end if;

  select exists(select 1 from public.pos_orders o where o.lodge_id=p_lodge_id and (lower(coalesce(o.payment_method,'')) in ('account','ar') or exists(select 1 from jsonb_array_elements(case when jsonb_typeof(o.payment_breakdown)='array' then o.payment_breakdown else '[]'::jsonb end) p where lower(coalesce(p->>'method','')) in ('account','ar')))) into v_has_account;
  select exists(select 1 from public.pos_orders o where o.lodge_id=p_lodge_id and (lower(coalesce(o.payment_method,''))='voucher' or exists(select 1 from jsonb_array_elements(case when jsonb_typeof(o.payment_breakdown)='array' then o.payment_breakdown else '[]'::jsonb end) p where lower(coalesce(p->>'method',''))='voucher'))) into v_has_voucher;
  select exists(select 1 from public.pos_orders o where o.lodge_id=p_lodge_id and coalesce(o.discount_total,0)>0) into v_has_discount;
  select exists(select 1 from public.pos_orders o where o.lodge_id=p_lodge_id and coalesce(o.tax_total,0)>0) into v_has_tax;
  select exists(select 1 from public.pos_orders o where o.lodge_id=p_lodge_id and coalesce(o.tip_total,0)>0) into v_has_tips;
  select exists(select 1 from public.inventory_movements m where m.lodge_id=p_lodge_id and m.movement_type in('recipe_sale','sale','pos_sale','receipt','adjustment','waste','transfer')) into v_has_stock;
  select exists(select 1 from public.restaurant_settlement_reconciliations s where s.lodge_id=p_lodge_id) into v_has_settlement;

  if v_has_account and not exists(select 1 from public.restaurant_pos_gl_mappings m join public.restaurant_accounts a on a.id=m.account_id and a.lodge_id=p_lodge_id and a.is_active and a.account_type='asset' where m.lodge_id=p_lodge_id and m.mapping_type='tender' and m.source_key in('account','ar')) then v_missing:=v_missing||jsonb_build_array('customer-account receivable tender mapping'); end if;
  if v_has_voucher and not exists(select 1 from public.restaurant_pos_gl_mappings m join public.restaurant_accounts a on a.id=m.account_id and a.lodge_id=p_lodge_id and a.is_active and a.account_type='liability' where m.lodge_id=p_lodge_id and m.mapping_type='tender' and m.source_key='voucher') then v_missing:=v_missing||jsonb_build_array('voucher liability tender mapping'); end if;
  if v_has_discount and not exists(select 1 from public.restaurant_pos_gl_mappings m join public.restaurant_accounts a on a.id=m.account_id and a.lodge_id=p_lodge_id and a.is_active and a.account_type='revenue' where m.lodge_id=p_lodge_id and m.mapping_type='discount' and m.source_key='default') then v_missing:=v_missing||jsonb_build_array('default discount mapping'); end if;
  if v_has_tax and not exists(select 1 from public.restaurant_pos_gl_mappings m join public.restaurant_accounts a on a.id=m.account_id and a.lodge_id=p_lodge_id and a.is_active and a.account_type='liability' where m.lodge_id=p_lodge_id and m.mapping_type='tax' and m.source_key='default') then v_missing:=v_missing||jsonb_build_array('default output-tax mapping'); end if;
  if v_has_tips and not exists(select 1 from public.restaurant_pos_gl_mappings m join public.restaurant_accounts a on a.id=m.account_id and a.lodge_id=p_lodge_id and a.is_active and a.account_type='liability' where m.lodge_id=p_lodge_id and m.mapping_type='tips' and m.source_key='default') then v_missing:=v_missing||jsonb_build_array('default tips-payable mapping'); end if;
  if v_has_stock and not exists(select 1 from public.restaurant_pos_gl_mappings m join public.restaurant_accounts a on a.id=m.account_id and a.lodge_id=p_lodge_id and a.is_active and a.account_type='expense' where m.lodge_id=p_lodge_id and m.mapping_type='cogs' and m.source_key='default') then v_missing:=v_missing||jsonb_build_array('default COGS mapping'); end if;
  if v_has_stock and not exists(select 1 from public.restaurant_pos_gl_mappings m join public.restaurant_accounts a on a.id=m.account_id and a.lodge_id=p_lodge_id and a.is_active and a.account_type='asset' where m.lodge_id=p_lodge_id and m.mapping_type='inventory' and m.source_key='default') then v_missing:=v_missing||jsonb_build_array('default inventory-control mapping'); end if;
  if v_has_settlement and not exists(select 1 from public.restaurant_pos_gl_mappings m join public.restaurant_accounts a on a.id=m.account_id and a.lodge_id=p_lodge_id and a.is_active and a.account_type='asset' where m.lodge_id=p_lodge_id and m.mapping_type='settlement_clearing' and m.source_key='default') then v_missing:=v_missing||jsonb_build_array('settlement-clearing mapping'); end if;
  if v_has_settlement and not exists(select 1 from public.restaurant_pos_gl_mappings m join public.restaurant_accounts a on a.id=m.account_id and a.lodge_id=p_lodge_id and a.is_active and a.account_type='expense' where m.lodge_id=p_lodge_id and m.mapping_type='settlement_fee' and m.source_key='default') then v_missing:=v_missing||jsonb_build_array('settlement-fee mapping'); end if;

  select count(*) into v_unposted from public.expenses e where e.lodge_id=p_lodge_id and e.status in('unposted','exception');
  select count(*) into v_open_exceptions from public.restaurant_reconciliation_exceptions e where e.lodge_id=p_lodge_id and e.status in('open','investigating') and e.severity='blocking';
  return jsonb_build_object('success',true,'data',jsonb_build_object(
    'active',v_active,'status',coalesce(v_activation.status,'draft'),'effective_from',v_activation.effective_from,
    'policy_version',coalesce(v_activation.policy_version,'bar-accounting-financial-truth-v1'),'configuration_version',coalesce(v_activation.configuration_version,'unconfigured'),
    'mapping_requirements',jsonb_build_object('account',v_has_account,'voucher',v_has_voucher,'discount',v_has_discount,'tax',v_has_tax,'tips',v_has_tips,'stock',v_has_stock,'settlement',v_has_settlement),
    'missing_requirements',v_missing,'unposted_expenses',v_unposted,'blocking_exceptions',v_open_exceptions,
    'ready',jsonb_array_length(v_missing)=0 and v_unposted=0 and v_open_exceptions=0
  ));
end
$$;

revoke all on function public.get_restaurant_accounting_readiness(uuid) from public,anon,authenticated;
grant execute on function public.get_restaurant_accounting_readiness(uuid) to service_role;

commit;
