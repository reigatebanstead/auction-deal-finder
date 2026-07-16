create table if not exists public.lots (
  id text primary key,
  source text not null,
  auction_house text not null,
  auction_title text not null,
  lot_number integer not null,
  title text not null,
  description text,
  condition_report text,
  image_urls jsonb not null default '[]'::jsonb,
  current_bid numeric,
  start_price numeric,
  estimated_resale_low numeric,
  estimated_resale numeric,
  estimated_resale_high numeric,
  max_hammer_bid numeric,
  expected_profit numeric,
  confidence text not null default 'Low',
  recommendation text not null default 'WATCH',
  closing_at timestamptz,
  url text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.lots enable row level security;

create policy "Public read lots"
on public.lots for select
using (true);
