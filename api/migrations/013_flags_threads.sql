-- Flags on posts and comments, and private listing threads.
-- Old inquiry rows stay. A thread is added beside each one.

create table content_flags (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references users(id) on delete cascade,
  target_type text not null check (target_type in ('post', 'comment')),
  target_id uuid not null,
  reason text not null check (reason in ('spam', 'harassment', 'scam', 'unsafe', 'misinformation', 'other')),
  note text not null default '' check (char_length(note) <= 500),
  status text not null default 'open' check (status in ('open', 'closed')),
  created_at timestamptz not null default now(),
  unique (reporter_id, target_type, target_id)
);

create index content_flags_open_idx on content_flags (created_at desc) where status = 'open';

create table threads (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references posts(id) on delete cascade,
  buyer_id uuid not null references users(id) on delete cascade,
  seller_id uuid not null references users(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (post_id, buyer_id)
);

create index threads_buyer_idx on threads (buyer_id, created_at desc);
create index threads_seller_idx on threads (seller_id, created_at desc);

create table thread_messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references threads(id) on delete cascade,
  author_id uuid not null references users(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 2000),
  inquiry_id uuid references inquiries(id) on delete set null,
  created_at timestamptz not null default now()
);

create index thread_messages_idx on thread_messages (thread_id, created_at);
create unique index thread_messages_inquiry_idx on thread_messages (inquiry_id) where inquiry_id is not null;

create table thread_reads (
  thread_id uuid not null references threads(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  read_at timestamptz not null default now(),
  primary key (thread_id, user_id)
);

insert into threads (post_id, buyer_id, seller_id, created_at)
select i.post_id, i.author_id, p.author_id, min(i.created_at)
from inquiries i
join posts p on p.id = i.post_id
where i.deleted_at is null and i.author_id <> p.author_id
group by i.post_id, i.author_id, p.author_id
on conflict (post_id, buyer_id) do nothing;

insert into thread_messages (thread_id, author_id, body, inquiry_id, created_at)
select t.id, i.author_id, i.body, i.id, i.created_at
from inquiries i
join posts p on p.id = i.post_id
join threads t on t.post_id = i.post_id and t.buyer_id = i.author_id
where i.deleted_at is null and i.author_id <> p.author_id
  and not exists (select 1 from thread_messages tm where tm.inquiry_id = i.id);
