-- HealthTimeline MVP email-login user isolation.
-- Run this once in Supabase SQL Editor before using the app with multiple emails.
--
-- The app does not use Supabase Auth yet. It creates a stable UUID from the
-- normalized email in the browser, then writes/queries data with that user_id.

create extension if not exists pgcrypto;

create table if not exists public.users (
  id uuid primary key,
  email text not null,
  created_at timestamptz not null default now()
);

create unique index if not exists users_email_lower_unique
  on public.users (lower(email));

create table if not exists public.family_members (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.documents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  member_id text,
  title text,
  category text,
  report_type text,
  hospital text,
  institution text,
  report_date date,
  source_type text,
  storage_url text,
  file_url text,
  raw_text text,
  ocr_text text,
  created_at timestamptz not null default now()
);

create table if not exists public.reports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  member_id text,
  hospital text,
  report_date date,
  report_type text,
  file_url text,
  created_at timestamptz not null default now()
);

alter table public.family_members
  add column if not exists user_id uuid references public.users(id) on delete cascade,
  add column if not exists name text,
  add column if not exists created_at timestamptz not null default now();

alter table public.documents
  add column if not exists user_id uuid references public.users(id) on delete cascade,
  add column if not exists member_id text,
  add column if not exists title text,
  add column if not exists category text,
  add column if not exists report_type text,
  add column if not exists hospital text,
  add column if not exists institution text,
  add column if not exists report_date date,
  add column if not exists source_type text,
  add column if not exists storage_url text,
  add column if not exists file_url text,
  add column if not exists raw_text text,
  add column if not exists ocr_text text,
  add column if not exists created_at timestamptz not null default now();

alter table public.reports
  add column if not exists user_id uuid references public.users(id) on delete cascade,
  add column if not exists member_id text,
  add column if not exists hospital text,
  add column if not exists report_date date,
  add column if not exists report_type text,
  add column if not exists file_url text,
  add column if not exists created_at timestamptz not null default now();

create index if not exists family_members_user_id_idx
  on public.family_members(user_id);

create index if not exists documents_user_id_idx
  on public.documents(user_id);

create index if not exists documents_user_id_created_at_idx
  on public.documents(user_id, created_at desc);

create index if not exists reports_user_id_idx
  on public.reports(user_id);

create index if not exists reports_user_id_created_at_idx
  on public.reports(user_id, created_at desc);

insert into storage.buckets (id, name, public)
values ('reports', 'reports', true)
on conflict (id) do nothing;
