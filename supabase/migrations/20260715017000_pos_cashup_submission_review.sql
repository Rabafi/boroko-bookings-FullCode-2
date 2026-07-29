-- Cashiers submit their own physical count. A supervisor/manager is the only
-- actor who can approve it and invoke the existing atomic shift finalisation.
create table if not exists public.pos_cashup_submissions (
  id uuid primary key default gen_random_uuid(),
  lodge_id uuid not null references public.settings(lodge_id) on delete cascade,
  shift_id uuid not null references public.pos_shifts(id) on delete restrict,
  outlet_id uuid references public.outlets(id) on delete set null,
  cashier_id uuid references public.users(id) on delete set null,
  expected_by_method jsonb not null default '{}'::jsonb,
  expected_cash_drawer numeric not null default 0,
  counted_by_method jsonb not null default '{}'::jsonb,
  notes text,
  status text not null default 'submitted' check (status in ('submitted', 'rejected', 'approved')),
  submitted_by uuid references public.users(id) on delete set null,
  submitted_at timestamptz not null default now(),
  reviewed_by uuid references public.users(id) on delete set null,
  reviewed_at timestamptz,
  review_notes text,
  cashup_session_id uuid references public.pos_cashup_sessions(id) on delete set null,
  idempotency_key text not null,
  unique (lodge_id, shift_id),
  unique (lodge_id, idempotency_key)
);

create index if not exists pos_cashup_submissions_review_idx
  on public.pos_cashup_submissions (lodge_id, status, submitted_at desc);

alter table public.pos_cashup_submissions enable row level security;
revoke all on public.pos_cashup_submissions from anon, authenticated;

create or replace function public.submit_pos_shift_cashup(payload jsonb)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_lodge_id uuid := nullif(payload->>'lodge_id', '')::uuid;
  v_shift_id uuid := nullif(payload->>'shift_id', '')::uuid;
  v_key text := nullif(btrim(coalesce(payload->>'idempotency_key', '')), '');
  v_counted jsonb := coalesce(payload->'counted_by_method', '{}'::jsonb);
  v_notes text := nullif(btrim(coalesce(payload->>'notes', '')), '');
  v_actor_id uuid := public.app_current_user_id();
  v_shift public.pos_shifts%rowtype;
  v_preview jsonb;
  v_existing public.pos_cashup_submissions%rowtype;
  v_submission_id uuid;
begin
  if v_lodge_id is null or v_shift_id is null or v_key is null then
    return jsonb_build_object('success', false, 'error', 'lodge_id, shift_id and idempotency_key are required');
  end if;
  if jsonb_typeof(v_counted) <> 'object' or not (v_counted ? 'cash') then
    return jsonb_build_object('success', false, 'error', 'Enter the physical cash count before submitting cash-up.');
  end if;
  perform public.app_require_lodge_role(v_lodge_id, array['cashier','supervisor','manager','admin','super_admin']);

  select * into v_shift from public.pos_shifts
   where id = v_shift_id and lodge_id = v_lodge_id for update;
  if not found then return jsonb_build_object('success', false, 'error', 'This shift was not found.'); end if;
  if v_shift.cashier_id is distinct from v_actor_id then
    return jsonb_build_object('success', false, 'error', 'You can only submit cash-up for your own shift.');
  end if;
  if v_shift.status <> 'open' then
    return jsonb_build_object('success', false, 'error', 'This shift is already closed.');
  end if;

  select * into v_existing from public.pos_cashup_submissions
   where lodge_id = v_lodge_id and idempotency_key = v_key;
  if found then
    return jsonb_build_object('success', true, 'submission_id', v_existing.id, 'status', v_existing.status, 'replayed', true);
  end if;
  select * into v_existing from public.pos_cashup_submissions
   where lodge_id = v_lodge_id and shift_id = v_shift_id for update;
  if found and v_existing.status in ('submitted', 'approved') then
    return jsonb_build_object('success', false, 'error', 'This shift already has a cash-up awaiting review or has been closed.');
  end if;

  v_preview := public.get_pos_shift_cashup_preview_v2(v_shift_id, v_lodge_id);
  if coalesce((v_preview->>'success')::boolean, false) = false then return v_preview; end if;
  if found then
    update public.pos_cashup_submissions set
      counted_by_method = v_counted, notes = v_notes, expected_by_method = coalesce(v_preview->'expected_by_method', '{}'::jsonb),
      expected_cash_drawer = coalesce((v_preview->>'expected_cash_drawer')::numeric, 0), status = 'submitted',
      submitted_by = v_actor_id, submitted_at = now(), reviewed_by = null, reviewed_at = null, review_notes = null,
      idempotency_key = v_key
    where id = v_existing.id returning id into v_submission_id;
  else
    insert into public.pos_cashup_submissions (
      lodge_id, shift_id, outlet_id, cashier_id, expected_by_method, expected_cash_drawer,
      counted_by_method, notes, submitted_by, idempotency_key
    ) values (
      v_lodge_id, v_shift_id, v_shift.outlet_id, v_shift.cashier_id, coalesce(v_preview->'expected_by_method', '{}'::jsonb),
      coalesce((v_preview->>'expected_cash_drawer')::numeric, 0), v_counted, v_notes, v_actor_id, v_key
    ) returning id into v_submission_id;
  end if;
  insert into public.pos_audit_log (lodge_id, outlet_id, shift_id, actor_id, operator_id, action, entity_type, entity_id, staff_id, amount_delta, idempotency_key, after_snapshot, details)
  values (v_lodge_id, v_shift.outlet_id, v_shift_id, v_actor_id, v_shift.cashier_id, 'cashup_submitted', 'pos_cashup_submission', v_submission_id, v_actor_id, 0, v_key, jsonb_build_object('preview', v_preview, 'counted_by_method', v_counted), jsonb_build_object('notes', v_notes));
  return jsonb_build_object('success', true, 'submission_id', v_submission_id, 'status', 'submitted', 'preview', v_preview);
end;
$$;

create or replace function public.get_my_pos_cashup_submission(p_lodge_id uuid, p_shift_id uuid)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_actor uuid := public.app_current_user_id(); v_shift public.pos_shifts%rowtype; v_row public.pos_cashup_submissions%rowtype;
begin
  perform public.app_require_lodge_role(p_lodge_id, array['cashier','supervisor','manager','admin','super_admin']);
  select * into v_shift from public.pos_shifts where id = p_shift_id and lodge_id = p_lodge_id;
  if not found then return jsonb_build_object('success', false, 'error', 'Shift not found'); end if;
  if v_shift.cashier_id is distinct from v_actor then return jsonb_build_object('success', false, 'error', 'You can only view your own cash-up submission.'); end if;
  select * into v_row from public.pos_cashup_submissions where lodge_id = p_lodge_id and shift_id = p_shift_id;
  if not found then return jsonb_build_object('success', true, 'submission', null); end if;
  return jsonb_build_object('success', true, 'submission', jsonb_build_object('id',v_row.id,'status',v_row.status,'counted_by_method',v_row.counted_by_method,'expected_cash_drawer',v_row.expected_cash_drawer,'submitted_at',v_row.submitted_at,'notes',v_row.notes,'review_notes',v_row.review_notes));
end;
$$;

create or replace function public.get_pending_pos_cashup_submissions(p_lodge_id uuid)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
begin
  perform public.app_require_lodge_role(p_lodge_id, array['supervisor','manager','admin','super_admin']);
  return jsonb_build_object('success', true, 'submissions', coalesce((select jsonb_agg(jsonb_build_object(
    'id', s.id, 'shift_id', s.shift_id, 'outlet_id', s.outlet_id, 'outlet_name', o.name, 'cashier_id', s.cashier_id,
    'cashier_name', coalesce(u.name, sh.cashier_name), 'expected_cash_drawer', s.expected_cash_drawer,
    'counted_by_method', s.counted_by_method, 'expected_by_method', s.expected_by_method, 'notes', s.notes, 'submitted_at', s.submitted_at
  ) order by s.submitted_at asc) from public.pos_cashup_submissions s left join public.outlets o on o.id=s.outlet_id left join public.users u on u.id=s.cashier_id left join public.pos_shifts sh on sh.id=s.shift_id where s.lodge_id=p_lodge_id and s.status='submitted'), '[]'::jsonb));
end;
$$;

create or replace function public.review_pos_cashup_submission(payload jsonb)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_lodge_id uuid := nullif(payload->>'lodge_id', '')::uuid;
  v_submission_id uuid := nullif(payload->>'submission_id', '')::uuid;
  v_decision text := lower(nullif(btrim(coalesce(payload->>'decision', '')), ''));
  v_notes text := nullif(btrim(coalesce(payload->>'notes', '')), '');
  v_actor uuid := public.app_current_user_id(); v_row public.pos_cashup_submissions%rowtype; v_result jsonb;
begin
  if v_lodge_id is null or v_submission_id is null or v_decision not in ('approve','reject') then return jsonb_build_object('success', false, 'error', 'lodge_id, submission_id and a valid decision are required'); end if;
  perform public.app_require_lodge_role(v_lodge_id, array['supervisor','manager','admin','super_admin']);
  select * into v_row from public.pos_cashup_submissions where id=v_submission_id and lodge_id=v_lodge_id for update;
  if not found then return jsonb_build_object('success', false, 'error', 'Cash-up submission not found.'); end if;
  if v_row.status <> 'submitted' then return jsonb_build_object('success', false, 'error', 'This cash-up has already been reviewed.'); end if;
  if v_decision = 'reject' then
    update public.pos_cashup_submissions set status='rejected', reviewed_by=v_actor, reviewed_at=now(), review_notes=v_notes where id=v_row.id;
    insert into public.pos_audit_log (lodge_id,outlet_id,shift_id,actor_id,operator_id,action,entity_type,entity_id,staff_id,amount_delta,idempotency_key,details) values (v_lodge_id,v_row.outlet_id,v_row.shift_id,v_actor,v_row.cashier_id,'cashup_rejected','pos_cashup_submission',v_row.id,v_actor,0,'cashup-review-reject:'||v_row.id::text,jsonb_build_object('notes',v_notes));
    return jsonb_build_object('success', true, 'status', 'rejected');
  end if;
  v_result := public.finalize_pos_shift_cashup_v2(jsonb_build_object('lodge_id',v_lodge_id,'shift_id',v_row.shift_id,'cashup_id',v_row.id,'idempotency_key','cashup-review:'||v_row.id::text,'counted_by_method',v_row.counted_by_method,'notes',concat_ws(E'\n', v_row.notes, v_notes)));
  if coalesce((v_result->>'success')::boolean, false) = false then return v_result; end if;
  update public.pos_cashup_submissions set status='approved', reviewed_by=v_actor, reviewed_at=now(), review_notes=v_notes, cashup_session_id=(v_result->>'cashup_id')::uuid where id=v_row.id;
  return v_result || jsonb_build_object('submission_id',v_row.id,'status','approved');
end;
$$;

revoke all on function public.submit_pos_shift_cashup(jsonb) from public;
revoke all on function public.get_my_pos_cashup_submission(uuid, uuid) from public;
revoke all on function public.get_pending_pos_cashup_submissions(uuid) from public;
revoke all on function public.review_pos_cashup_submission(jsonb) from public;
grant execute on function public.submit_pos_shift_cashup(jsonb), public.get_my_pos_cashup_submission(uuid, uuid), public.get_pending_pos_cashup_submissions(uuid), public.review_pos_cashup_submission(jsonb) to authenticated, service_role;
