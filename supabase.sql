-- ============================================================
-- MailRelay Schema — fully rerunnable
-- Run this in Supabase SQL Editor (Dashboard → SQL Editor)
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

-- All users are admins. The first user (SMTP_USER) is bootstrapped
-- manually via Supabase Auth → Users → "Add user" in the dashboard.
create table profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  name       text,
  role       text default 'admin',   -- every account is an admin
  created_at timestamptz default now()
);

create table signup_requests (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  email      text not null unique,
  status     text default 'pending', -- pending | approved | rejected
  created_at timestamptz default now()
);

create table invite_codes (
  id         uuid primary key default gen_random_uuid(),
  email      text not null,          -- the email the code was issued for
  code       text not null unique,   -- e.g. ABCD-1234
  used       boolean default false,
  expires_at timestamptz default now() + interval '48 hours',
  created_at timestamptz default now()
);

create table gmail_accounts (
  id                     uuid primary key default gen_random_uuid(),
  user_id                uuid references profiles(id) on delete cascade,
  label                  text not null,
  email                  text not null unique,
  app_password_encrypted text not null,   -- AES-256-GCM encrypted
  active                 boolean default true,
  last_polled_at         timestamptz,
  last_poll_status       text,            -- ok | auth_error | imap_error
  created_at             timestamptz default now()
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

-- invite_codes, signup_requests, app_state: any authenticated user (all are admins)
create policy "invite_codes_auth"    on invite_codes    for all using (auth.uid() is not null);
create policy "signup_requests_auth" on signup_requests for all using (auth.uid() is not null);
create policy "app_state_auth"       on app_state       for all using (auth.uid() is not null);

-- ============================================================
-- TRIGGER: auto-create profile row on new Supabase Auth signup
-- ============================================================

create or replace function handle_new_user()
returns trigger language plpgsql security definer as $$
begin
  insert into profiles (id, name)
  values (new.id, new.raw_user_meta_data->>'name');
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure handle_new_user();


-- ============================================================
-- BOOTSTRAP: First Admin via SQL (Dashboard "Add user" is broken
-- due to a Supabase temp API key bug — use SQL instead)
-- ============================================================
--
-- Run the block below AS-IS in Supabase SQL Editor.
-- It creates btcmaster657@gmail.com directly in auth.users
-- with a bcrypt-hashed password and a confirmed email.
--
-- PASSWORD USED BELOW: Admin@MailRelay2024
-- Change it after first login at /account/security
--
-- ⚠ Run this AFTER the schema above (tables + trigger must exist first)
-- ============================================================

-- ============================================================
-- STEP 1: Clean up any broken previous attempt
-- ============================================================
DELETE FROM public.profiles
  WHERE id IN (SELECT id FROM auth.users WHERE email = 'btcmaster657@gmail.com');

DELETE FROM auth.identities
  WHERE user_id IN (SELECT id FROM auth.users WHERE email = 'btcmaster657@gmail.com');

DELETE FROM auth.users WHERE email = 'btcmaster657@gmail.com';

-- ============================================================
-- STEP 2: Insert the admin user with ALL required auth columns
-- ============================================================
DO $$
DECLARE
  v_uid  uuid := gen_random_uuid();
  v_now  timestamptz := now();
BEGIN
  -- Insert into auth.users with every column Supabase Auth needs
  INSERT INTO auth.users (
    id,
    instance_id,
    aud,
    role,
    email,
    encrypted_password,
    email_confirmed_at,
    invited_at,
    confirmation_token,
    confirmation_sent_at,
    recovery_token,
    recovery_sent_at,
    email_change_token_new,
    email_change,
    email_change_sent_at,
    last_sign_in_at,
    raw_app_meta_data,
    raw_user_meta_data,
    is_super_admin,
    created_at,
    updated_at,
    phone,
    phone_confirmed_at,
    phone_change,
    phone_change_token,
    phone_change_sent_at,
    email_change_token_current,
    email_change_confirm_status,
    banned_until,
    reauthentication_token,
    reauthentication_sent_at,
    is_sso_user,
    deleted_at
  ) VALUES (
    v_uid,
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    'btcmaster657@gmail.com',
    crypt('Admin@MailRelay2024', gen_salt('bf')),
    v_now,   -- email already confirmed
    NULL,
    '',      -- no pending confirmation
    NULL,
    '',      -- no pending recovery
    NULL,
    '',
    '',
    NULL,
    NULL,
    '{"provider": "email", "providers": ["email"]}',
    '{"name": "Admin"}',
    FALSE,
    v_now,
    v_now,
    NULL, NULL, '', '', NULL, '', 0, NULL, '', NULL, FALSE, NULL
  );

  -- Insert the identity record (required for email provider sign-in)
  INSERT INTO auth.identities (
    id,
    user_id,
    identity_data,
    provider,
    last_sign_in_at,
    created_at,
    updated_at,
    provider_id
  ) VALUES (
    gen_random_uuid(),
    v_uid,
    jsonb_build_object('sub', v_uid::text, 'email', 'btcmaster657@gmail.com'),
    'email',
    v_now,
    v_now,
    v_now,
    v_uid::text
  );

  -- Create the profile row
  INSERT INTO public.profiles (id, name, role)
  VALUES (v_uid, 'Admin', 'admin')
  ON CONFLICT (id) DO NOTHING;

  RAISE NOTICE 'SUCCESS — Admin created. ID: %', v_uid;
END;
$$;

-- ============================================================
-- STEP 3: Verify — run this SELECT to confirm it worked
-- ============================================================
-- SELECT
--   u.id,
--   u.email,
--   u.email_confirmed_at IS NOT NULL AS email_confirmed,
--   u.encrypted_password IS NOT NULL AS has_password,
--   i.provider,
--   p.name,
--   p.role
-- FROM auth.users u
-- JOIN auth.identities i ON i.user_id = u.id
-- JOIN public.profiles p ON p.id = u.id
-- WHERE u.email = 'btcmaster657@gmail.com';
--
-- All columns should show: email_confirmed=true, has_password=true,
-- provider=email, role=admin
--
-- STEP 4: Sign in at /login
--   Email:    btcmaster657@gmail.com
--   Password: Admin@MailRelay2024
--
-- STEP 5: Immediately change password at /account/security
--
-- ============================================================
-- FUTURE ADMINS: Invite Flow
-- ============================================================
--
-- 1. New user visits /signup → enters name + email → request saved in DB
-- 2. btcmaster657@gmail.com receives email: "New signup request from X"
-- 3. Admin logs in → /admin/invites → sees pending request → clicks "Send Invite"
-- 4. Code (e.g. WXYZ-5678) is generated → emailed to btcmaster657@gmail.com inbox
-- 5. Admin copies the code → sends it to the new user manually (WhatsApp/email/etc)
-- 6. New user visits /signup/redeem → enters email + code + chosen password
-- 7. Account created, code marked used → new user signs in at /login
--
-- ============================================================
-- POLLING CRON (Supabase pg_cron + pg_net)
-- Runs every 1 minute directly from Supabase — free, no Vercel Pro needed
-- ============================================================
--
-- Enable the required extensions (run once, may already be enabled):
--   Dashboard → Database → Extensions → enable "pg_cron" and "pg_net"
--
-- Then run this block to schedule the poll every minute:
--
-- SELECT cron.schedule(
--   'mailrelay-poll',
--   '* * * * *',
--   $$
--     SELECT extensions.http_get(
--       url := 'https://YOUR_VERCEL_APP.vercel.app/api/poll-gmail?secret=mailrelay_cron_secret_2024'
--     );
--   $$
-- );
--
-- To check it is running:
--   SELECT * FROM cron.job;
--
-- To remove it:
--   SELECT cron.unschedule('mailrelay-poll');
--
-- ============================================================
