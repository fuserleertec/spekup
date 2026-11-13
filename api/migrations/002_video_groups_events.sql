-- Additive. Existing users, posts, listings, and media rows are not rewritten.
-- New columns are nullable. New tables start empty.

create table videos (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references users(id) on delete cascade,
  status text not null default 'queued' check (status in ('queued', 'processing', 'ready', 'failed')),
  original_key text not null unique,
  output_key text unique,
  poster_key text unique,
  container text not null,
  video_codec text,
  audio_codec text,
  byte_size integer not null check (byte_size > 0),
  duration_ms integer,
  width integer,
  height integer,
  error text,
  attempts integer not null default 0 check (attempts >= 0),
  locked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index videos_queue_idx on videos (created_at) where status in ('queued', 'processing');
create index videos_owner_idx on videos (owner_id, created_at desc);

create table groups (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references users(id) on delete cascade,
  name text not null check (char_length(name) between 2 and 80),
  description text not null default '' check (char_length(description) <= 500),
  neighborhood text not null default '' check (char_length(neighborhood) <= 80),
  visibility text not null default 'public' check (visibility in ('public', 'private')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table group_members (
  group_id uuid not null references groups(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  role text not null check (role in ('owner', 'admin', 'member')),
  created_at timestamptz not null default now(),
  primary key (group_id, user_id)
);

create index group_members_user_idx on group_members (user_id);

create table events (
  id uuid primary key default gen_random_uuid(),
  organizer_id uuid not null references users(id) on delete cascade,
  group_id uuid references groups(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 140),
  description text not null check (char_length(description) between 1 and 4000),
  starts_at timestamptz not null,
  ends_at timestamptz,
  timezone text not null check (char_length(timezone) between 1 and 64),
  place text not null default '' check (char_length(place) <= 200),
  online_url text not null default '' check (char_length(online_url) <= 300),
  status text not null default 'scheduled' check (status in ('scheduled', 'cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint events_when_chk check (ends_at is null or ends_at > starts_at),
  constraint events_where_chk check (char_length(place) > 0 or char_length(online_url) > 0)
);

create index events_starts_idx on events (starts_at desc);
create index events_group_idx on events (group_id, starts_at desc);

create table event_rsvps (
  event_id uuid not null references events(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (event_id, user_id)
);

alter table posts add column group_id uuid references groups(id) on delete cascade;
alter table posts add column video_id uuid references videos(id) on delete set null;

create index posts_group_idx on posts (group_id, created_at desc) where deleted_at is null;
create index posts_video_idx on posts (video_id) where deleted_at is null and video_id is not null;
