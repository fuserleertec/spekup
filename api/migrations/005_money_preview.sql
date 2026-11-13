-- Additive preview for proposed fees and saved interest. No charges, balances, or sample orders.
-- Config rows below are a proposal, not customer transactions.

create table payment_settings (
  singleton text primary key default 'default' check (singleton = 'default'),
  gate_open boolean not null default false,
  provider text
);

insert into payment_settings (singleton, gate_open, provider) values ('default', false, null);

create table fee_schedules (
  version integer primary key check (version > 0),
  status text not null check (status = 'proposed_preview'),
  currency text not null check (currency = 'USD'),
  platform_fee_bps integer not null check (platform_fee_bps between 0 and 10000),
  label text not null check (char_length(label) between 1 and 160),
  note text not null check (char_length(note) between 1 and 800),
  created_at timestamptz not null default now()
);

insert into fee_schedules (version, status, currency, platform_fee_bps, label, note) values (
  1,
  'proposed_preview',
  'USD',
  500,
  'Proposed preview—not final pricing',
  'Five percent (500 basis points) of a fixed listing price is a preview figure so a quote can be shown. It is not an approved price. Earlier suggestions were ranges, not a decision. Processor fees are unknown until a provider is connected and are not included.'
);

create table plan_catalog (
  code text primary key check (code in ('supporter', 'pro', 'organizer')),
  title text not null,
  summary text not null,
  created_at timestamptz not null default now()
);

insert into plan_catalog (code, title, summary) values
  ('supporter', 'Supporter', 'Optional interest in supporting Common Voice later. Saving interest does not start a membership or a charge.'),
  ('pro', 'Pro tools', 'Optional interest in seller tools. Requesting Pro does not verify a credential and does not turn on a paid badge.'),
  ('organizer', 'Organizer tools', 'Optional interest in group-goal tools. Requesting this does not approve a grant or a sponsorship payment.');

create table plan_interests (
  user_id uuid not null references users(id) on delete cascade,
  plan_code text not null references plan_catalog(code),
  status text not null check (status in ('requested', 'withdrawn')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, plan_code)
);

create table entitlements (
  user_id uuid not null references users(id) on delete cascade,
  code text not null check (code in ('pro_commercial')),
  active boolean not null default false,
  source text not null default '',
  created_at timestamptz not null default now(),
  primary key (user_id, code)
);

create table quote_requests (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references posts(id) on delete cascade,
  buyer_id uuid not null references users(id) on delete cascade,
  schedule_version integer not null references fee_schedules(version),
  price_cents integer not null check (price_cents > 0),
  platform_fee_bps integer not null check (platform_fee_bps between 0 and 10000),
  platform_fee_cents integer not null check (platform_fee_cents >= 0),
  seller_net_cents integer not null check (seller_net_cents >= 0),
  buyer_total_cents integer not null check (buyer_total_cents >= 0),
  currency text not null check (currency = 'USD'),
  status text not null check (status in ('interest_saved', 'withdrawn')),
  created_at timestamptz not null default now(),
  unique (listing_id, buyer_id)
);

create table support_interests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  post_id uuid references posts(id) on delete cascade,
  wished_cents integer check (wished_cents is null or wished_cents > 0),
  note text not null default '' check (char_length(note) <= 500),
  status text not null check (status in ('requested', 'withdrawn')),
  created_at timestamptz not null default now()
);

create table community_goals (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references groups(id) on delete cascade,
  organizer_id uuid not null references users(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 140),
  detail text not null check (char_length(detail) between 1 and 2000),
  progress_label text not null check (char_length(progress_label) between 1 and 80),
  progress_count integer not null default 0 check (progress_count >= 0),
  progress_target integer not null check (progress_target > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table sponsor_proposals (
  id uuid primary key default gen_random_uuid(),
  goal_id uuid not null references community_goals(id) on delete cascade,
  proposer_id uuid not null references users(id) on delete cascade,
  kind text not null check (kind in ('sponsor', 'partner')),
  statement text not null check (char_length(statement) between 1 and 2000),
  status text not null default 'submitted' check (status in ('submitted', 'agreed', 'declined', 'withdrawn')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table financial_records (
  id uuid primary key default gen_random_uuid(),
  idempotency_key text not null unique,
  actor_id uuid references users(id) on delete restrict,
  amount_cents integer not null check (amount_cents >= 0),
  currency text not null check (currency = 'USD'),
  status text not null check (status in ('pending', 'succeeded', 'failed', 'canceled')),
  source text not null check (char_length(source) between 1 and 40),
  created_at timestamptz not null default now()
);

alter table inquiries add column purpose text not null default 'message'
  check (purpose in ('message', 'booking_request'));
