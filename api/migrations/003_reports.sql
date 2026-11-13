-- Additive. Playbooks, accounts, posts, clips, groups, and events are left in place.

alter table users add column is_moderator boolean not null default false;

create table reports (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references users(id) on delete cascade,
  subject_type text not null check (subject_type in ('politician', 'corporation', 'community')),
  subject_label text not null check (char_length(subject_label) between 2 and 120),
  subject_area text not null default '' check (char_length(subject_area) <= 120),
  category text not null check (category in (
    'public_funds', 'public_safety', 'environment', 'housing', 'workplace', 'services', 'civic_process', 'other'
  )),
  title text not null check (char_length(title) between 1 and 140),
  detail text not null check (char_length(detail) between 1 and 8000),
  incident_date date,
  location_label text not null check (char_length(location_label) between 2 and 120),
  latitude numeric(6,2),
  longitude numeric(6,2),
  status text not null default 'pending' check (status in ('pending', 'published', 'disputed', 'resolved', 'withdrawn')),
  public_note text not null default '' check (char_length(public_note) <= 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint reports_coords_chk check (
    (latitude is null and longitude is null)
    or (latitude between -90 and 90 and longitude between -180 and 180)
  )
);

create index reports_public_idx on reports (updated_at desc) where status in ('published', 'disputed', 'resolved');
create index reports_author_idx on reports (author_id, created_at desc);
create index reports_map_idx on reports (latitude, longitude) where status in ('published', 'disputed', 'resolved') and latitude is not null;

create table report_sources (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references reports(id) on delete cascade,
  url text not null check (char_length(url) between 8 and 500),
  label text not null default '' check (char_length(label) <= 140),
  created_at timestamptz not null default now()
);

create table report_attachments (
  report_id uuid not null references reports(id) on delete cascade,
  media_id uuid not null references media(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (report_id, media_id)
);

create table report_revisions (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references reports(id) on delete cascade,
  editor_id uuid not null references users(id) on delete cascade,
  title text not null,
  detail text not null,
  subject_label text not null,
  category text not null,
  location_label text not null,
  status text not null,
  created_at timestamptz not null default now()
);

create table report_events (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references reports(id) on delete cascade,
  actor_id uuid references users(id) on delete set null,
  action text not null check (char_length(action) between 1 and 40),
  note text not null default '' check (char_length(note) <= 2000),
  created_at timestamptz not null default now()
);

create index report_events_idx on report_events (report_id, created_at);

create table report_follows (
  user_id uuid not null references users(id) on delete cascade,
  report_id uuid not null references reports(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, report_id)
);

create table report_watches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  kind text not null check (kind in ('category', 'subject', 'area')),
  category text,
  subject_type text,
  subject_label text,
  area text,
  created_at timestamptz not null default now()
);

create unique index report_watches_unique on report_watches (
  user_id, kind, coalesce(category, ''), coalesce(subject_type, ''), coalesce(lower(subject_label), ''), coalesce(lower(area), '')
);

create table report_flags (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references reports(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  reason text not null check (char_length(reason) between 1 and 1000),
  created_at timestamptz not null default now()
);

create table report_disputes (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references reports(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  statement text not null check (char_length(statement) between 1 and 4000),
  created_at timestamptz not null default now()
);
