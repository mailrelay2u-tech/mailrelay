-- ============================================================
-- MailRelay Schema — fully rerunnable on a FRESH project
-- Run this in Supabase Dashboard → SQL Editor
-- ⚠ This drops and recreates all tables — use migration.sql
--   if you have existing data you want to keep
-- ============================================================

-- Drop tables in reverse dependency order
drop table if exists forwarded_log    cascade;
drop table if exists rule_recipients  cascade;
drop table if exists recipients       cascade;
drop table if exists rules            cascade;
drop table if exists gmail_accounts   cascade;
drop table if exists app_state        cascade;
drop table if exists invite_codes     cascade;
drop table if exists signup_requests  cascade;
drop table if exists profiles         cascade;

-- ============================================================
-- TABLES
-- ============================================================

create table profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  name       text,
  role       text default 'user',  -- 'user' | 'superadmin'
  created_at timestamptz default now()
);

create table signup_requests (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  email      text not null unique,
  status     text default 'pending', -- pending | approved
  created_at timestamptz default now()
);

create table invite_codes (
  id         uuid primary key default gen_random_uuid(),
  email      text not null,
  code       text not null unique,
  used       boolean default false,
  expires_at timestamptz default now() + interval '48 hours',
  created_at timestamptz default now()
);

create table gmail_accounts (
  id                     uuid primary key default gen_random_uuid(),
  user_id                uuid references profiles(id) on delete cascade,
  label                  text not null,
  email                  text not null,
  app_password_encrypted text not null,   -- AES-256-GCM encrypted
  active                 boolean default true,
  last_polled_at         timestamptz,
  last_poll_status       text,            -- ok | auth_error | imap_error
  created_at             timestamptz default now(),
  unique(user_id, email)
);

create table rules (
  id             uuid primary key default gen_random_uuid(),
  account_id     uuid references gmail_accounts(id) on delete cascade,
  name           text not null,
  from_filter    text,
  subject_filter text,
  active         boolean default true,
  created_at     timestamptz default now()
);

create table recipients (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid references profiles(id) on delete cascade,
  name       text not null,
  email      text not null,
  active     boolean default true,
  created_at timestamptz default now(),
  unique(user_id, email)
);

create table rule_recipients (
  rule_id      uuid references rules(id)      on delete cascade,
  recipient_id uuid references recipients(id) on delete cascade,
  primary key (rule_id, recipient_id)
);

create table forwarded_log (
  id           uuid primary key default gen_random_uuid(),
  account_id   uuid references gmail_accounts(id),
  subject      text,
  from_address text,
  forwarded_to text[],
  rule_matched text,
  message_id   text,   -- RFC 2822 Message-ID for deduplication
  forwarded_at timestamptz default now()
);

create table app_state (
  key   text primary key,
  value text
);
insert into app_state values ('last_checked', now()::text);

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================

alter table profiles         enable row level security;
alter table gmail_accounts   enable row level security;
alter table rules            enable row level security;
alter table recipients       enable row level security;
alter table rule_recipients  enable row level security;
alter table forwarded_log    enable row level security;
alter table invite_codes     enable row level security;
alter table signup_requests  enable row level security;
alter table app_state        enable row level security;

-- profiles: each user sees/edits only their own row
create policy "profiles_select_own" on profiles
  for select using (auth.uid() = id);
create policy "profiles_update_own" on profiles
  for update using (auth.uid() = id);

-- gmail_accounts: scoped to owner
create policy "accounts_select_own" on gmail_accounts
  for select using (auth.uid() = user_id);
create policy "accounts_insert_own" on gmail_accounts
  for insert with check (auth.uid() = user_id);
create policy "accounts_update_own" on gmail_accounts
  for update using (auth.uid() = user_id);
create policy "accounts_delete_own" on gmail_accounts
  for delete using (auth.uid() = user_id);

-- rules: scoped through gmail_accounts ownership
create policy "rules_select_own" on rules
  for select using (
    exists (select 1 from gmail_accounts where id = rules.account_id and user_id = auth.uid())
  );
create policy "rules_insert_own" on rules
  for insert with check (
    exists (select 1 from gmail_accounts where id = rules.account_id and user_id = auth.uid())
  );
create policy "rules_update_own" on rules
  for update using (
    exists (select 1 from gmail_accounts where id = rules.account_id and user_id = auth.uid())
  );
create policy "rules_delete_own" on rules
  for delete using (
    exists (select 1 from gmail_accounts where id = rules.account_id and user_id = auth.uid())
  );

-- recipients: scoped to owner
create policy "recipients_select_own" on recipients
  for select using (auth.uid() = user_id);
create policy "recipients_insert_own" on recipients
  for insert with check (auth.uid() = user_id);
create policy "recipients_update_own" on recipients
  for update using (auth.uid() = user_id);
create policy "recipients_delete_own" on recipients
  for delete using (auth.uid() = user_id);

-- rule_recipients: scoped through rules → gmail_accounts ownership
create policy "rule_recipients_select_own" on rule_recipients
  for select using (
    exists (
      select 1 from rules r
      join gmail_accounts a on a.id = r.account_id
      where r.id = rule_recipients.rule_id and a.user_id = auth.uid()
    )
  );
create policy "rule_recipients_insert_own" on rule_recipients
  for insert with check (
    exists (
      select 1 from rules r
      join gmail_accounts a on a.id = r.account_id
      where r.id = rule_recipients.rule_id and a.user_id = auth.uid()
    )
  );
create policy "rule_recipients_delete_own" on rule_recipients
  for delete using (
    exists (
      select 1 from rules r
      join gmail_accounts a on a.id = r.account_id
      where r.id = rule_recipients.rule_id and a.user_id = auth.uid()
    )
  );

-- forwarded_log: scoped through gmail_accounts ownership
create policy "logs_select_own" on forwarded_log
  for select using (
    exists (select 1 from gmail_accounts where id = forwarded_log.account_id and user_id = auth.uid())
  );

-- invite_codes: authenticated users only
create policy "invite_codes_auth" on invite_codes
  for all using (auth.uid() is not null);

-- signup_requests: public insert (unauthenticated signup notification), authenticated read/update
create policy "signup_requests_public_insert" on signup_requests
  for insert with check (true);
create policy "signup_requests_admin_all" on signup_requests
  for all using (auth.uid() is not null);

-- app_state: any authenticated user
create policy "app_state_auth" on app_state
  for all using (auth.uid() is not null);

-- ============================================================
-- TRIGGER: auto-create profile row on new Supabase Auth signup
-- set search_path = public is required for security definer
-- functions to resolve table names correctly
-- ============================================================

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

-- ============================================================
-- BOOTSTRAP: superadmin (mailrelay2u@gmail.com)
-- This is the delivery account — role = 'superadmin'
-- Run AFTER the schema above.
-- Skip if already created (DO block checks first).
-- PASSWORD: Admin@MailRelay2024 — change after first login
-- ============================================================

DO $$
DECLARE
  v_uid      uuid := gen_random_uuid();
  v_now      timestamptz := now();
  v_existing uuid;
BEGIN
  SELECT id INTO v_existing FROM auth.users WHERE email = 'mailrelay2u@gmail.com';

  IF v_existing IS NOT NULL THEN
    INSERT INTO public.profiles (id, name, role)
    VALUES (v_existing, 'MailRelay Admin', 'superadmin')
    ON CONFLICT (id) DO UPDATE SET role = 'superadmin', name = 'MailRelay Admin';
    RAISE NOTICE 'superadmin already exists — role updated. ID: %', v_existing;
    RETURN;
  END IF;

  INSERT INTO auth.users (
    id, instance_id, aud, role, email, encrypted_password,
    email_confirmed_at, invited_at, confirmation_token, confirmation_sent_at,
    recovery_token, recovery_sent_at, email_change_token_new, email_change,
    email_change_sent_at, last_sign_in_at, raw_app_meta_data, raw_user_meta_data,
    is_super_admin, created_at, updated_at,
    phone, phone_confirmed_at, phone_change, phone_change_token, phone_change_sent_at,
    email_change_token_current, email_change_confirm_status, banned_until,
    reauthentication_token, reauthentication_sent_at, is_sso_user, deleted_at
  ) VALUES (
    v_uid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
    'mailrelay2u@gmail.com',
    crypt('Admin@MailRelay2024', gen_salt('bf')),
    v_now, NULL, '', NULL, '', NULL, '', '', NULL, NULL,
    '{"provider":"email","providers":["email"]}',
    '{"name":"MailRelay Admin"}',
    FALSE, v_now, v_now,
    NULL, NULL, '', '', NULL, '', 0, NULL, '', NULL, FALSE, NULL
  );

  INSERT INTO auth.identities (id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at, provider_id)
  VALUES (
    gen_random_uuid(), v_uid,
    jsonb_build_object('sub', v_uid::text, 'email', 'mailrelay2u@gmail.com'),
    'email', v_now, v_now, v_now, v_uid::text
  );

  INSERT INTO public.profiles (id, name, role)
  VALUES (v_uid, 'MailRelay Admin', 'superadmin')
  ON CONFLICT (id) DO UPDATE SET role = 'superadmin';

  RAISE NOTICE 'SUCCESS — superadmin created. ID: %', v_uid;
END;
$$;

-- ============================================================
-- VERIFY (uncomment and run to confirm)
-- ============================================================
-- SELECT u.email, p.role, u.email_confirmed_at IS NOT NULL AS confirmed
-- FROM auth.users u JOIN public.profiles p ON p.id = u.id
-- WHERE u.email = 'mailrelay2u@gmail.com';

-- ============================================================
-- POLLING CRON (Supabase pg_cron + pg_net)
-- Runs every 1 minute — no Vercel Pro needed
-- ============================================================
--
-- 1. Dashboard → Database → Extensions → enable pg_cron and pg_net
--
-- 2. Schedule the poll (extensions.http_get is async — returns immediately, no timeout):
-- SELECT cron.unschedule('mailrelay-poll');
--
-- SELECT cron.schedule(
--   'mailrelay-poll',
--   '* * * * *',
--   $$
--     SELECT extensions.http_get(
--       'https://YOUR_APP_URL/api/poll-gmail?secret=mailrelay_cron_secret_2024'
--     );
--   $$
-- );
--
-- 3. Verify:       SELECT * FROM cron.job;
-- 4. Check runs:   SELECT * FROM cron.job_run_details ORDER BY start_time DESC LIMIT 5;
-- 5. Remove:       SELECT cron.unschedule('mailrelay-poll');
-- ============================================================

-- ============================================================
-- AUTH EMAIL TEMPLATES (set in Supabase Dashboard →
-- Authentication → Email Templates)
-- Set OTP Expiry to 300 seconds (5 minutes)
--
-- CONFIRM SIGNUP subject: "Your MailRelay verification code"
-- <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px">
--   <h2 style="color:#4B6BF1">Verify your email</h2>
--   <p>Use the code below to verify your MailRelay account.
--      It expires in <strong>5 minutes</strong>.</p>
--   <div style="background:#f3f4f6;border-radius:12px;padding:24px;text-align:center;margin:24px 0">
--     <span style="font-size:36px;font-weight:bold;letter-spacing:8px;color:#111827">{{ .Token }}</span>
--   </div>
--   <p style="color:#6b7280;font-size:13px">If you didn't sign up for MailRelay, ignore this email.</p>
-- </div>
--
-- PASSWORD RESET subject: "Your MailRelay password reset code"
-- <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px">
--   <h2 style="color:#4B6BF1">Reset your password</h2>
--   <p>Use the code below to reset your MailRelay password.
--      It expires in <strong>5 minutes</strong>.</p>
--   <div style="background:#f3f4f6;border-radius:12px;padding:24px;text-align:center;margin:24px 0">
--     <span style="font-size:36px;font-weight:bold;letter-spacing:8px;color:#111827">{{ .Token }}</span>
--   </div>
--   <p style="color:#6b7280;font-size:13px">If you didn't request this, ignore this email.</p>
-- </div>
-- ============================================================
