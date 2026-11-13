-- Common Voice local schema. No sample users are inserted.

create table users (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  handle text not null unique,
  password_hash text not null,
  display_name text not null check (char_length(display_name) between 1 and 80),
  bio text not null default '' check (char_length(bio) <= 500),
  neighborhood text not null default '' check (char_length(neighborhood) <= 80),
  role text not null default 'resident' check (role in ('resident', 'organizer', 'civic_professional', 'community_business')),
  avatar_media_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  token_hash text not null unique,
  csrf_token text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index sessions_user_idx on sessions (user_id, created_at desc);

create table media (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references users(id) on delete cascade,
  storage_key text not null unique,
  mime text not null,
  byte_size integer not null check (byte_size > 0),
  width integer not null check (width > 0),
  height integer not null check (height > 0),
  created_at timestamptz not null default now()
);

create index media_owner_idx on media (owner_id, created_at desc);

alter table users
  add constraint users_avatar_fk
  foreign key (avatar_media_id) references media(id) on delete set null;

create table playbooks (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references users(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 140),
  objective text not null check (char_length(objective) between 1 and 300),
  weeks integer not null check (weeks between 1 and 52),
  steps text not null check (char_length(steps) between 1 and 8000),
  linked_post_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table posts (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references users(id) on delete cascade,
  kind text not null check (kind in ('share', 'ask', 'offer')),
  title text not null default '' check (char_length(title) <= 140),
  body text not null check (char_length(body) between 1 and 4000),
  topic text not null check (topic in (
    'neighborhood', 'mutual_aid', 'local_business', 'housing', 'schools',
    'transit', 'environment', 'civic_process', 'care'
  )),
  price_mode text,
  price_cents integer,
  listing_kind text,
  media_id uuid references media(id) on delete set null,
  playbook_id uuid references playbooks(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint posts_price_chk check (
    (kind = 'share' and price_mode is null and price_cents is null and listing_kind is null)
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
  )
);

alter table playbooks
  add constraint playbooks_linked_post_fk
  foreign key (linked_post_id) references posts(id) on delete set null;

create index posts_feed_idx on posts (created_at desc) where deleted_at is null;
create index posts_author_idx on posts (author_id, created_at desc) where deleted_at is null;
create index posts_listing_idx on posts (created_at desc) where deleted_at is null and kind = 'offer';
create index playbooks_author_idx on playbooks (author_id, created_at desc) where deleted_at is null;

create table comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references posts(id) on delete cascade,
  author_id uuid not null references users(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 1000),
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index comments_post_idx on comments (post_id, created_at) where deleted_at is null;

create table likes (
  user_id uuid not null references users(id) on delete cascade,
  post_id uuid not null references posts(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, post_id)
);

create table saves (
  user_id uuid not null references users(id) on delete cascade,
  post_id uuid not null references posts(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, post_id)
);

create table follows (
  follower_id uuid not null references users(id) on delete cascade,
  followee_id uuid not null references users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (follower_id, followee_id),
  check (follower_id <> followee_id)
);

create table playbook_saves (
  user_id uuid not null references users(id) on delete cascade,
  playbook_id uuid not null references playbooks(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, playbook_id)
);

create table inquiries (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references posts(id) on delete cascade,
  author_id uuid not null references users(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 2000),
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index inquiries_post_idx on inquiries (post_id, created_at) where deleted_at is null;
create index inquiries_author_idx on inquiries (author_id, created_at desc) where deleted_at is null;

create table rate_limits (
  bucket text not null,
  window_start timestamptz not null,
  count integer not null,
  primary key (bucket, window_start)
);
