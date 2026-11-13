-- Additive. Count goals stay counts. No campaigns, pledges, or balances are inserted.
-- Pledges are intentions. They are not financial_records.

alter table sponsor_proposals alter column goal_id drop not null;
alter table sponsor_proposals add column cause_id uuid;
alter table sponsor_proposals add constraint sponsor_proposals_target_chk check (
  (goal_id is not null and cause_id is null) or (goal_id is null and cause_id is not null)
);

create table causes (
  id uuid primary key default gen_random_uuid(),
  organizer_id uuid not null references users(id) on delete cascade,
  group_id uuid references groups(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 140),
  story text not null check (char_length(story) between 1 and 8000),
  category text not null check (category in ('neighborhood', 'mutual_aid', 'education', 'environment', 'local_services')),
  locality_label text not null default '' check (char_length(locality_label) <= 120),
  latitude numeric(6,2),
  longitude numeric(6,2),
  beneficiary_label text not null check (char_length(beneficiary_label) between 2 and 80),
  beneficiary_relation text not null check (beneficiary_relation in ('self', 'authorized_organizer')),
  cover_media_id uuid references media(id) on delete set null,
  goal_cents integer not null check (goal_cents between 100 and 100000000),
  currency text not null check (currency = 'USD'),
  target_at timestamptz,
  timezone text not null default 'UTC' check (char_length(timezone) between 1 and 64),
  status text not null default 'draft' check (status in ('draft', 'active', 'paused', 'completed', 'cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint causes_coords_chk check (
    (latitude is null and longitude is null)
    or (latitude between -90 and 90 and longitude between -180 and 180)
  )
);

alter table sponsor_proposals
  add constraint sponsor_proposals_cause_fk foreign key (cause_id) references causes(id) on delete cascade;

create index causes_public_idx on causes (updated_at desc) where status <> 'draft';
create index causes_organizer_idx on causes (organizer_id, created_at desc);

create table cause_updates (
  id uuid primary key default gen_random_uuid(),
  cause_id uuid not null references causes(id) on delete cascade,
  author_id uuid not null references users(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 4000),
  created_at timestamptz not null default now()
);

create table cause_follows (
  user_id uuid not null references users(id) on delete cascade,
  cause_id uuid not null references causes(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, cause_id)
);

create table cause_pledges (
  cause_id uuid not null references causes(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  amount_cents integer not null check (amount_cents between 100 and 100000000),
  currency text not null check (currency = 'USD'),
  message text not null default '' check (char_length(message) <= 500),
  public_credit boolean not null default false,
  status text not null check (status in ('pledged', 'withdrawn')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (cause_id, user_id)
);

create table cause_support (
  cause_id uuid not null references causes(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  kind text not null check (kind in ('in_kind', 'volunteer')),
  detail text not null check (char_length(detail) between 1 and 500),
  public_credit boolean not null default false,
  status text not null check (status in ('offered', 'withdrawn')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (cause_id, user_id, kind)
);

create table cause_flags (
  id uuid primary key default gen_random_uuid(),
  cause_id uuid not null references causes(id) on delete cascade,
  reporter_id uuid not null references users(id) on delete cascade,
  reason text not null check (char_length(reason) between 1 and 500),
  created_at timestamptz not null default now()
);

create table cause_events (
  id uuid primary key default gen_random_uuid(),
  cause_id uuid not null references causes(id) on delete cascade,
  actor_id uuid references users(id) on delete set null,
  action text not null check (char_length(action) between 1 and 40),
  note text not null default '' check (char_length(note) <= 500),
  created_at timestamptz not null default now()
);

create index cause_events_idx on cause_events (cause_id, created_at);
