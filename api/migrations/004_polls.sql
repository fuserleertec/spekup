-- Additive. Accounts, posts, photos, clips, groups, events, reports, and follows stay.
-- No sample polls are inserted.

alter table posts drop constraint posts_kind_check;
alter table posts add constraint posts_kind_chk check (kind in ('share', 'ask', 'offer', 'poll'));

alter table posts drop constraint posts_price_chk;
alter table posts add constraint posts_price_chk check (
  (kind = 'share' and price_mode is null and price_cents is null and listing_kind is null)
  or (kind = 'poll' and price_mode is null and price_cents is null and listing_kind is null)
  or (
    kind = 'ask' and listing_kind is null and (
      (price_mode = 'fixed' and price_cents between 1 and 100000000)
      or (price_mode in ('negotiable', 'free_service', 'free_advice') and price_cents is null)
    )
  )
  or (
    kind = 'offer' and listing_kind in ('local_good', 'digital_guide', 'service') and (
      (price_mode = 'fixed' and price_cents between 1 and 100000000)
      or (price_mode in ('negotiable', 'free_service', 'free_advice') and price_cents is null)
    )
  )
);

create table polls (
  post_id uuid primary key references posts(id) on delete cascade,
  subject_type text not null check (subject_type in ('politician', 'corporation', 'community')),
  subject_label text not null default '' check (char_length(subject_label) <= 120),
  closes_at timestamptz,
  timezone text not null default 'UTC' check (char_length(timezone) between 1 and 64),
  status text not null default 'open' check (status in ('open', 'closed', 'canceled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index polls_status_idx on polls (status, closes_at);

create table poll_options (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references polls(post_id) on delete cascade,
  label text not null check (char_length(label) between 1 and 80),
  position smallint not null check (position between 0 and 5),
  unique (post_id, position),
  unique (post_id, id)
);

create unique index poll_options_label_idx on poll_options (post_id, lower(label));

create table poll_votes (
  post_id uuid not null references polls(post_id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  option_id uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (post_id, user_id),
  foreign key (post_id, option_id) references poll_options (post_id, id) on delete cascade
);

create index poll_votes_option_idx on poll_votes (option_id);

create table poll_follows (
  user_id uuid not null references users(id) on delete cascade,
  post_id uuid not null references polls(post_id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, post_id)
);

create index poll_follows_user_idx on poll_follows (user_id, created_at desc);

create table poll_events (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references polls(post_id) on delete cascade,
  actor_id uuid references users(id) on delete set null,
  action text not null check (char_length(action) between 1 and 40),
  note text not null default '' check (char_length(note) <= 500),
  created_at timestamptz not null default now()
);

create index poll_events_idx on poll_events (post_id, created_at);
