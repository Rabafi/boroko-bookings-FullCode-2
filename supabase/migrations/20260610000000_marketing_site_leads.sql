create table if not exists public.marketing_leads (
    id uuid not null default gen_random_uuid(),
    lodge_name text not null,
    contact_name text not null,
    email text not null,
    phone text,
    interest text,
    notes text,
    source text not null default 'website',
    status text not null default 'new',
    created_at timestamp with time zone not null default now(),
    constraint marketing_leads_pkey primary key (id)
);

alter table public.marketing_leads enable row level security;

drop policy if exists "Anyone can insert leads" on public.marketing_leads;
create policy "Anyone can insert leads"
    on public.marketing_leads
    for insert
    to anon
    with check (true);

drop policy if exists "Only authenticated users can view leads" on public.marketing_leads;
create policy "Only authenticated users can view leads"
    on public.marketing_leads
    for select
    to authenticated
    using (true);
