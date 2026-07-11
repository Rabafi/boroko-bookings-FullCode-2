-- Guest Messaging: templates, triggers, rendering, and delivery status
-- Enhances enterprise_guest_messages table from enterprise_operations_contracts

create table if not exists public.guest_message_templates (
  id uuid primary key default gen_random_uuid(),
  lodge_id uuid not null,
  template_key text not null,
  name text not null,
  subject_template text not null default '',
  body_template text not null,
  channel text not null default 'email',
  variables jsonb not null default '[]'::jsonb,
  category text not null default 'custom',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (lodge_id, template_key)
);

create table if not exists public.guest_message_triggers (
  id uuid primary key default gen_random_uuid(),
  lodge_id uuid not null,
  trigger_event text not null,
  template_id uuid not null references public.guest_message_templates(id) on delete cascade,
  delay_minutes int not null default 0,
  active boolean not null default true,
  channel text not null default 'email',
  created_at timestamptz not null default now()
);

create index if not exists guest_message_templates_lodge_idx
  on public.guest_message_templates(lodge_id, template_key);
create index if not exists guest_message_triggers_lodge_idx
  on public.guest_message_triggers(lodge_id, trigger_event, active);
create index if not exists guest_message_triggers_template_idx
  on public.guest_message_triggers(template_id);

alter table public.guest_message_templates enable row level security;
alter table public.guest_message_triggers enable row level security;

-- RPC: get all message templates for a lodge
create or replace function public.get_guest_message_templates(p_lodge_id uuid)
returns setof public.guest_message_templates
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.app_require_lodge_role(p_lodge_id, array['owner', 'admin', 'manager', 'super_admin']);
  return query
    select *
      from public.guest_message_templates
     where lodge_id = p_lodge_id
     order by category, name;
end;
$$;

-- RPC: create message template
create or replace function public.create_message_template(
  p_lodge_id uuid,
  p_template_key text,
  p_name text,
  p_subject_template text,
  p_body_template text,
  p_channel text,
  p_variables jsonb,
  p_category text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_key text := nullif(btrim(coalesce(p_template_key, '')), '');
begin
  perform public.app_require_lodge_role(p_lodge_id, array['owner', 'admin', 'manager', 'super_admin']);
  if v_key is null then
    return jsonb_build_object('success', false, 'error', 'Template key is required');
  end if;

  insert into public.guest_message_templates (
    lodge_id, template_key, name, subject_template, body_template, channel, variables, category, active
  )
  values (
    p_lodge_id,
    v_key,
    coalesce(nullif(btrim(p_name), ''), v_key),
    coalesce(p_subject_template, ''),
    coalesce(p_body_template, ''),
    coalesce(nullif(btrim(p_channel), ''), 'email'),
    coalesce(p_variables, '[]'::jsonb),
    coalesce(nullif(btrim(p_category), ''), 'custom'),
    true
  )
  returning id into v_id;

  return jsonb_build_object('success', true, 'template_id', v_id);
end;
$$;

-- RPC: update message template
create or replace function public.update_message_template(
  p_id uuid,
  p_lodge_id uuid,
  p_data jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.app_require_lodge_role(p_lodge_id, array['owner', 'admin', 'manager', 'super_admin']);

  update public.guest_message_templates
    set name            = coalesce(nullif(p_data->>'name', ''), name),
        subject_template = coalesce(nullif(p_data->>'subject_template', ''), subject_template),
        body_template    = coalesce(p_data->>'body_template', body_template),
        channel          = coalesce(nullif(p_data->>'channel', ''), channel),
        variables        = coalesce(p_data->'variables', variables),
        category         = coalesce(nullif(p_data->>'category', ''), category),
        active           = coalesce((p_data->>'active')::boolean, active),
        updated_at       = now()
  where id = p_id and lodge_id = p_lodge_id;

  return jsonb_build_object('success', true);
end;
$$;

-- RPC: delete message template
create or replace function public.delete_message_template(
  p_id uuid,
  p_lodge_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.app_require_lodge_role(p_lodge_id, array['owner', 'admin', 'manager', 'super_admin']);

  delete from public.guest_message_triggers where template_id = p_id;
  delete from public.guest_message_templates where id = p_id and lodge_id = p_lodge_id;

  return jsonb_build_object('success', true);
end;
$$;

-- RPC: get all triggers for a lodge
create or replace function public.get_guest_message_triggers(p_lodge_id uuid)
returns setof public.guest_message_triggers
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.app_require_lodge_role(p_lodge_id, array['owner', 'admin', 'manager', 'super_admin']);
  return query
    select t.*
      from public.guest_message_triggers t
     where t.lodge_id = p_lodge_id
     order by t.trigger_event, t.created_at;
end;
$$;

-- RPC: create message trigger
create or replace function public.create_message_trigger(
  p_lodge_id uuid,
  p_trigger_event text,
  p_template_id uuid,
  p_delay_minutes int,
  p_channel text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  perform public.app_require_lodge_role(p_lodge_id, array['owner', 'admin', 'manager', 'super_admin']);

  insert into public.guest_message_triggers (
    lodge_id, trigger_event, template_id, delay_minutes, active, channel
  )
  values (
    p_lodge_id,
    nullif(btrim(coalesce(p_trigger_event, '')), ''),
    p_template_id,
    greatest(0, coalesce(p_delay_minutes, 0)),
    true,
    coalesce(nullif(btrim(p_channel), ''), 'email')
  )
  returning id into v_id;

  return jsonb_build_object('success', true, 'trigger_id', v_id);
end;
$$;

-- RPC: update message trigger
create or replace function public.update_message_trigger(
  p_id uuid,
  p_lodge_id uuid,
  p_data jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.app_require_lodge_role(p_lodge_id, array['owner', 'admin', 'manager', 'super_admin']);

  update public.guest_message_triggers
    set trigger_event  = coalesce(nullif(p_data->>'trigger_event', ''), trigger_event),
        template_id    = coalesce(nullif((p_data->>'template_id')::uuid, NULL), template_id),
        delay_minutes  = greatest(0, coalesce((p_data->>'delay_minutes')::int, delay_minutes)),
        active         = coalesce((p_data->>'active')::boolean, active),
        channel        = coalesce(nullif(p_data->>'channel', ''), channel)
  where id = p_id and lodge_id = p_lodge_id;

  return jsonb_build_object('success', true);
end;
$$;

-- RPC: delete message trigger
create or replace function public.delete_message_trigger(
  p_id uuid,
  p_lodge_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.app_require_lodge_role(p_lodge_id, array['owner', 'admin', 'manager', 'super_admin']);

  delete from public.guest_message_triggers where id = p_id and lodge_id = p_lodge_id;

  return jsonb_build_object('success', true);
end;
$$;

-- RPC: render template with variables - performs simple variable substitution
create or replace function public.render_message_template(
  p_template_id uuid,
  p_variables jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_template record;
  v_subject text;
  v_body text;
  v_key text;
  v_value text;
begin
  select * into v_template
    from public.guest_message_templates
   where id = p_template_id;

  if not found then
    return jsonb_build_object('success', false, 'error', 'Template not found');
  end if;

  v_subject := v_template.subject_template;
  v_body := v_template.body_template;

  for v_key, v_value in select * from jsonb_each_text(coalesce(p_variables, '{}'::jsonb))
  loop
    v_subject := replace(v_subject, '{{' || v_key || '}}', v_value);
    v_body := replace(v_body, '{{' || v_key || '}}', v_value);
  end loop;

  return jsonb_build_object(
    'success', true,
    'subject', v_subject,
    'body', v_body,
    'template_key', v_template.template_key,
    'channel', v_template.channel
  );
end;
$$;

-- RPC: evaluate active triggers and queue messages
create or replace function public.queue_triggered_messages(
  p_lodge_id uuid,
  p_trigger_event text,
  p_variables jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_trigger record;
  v_template record;
  v_subject text;
  v_body text;
  v_key text;
  v_value text;
  v_queued int := 0;
begin
  perform public.app_require_lodge_role(p_lodge_id, array['owner', 'admin', 'manager', 'super_admin']);

  for v_trigger in
    select t.*, tmpl.template_key, tmpl.subject_template, tmpl.body_template, tmpl.channel as template_channel
      from public.guest_message_triggers t
      join public.guest_message_templates tmpl on tmpl.id = t.template_id
     where t.lodge_id = p_lodge_id
       and t.trigger_event = p_trigger_event
       and t.active = true
       and tmpl.active = true
  loop
    v_subject := v_trigger.subject_template;
    v_body := v_trigger.body_template;

    for v_key, v_value in select * from jsonb_each_text(coalesce(p_variables, '{}'::jsonb))
    loop
      v_subject := replace(v_subject, '{{' || v_key || '}}', v_value);
      v_body := replace(v_body, '{{' || v_key || '}}', v_value);
    end loop;

    insert into public.enterprise_guest_messages (
      lodge_id, template_key, channel, status, payload
    )
    values (
      p_lodge_id,
      v_trigger.template_key,
      coalesce(nullif(v_trigger.channel, ''), v_trigger.template_channel, 'email'),
      'queued',
      jsonb_build_object(
        'trigger_event', p_trigger_event,
        'trigger_id', v_trigger.id,
        'subject', v_subject,
        'body', v_body,
        'variables', p_variables
      )
    );

    v_queued := v_queued + 1;
  end loop;

  return jsonb_build_object('success', true, 'queued', v_queued);
end;
$$;

-- RPC: get message delivery status
create or replace function public.get_message_delivery_status(
  p_lodge_id uuid,
  p_status text
)
returns setof public.enterprise_guest_messages
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.app_require_lodge_role(p_lodge_id, array['owner', 'admin', 'manager', 'super_admin']);
  return query
    select *
      from public.enterprise_guest_messages
     where lodge_id = p_lodge_id
       and (p_status is null or p_status = '' or status = p_status)
     order by created_at desc;
end;
$$;

revoke all on function public.get_guest_message_templates(uuid) from public;
revoke all on function public.create_message_template(uuid, text, text, text, text, text, jsonb, text) from public;
revoke all on function public.update_message_template(uuid, uuid, jsonb) from public;
revoke all on function public.delete_message_template(uuid, uuid) from public;
revoke all on function public.get_guest_message_triggers(uuid) from public;
revoke all on function public.create_message_trigger(uuid, text, uuid, int, text) from public;
revoke all on function public.update_message_trigger(uuid, uuid, jsonb) from public;
revoke all on function public.delete_message_trigger(uuid, uuid) from public;
revoke all on function public.render_message_template(uuid, jsonb) from public;
revoke all on function public.queue_triggered_messages(uuid, text, jsonb) from public;
revoke all on function public.get_message_delivery_status(uuid, text) from public;

grant execute on function public.get_guest_message_templates(uuid) to authenticated, service_role;
grant execute on function public.create_message_template(uuid, text, text, text, text, text, jsonb, text) to authenticated, service_role;
grant execute on function public.update_message_template(uuid, uuid, jsonb) to authenticated, service_role;
grant execute on function public.delete_message_template(uuid, uuid) to authenticated, service_role;
grant execute on function public.get_guest_message_triggers(uuid) to authenticated, service_role;
grant execute on function public.create_message_trigger(uuid, text, uuid, int, text) to authenticated, service_role;
grant execute on function public.update_message_trigger(uuid, uuid, jsonb) to authenticated, service_role;
grant execute on function public.delete_message_trigger(uuid, uuid) to authenticated, service_role;
grant execute on function public.render_message_template(uuid, jsonb) to authenticated, service_role;
grant execute on function public.queue_triggered_messages(uuid, text, jsonb) to authenticated, service_role;
grant execute on function public.get_message_delivery_status(uuid, text) to authenticated, service_role;
