-- Additive social controls. Existing follows, posts, clips, and watch history stay empty.

create table feed_interests (
  user_id uuid not null references users(id) on delete cascade,
  topic text not null,
  primary key (user_id, topic)
);

create table feed_hides (
  user_id uuid not null references users(id) on delete cascade,
  post_id uuid not null references posts(id) on delete cascade,
  topic_less boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (user_id, post_id)
);

create table feed_mutes (
  user_id uuid not null references users(id) on delete cascade,
  muted_id uuid not null references users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, muted_id),
  check (user_id <> muted_id)
);

create table feed_settings (
  user_id uuid primary key references users(id) on delete cascade,
  personalization boolean not null default true,
  watch_opt_in boolean not null default false,
  updated_at timestamptz not null default now()
);

create table watch_daily (
  user_id uuid not null references users(id) on delete cascade,
  post_id uuid not null references posts(id) on delete cascade,
  day date not null,
  play_count integer not null default 0 check (play_count >= 0 and play_count <= 3),
  watched_ms integer not null default 0 check (watched_ms >= 0),
  primary key (user_id, post_id, day)
);

create table watch_events (
  id uuid primary key,
  user_id uuid not null references users(id) on delete cascade,
  created_at timestamptz not null default now()
);
