-- Targeted migration: tenant isolation for forwarding data + Supabase Cron pg_net fix.
--
-- This file is intentionally not a full schema reset. Run it against the
-- existing Supabase project.

-- pg_net creates the `net` schema used by net.http_get. Without this,
-- cron runs fail with: schema "net" does not exist.
create extension if not exists pg_net;

do $$
begin
  if not exists (select 1 from pg_namespace where nspname = 'net') then
    raise exception 'pg_net is not enabled; enable the pg_net extension in Supabase Dashboard > Database > Extensions';
  end if;
end $$;

-- Remove invalid historical mappings before enforcing the invariant.
delete from public.rule_recipients rr
using public.rules r, public.gmail_accounts a, public.recipients rec
where rr.rule_id = r.id
  and r.account_id = a.id
  and rr.recipient_id = rec.id
  and a.user_id <> rec.user_id;

create or replace function public.ensure_rule_recipient_same_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  rule_owner uuid;
  recipient_owner uuid;
begin
  select a.user_id
    into rule_owner
  from public.rules r
  join public.gmail_accounts a on a.id = r.account_id
  where r.id = new.rule_id;

  select rec.user_id
    into recipient_owner
  from public.recipients rec
  where rec.id = new.recipient_id;

  if rule_owner is null or recipient_owner is null or rule_owner <> recipient_owner then
    raise exception 'rule and recipient must belong to the same user';
  end if;

  return new;
end;
$$;

drop trigger if exists ensure_rule_recipient_same_user_trigger on public.rule_recipients;
create trigger ensure_rule_recipient_same_user_trigger
before insert or update on public.rule_recipients
for each row execute function public.ensure_rule_recipient_same_user();

-- Helpful indexes for explicit tenant filters in API routes and RLS policies.
create index if not exists gmail_accounts_user_id_idx on public.gmail_accounts(user_id);
create index if not exists rules_account_id_idx on public.rules(account_id);
create index if not exists recipients_user_id_idx on public.recipients(user_id);
create index if not exists forwarded_log_account_id_forwarded_at_idx
  on public.forwarded_log(account_id, forwarded_at desc);

-- RLS: forwarding data must be owned through gmail_accounts.user_id.
alter table public.gmail_accounts enable row level security;
alter table public.rules enable row level security;
alter table public.recipients enable row level security;
alter table public.rule_recipients enable row level security;
alter table public.forwarded_log enable row level security;
alter table public.invite_codes enable row level security;
alter table public.signup_requests enable row level security;

drop policy if exists "accounts_select_own" on public.gmail_accounts;
drop policy if exists "accounts_insert_own" on public.gmail_accounts;
drop policy if exists "accounts_update_own" on public.gmail_accounts;
drop policy if exists "accounts_delete_own" on public.gmail_accounts;

create policy "accounts_select_own" on public.gmail_accounts
  for select to authenticated using (auth.uid() = user_id);
create policy "accounts_insert_own" on public.gmail_accounts
  for insert to authenticated with check (auth.uid() = user_id);
create policy "accounts_update_own" on public.gmail_accounts
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "accounts_delete_own" on public.gmail_accounts
  for delete to authenticated using (auth.uid() = user_id);

drop policy if exists "rules_select_own" on public.rules;
drop policy if exists "rules_insert_own" on public.rules;
drop policy if exists "rules_update_own" on public.rules;
drop policy if exists "rules_delete_own" on public.rules;

create policy "rules_select_own" on public.rules
  for select to authenticated using (
    exists (
      select 1 from public.gmail_accounts a
      where a.id = rules.account_id and a.user_id = auth.uid()
    )
  );
create policy "rules_insert_own" on public.rules
  for insert to authenticated with check (
    exists (
      select 1 from public.gmail_accounts a
      where a.id = rules.account_id and a.user_id = auth.uid()
    )
  );
create policy "rules_update_own" on public.rules
  for update to authenticated using (
    exists (
      select 1 from public.gmail_accounts a
      where a.id = rules.account_id and a.user_id = auth.uid()
    )
  ) with check (
    exists (
      select 1 from public.gmail_accounts a
      where a.id = rules.account_id and a.user_id = auth.uid()
    )
  );
create policy "rules_delete_own" on public.rules
  for delete to authenticated using (
    exists (
      select 1 from public.gmail_accounts a
      where a.id = rules.account_id and a.user_id = auth.uid()
    )
  );

drop policy if exists "recipients_select_own" on public.recipients;
drop policy if exists "recipients_insert_own" on public.recipients;
drop policy if exists "recipients_update_own" on public.recipients;
drop policy if exists "recipients_delete_own" on public.recipients;

create policy "recipients_select_own" on public.recipients
  for select to authenticated using (auth.uid() = user_id);
create policy "recipients_insert_own" on public.recipients
  for insert to authenticated with check (auth.uid() = user_id);
create policy "recipients_update_own" on public.recipients
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "recipients_delete_own" on public.recipients
  for delete to authenticated using (auth.uid() = user_id);

drop policy if exists "rule_recipients_select_own" on public.rule_recipients;
drop policy if exists "rule_recipients_insert_own" on public.rule_recipients;
drop policy if exists "rule_recipients_delete_own" on public.rule_recipients;

create policy "rule_recipients_select_own" on public.rule_recipients
  for select to authenticated using (
    exists (
      select 1
      from public.rules r
      join public.gmail_accounts a on a.id = r.account_id
      where r.id = rule_recipients.rule_id and a.user_id = auth.uid()
    )
  );
create policy "rule_recipients_insert_own" on public.rule_recipients
  for insert to authenticated with check (
    exists (
      select 1
      from public.rules r
      join public.gmail_accounts a on a.id = r.account_id
      where r.id = rule_recipients.rule_id and a.user_id = auth.uid()
    )
    and exists (
      select 1
      from public.recipients rec
      where rec.id = rule_recipients.recipient_id and rec.user_id = auth.uid()
    )
  );
create policy "rule_recipients_delete_own" on public.rule_recipients
  for delete to authenticated using (
    exists (
      select 1
      from public.rules r
      join public.gmail_accounts a on a.id = r.account_id
      where r.id = rule_recipients.rule_id and a.user_id = auth.uid()
    )
  );

drop policy if exists "logs_select_own" on public.forwarded_log;
create policy "logs_select_own" on public.forwarded_log
  for select to authenticated using (
    exists (
      select 1 from public.gmail_accounts a
      where a.id = forwarded_log.account_id and a.user_id = auth.uid()
    )
  );

-- Admin tables were previously readable/mutable by any authenticated user.
drop policy if exists "invite_codes_auth" on public.invite_codes;
drop policy if exists "invite_codes_superadmin_all" on public.invite_codes;
create policy "invite_codes_superadmin_all" on public.invite_codes
  for all to authenticated using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'superadmin'
    )
  ) with check (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'superadmin'
    )
  );

drop policy if exists "signup_requests_public_insert" on public.signup_requests;
drop policy if exists "signup_requests_admin_all" on public.signup_requests;
drop policy if exists "signup_requests_superadmin_all" on public.signup_requests;

create policy "signup_requests_public_insert" on public.signup_requests
  for insert to anon, authenticated with check (status is null or status = 'pending');
create policy "signup_requests_superadmin_all" on public.signup_requests
  for all to authenticated using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'superadmin'
    )
  ) with check (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'superadmin'
    )
  );

-- Replace the broken cron job. Supabase pg_net documents net.http_get in the
-- net schema; the extension above creates that schema.
do $$
begin
  perform cron.unschedule('mailrelay-poll');
exception
  when others then null;
end $$;

select cron.schedule(
  'mailrelay-poll',
  '* * * * *',
  $$
    select net.http_get(
      url := 'https://mailrelay-production.up.railway.app/api/poll-gmail',
      headers := jsonb_build_object('x-cron-secret', 'mailrelay_cron_secret_2024'),
      timeout_milliseconds := 15000
    );
  $$
);
