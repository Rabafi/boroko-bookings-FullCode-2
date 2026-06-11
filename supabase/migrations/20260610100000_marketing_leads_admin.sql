drop policy if exists "Authenticated users can update leads" on public.marketing_leads;
create policy "Authenticated users can update leads"
    on public.marketing_leads
    for update
    to authenticated
    using (true)
    with check (true);

create or replace function public.update_lead_status(
    p_lead_id uuid,
    p_status text
)
returns void
language plpgsql
security definer
as $$
begin
    update public.marketing_leads
    set status = p_status
    where id = p_lead_id;
end;
$$;

grant execute on function public.update_lead_status to authenticated;
