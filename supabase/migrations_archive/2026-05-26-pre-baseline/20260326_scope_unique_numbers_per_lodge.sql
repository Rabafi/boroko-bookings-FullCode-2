begin;

alter table public.users
  drop constraint if exists unique_user_email;

create unique index if not exists invoices_lodge_id_invoice_number_key
on public.invoices (lodge_id, invoice_number);

alter table public.invoices
  drop constraint if exists invoices_invoice_number_key;

create unique index if not exists quotations_lodge_id_quotation_number_key
on public.quotations (lodge_id, quotation_number);

alter table public.quotations
  drop constraint if exists quotations_quotation_number_key;

commit;
