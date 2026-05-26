-- ============================================================
-- MailRelay Migration — safe to run on existing data
-- Run in Supabase Dashboard → SQL Editor
-- ============================================================

-- TABLES (skipped if already exist)
create table if not exists profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  name       text,
  role       text default 'user',
  created_at timestamptz default now()
);

create table if not exists signup_requests (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  email      text not null unique,
  status     text default 'pending',
  created_at timestamptz default now()
);

create table if not exists invite_codes (
  id         uuid primary key default gen_random_uuid(),
  email      text not null,
  code       text not null unique,
  used       boolean default false,
  expires_at timestamptz default now() + interval '48 hours',
  created_at timestamptz default now()
);

create table if not exists gmail_accounts (
  id                     uuid primary key default gen_random_uuid(),
  user_id                uuid references profiles(id) on delete cascade,
  label                  text not null,
  email                  text not null,
  app_password_encrypted text not null,
  active                 boolean default true,
  last_polled_at         timestamptz,
  last_poll_status       text,
  created_at             timestamptz default now()
);

create table if not exists rules (
  id             uuid primary key default gen_random_uuid(),
  account_id     uuid references gmail_accounts(id) on delete cascade,
  name           text not null,
  from_filter    text,
  subject_filter text,
  active         boolean default true,
  created_at     timestamptz default now()
);

create table if not exists recipients (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid references profiles(id) on delete cascade,
  name       text not null,
  email      text not null,
  active     boolean default true,
  created_at timestamptz default now(),
  unique(user_id, email)
);

create table if not exists rule_recipients (
  rule_id      uuid references rules(id)      on delete cascade,
  recipient_id uuid references recipients(id) on delete cascade,
  primary key (rule_id, recipient_id)
);

create table if not exists forwarded_log (
  id           uuid primary key default gen_random_uuid(),
  account_id   uuid references gmail_accounts(id),
  subject      text,
  from_address text,
  forwarded_to text[],
  rule_matched text,
  message_id   text,
  forwarded_at timestamptz default now()
);

create table if not exists app_state (
  key   text primary key,
  value text
);
insert into app_state values ('last_checked', now()::text) on conflict do nothing;

-- Fix gmail_accounts unique constraint: global → per-user
-- Allows different users to add the same email account
alter table gmail_accounts drop constraint if exists gmail_accounts_email_key;
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'gmail_accounts_user_email_unique'
  ) then
    alter table gmail_accounts add constraint gmail_accounts_user_email_unique unique (user_id, email);
  end if;
end $$;

-- RLS
alter table profiles         enable row level security;
alter table gmail_accounts   enable row level security;
alter table rules            enable row level security;
alter table recipients       enable row level security;
alter table rule_recipients  enable row level security;
alter table forwarded_log    enable row level security;
alter table invite_codes     enable row level security;
alter table signup_requests  enable row level security;
alter table app_state        enable row level security;

-- POLICIES (drop and recreate)
do $$ begin
  drop policy if exists "profiles_select_own"           on profiles;
  drop policy if exists "profiles_update_own"           on profiles;
  drop policy if exists "accounts_select_own"           on gmail_accounts;
  drop policy if exists "accounts_insert_own"           on gmail_accounts;
  drop policy if exists "accounts_update_own"           on gmail_accounts;
  drop policy if exists "accounts_delete_own"           on gmail_accounts;
  drop policy if exists "rules_select_own"              on rules;
  drop policy if exists "rules_insert_own"              on rules;
  drop policy if exists "rules_update_own"              on rules;
  drop policy if exists "rules_delete_own"              on rules;
  drop policy if exists "recipients_select_own"         on recipients;
  drop policy if exists "recipients_insert_own"         on recipients;
  drop policy if exists "recipients_update_own"         on recipients;
  drop policy if exists "recipients_delete_own"         on recipients;
  drop policy if exists "rule_recipients_select_own"    on rule_recipients;
  drop policy if exists "rule_recipients_insert_own"    on rule_recipients;
  drop policy if exists "rule_recipients_delete_own"    on rule_recipients;
  drop policy if exists "logs_select_own"               on forwarded_log;
  drop policy if exists "invite_codes_auth"             on invite_codes;
  drop policy if exists "signup_requests_auth"          on signup_requests;
  drop policy if exists "signup_requests_public_insert" on signup_requests;
  drop policy if exists "signup_requests_admin_all"     on signup_requests;
  drop policy if exists "app_state_auth"                on app_state;
end $$;

create policy "profiles_select_own" on profiles for select using (auth.uid() = id);
create policy "profiles_update_own" on profiles for update using (auth.uid() = id);

create policy "accounts_select_own" on gmail_accounts for select using (auth.uid() = user_id);
create policy "accounts_insert_own" on gmail_accounts for insert with check (auth.uid() = user_id);
create policy "accounts_update_own" on gmail_accounts for update using (auth.uid() = user_id);
create policy "accounts_delete_own" on gmail_accounts for delete using (auth.uid() = user_id);

create policy "rules_select_own" on rules for select using (exists (select 1 from gmail_accounts where id = rules.account_id and user_id = auth.uid()));
create policy "rules_insert_own" on rules for insert with check (exists (select 1 from gmail_accounts where id = rules.account_id and user_id = auth.uid()));
create policy "rules_update_own" on rules for update using (exists (select 1 from gmail_accounts where id = rules.account_id and user_id = auth.uid()));
create policy "rules_delete_own" on rules for delete using (exists (select 1 from gmail_accounts where id = rules.account_id and user_id = auth.uid()));

create policy "recipients_select_own" on recipients for select using (auth.uid() = user_id);
create policy "recipients_insert_own" on recipients for insert with check (auth.uid() = user_id);
create policy "recipients_update_own" on recipients for update using (auth.uid() = user_id);
create policy "recipients_delete_own" on recipients for delete using (auth.uid() = user_id);

create policy "rule_recipients_select_own" on rule_recipients for select using (exists (select 1 from rules r join gmail_accounts a on a.id = r.account_id where r.id = rule_recipients.rule_id and a.user_id = auth.uid()));
create policy "rule_recipients_insert_own" on rule_recipients for insert with check (exists (select 1 from rules r join gmail_accounts a on a.id = r.account_id where r.id = rule_recipients.rule_id and a.user_id = auth.uid()));
create policy "rule_recipients_delete_own" on rule_recipients for delete using (exists (select 1 from rules r join gmail_accounts a on a.id = r.account_id where r.id = rule_recipients.rule_id and a.user_id = auth.uid()));

create policy "logs_select_own" on forwarded_log for select using (exists (select 1 from gmail_accounts where id = forwarded_log.account_id and user_id = auth.uid()));

create policy "invite_codes_auth"             on invite_codes    for all using (auth.uid() is not null);
create policy "signup_requests_public_insert" on signup_requests for insert with check (true);
create policy "signup_requests_admin_all"     on signup_requests for all using (auth.uid() is not null);
create policy "app_state_auth"                on app_state       for all using (auth.uid() is not null);

-- TRIGGER (with search_path fix)
create or replace function handle_new_user()
returns trigger language plpgsql security definer
set search_path = public
as $$
begin
  insert into profiles (id, name, role)
  values (new.id, new.raw_user_meta_data->>'name', 'user')
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure handle_new_user();
