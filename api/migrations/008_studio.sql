-- Additive studio drafts, renders, and publish jobs. No sample clips are inserted.

alter table videos add column purpose text not null default 'upload';
alter table videos add constraint videos_purpose_chk check (purpose in ('upload', 'render'));

alter table posts add column studio_project_id uuid;
alter table posts add column disclosure_sponsor boolean not null default false;
alter table posts add column disclosure_paid boolean not null default false;
alter table posts add column disclosure_ai boolean not null default false;
alter table posts add column comments_enabled boolean not null default true;
alter table posts add column download_allowed boolean not null default true;
alter table posts add column held_for_review boolean not null default false;
alter table posts add column caption_mode text not null default 'off';
alter table posts add column cover_headline text not null default '';
alter table posts add constraint posts_caption_mode_chk check (caption_mode in ('off', 'sidecar', 'burn_in'));

create table studio_projects (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references users(id) on delete cascade,
  title text not null,
  body text not null default '',
  topic text not null default 'neighborhood',
  template text not null default 'none',
  group_id uuid references groups(id) on delete set null,
  status text not null default 'draft',
  edit_version integer not null default 1 check (edit_version > 0),
  original_volume numeric(3,2) not null default 1,
  voice_volume numeric(3,2) not null default 1,
  voiceover_id uuid,
  caption_mode text not null default 'sidecar',
  comments_enabled boolean not null default true,
  download_allowed boolean not null default true,
  remix_permission text not null default 'none',
  disclosure_sponsor boolean not null default false,
  disclosure_paid boolean not null default false,
  disclosure_ai boolean not null default false,
  rights_declared boolean not null default false,
  health_claim boolean not null default false,
  review_status text not null default 'not_required',
  cover_headline text not null default '',
  cover_time_ms integer not null default 0,
  timezone text not null default 'America/New_York',
  scheduled_at timestamptz,
  published_post_id uuid references posts(id) on delete set null,
  output_video_id uuid references videos(id) on delete set null,
  rendered_version integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint studio_status_chk check (status in ('draft', 'rendering', 'ready', 'failed', 'pending_review', 'scheduled', 'publishing', 'published')),
  constraint studio_template_chk check (template in ('none', 'grow', 'harvest', 'prep', 'sourcing', 'volunteer', 'community_lesson')),
  constraint studio_caption_chk check (caption_mode in ('off', 'sidecar', 'burn_in')),
  constraint studio_remix_chk check (remix_permission in ('none', 'attributed_later')),
  constraint studio_review_chk check (review_status in ('not_required', 'pending', 'approved', 'rejected')),
  constraint studio_volume_chk check (original_volume >= 0 and original_volume <= 1 and voice_volume >= 0 and voice_volume <= 1)
);

create table studio_audio (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references users(id) on delete cascade,
  kind text not null check (kind in ('voiceover', 'music')),
  storage_key text not null unique,
  mime text not null,
  byte_size integer not null check (byte_size > 0),
  duration_ms integer not null check (duration_ms > 0),
  rights_declared boolean not null default false,
  created_at timestamptz not null default now()
);

alter table studio_projects
  add constraint studio_voiceover_fk foreign key (voiceover_id) references studio_audio(id) on delete set null;

create table studio_segments (
  project_id uuid not null references studio_projects(id) on delete cascade,
  position smallint not null check (position between 0 and 7),
  video_id uuid not null references videos(id) on delete cascade,
  start_ms integer not null check (start_ms >= 0),
  end_ms integer not null check (end_ms > start_ms),
  speed numeric(2,1) not null check (speed in (0.5, 1.0, 1.5, 2.0)),
  primary key (project_id, position)
);

create table studio_overlays (
  project_id uuid not null references studio_projects(id) on delete cascade,
  position smallint not null check (position between 0 and 7),
  start_ms integer not null check (start_ms >= 0),
  end_ms integer not null check (end_ms > start_ms),
  text text not null,
  x_pct smallint not null check (x_pct between 0 and 100),
  y_pct smallint not null check (y_pct between 0 and 100),
  size text not null check (size in ('small', 'medium', 'large')),
  primary key (project_id, position)
);

create table studio_captions (
  project_id uuid not null references studio_projects(id) on delete cascade,
  position smallint not null check (position between 0 and 39),
  start_ms integer not null check (start_ms >= 0),
  end_ms integer not null check (end_ms > start_ms),
  text text not null,
  primary key (project_id, position)
);

create table studio_cards (
  project_id uuid not null references studio_projects(id) on delete cascade,
  position smallint not null check (position between 0 and 3),
  kind text not null check (kind in ('offer', 'ask', 'cause', 'group', 'event', 'playbook')),
  target_id uuid not null,
  primary key (project_id, position)
);

create table post_cards (
  post_id uuid not null references posts(id) on delete cascade,
  position smallint not null check (position between 0 and 3),
  kind text not null check (kind in ('offer', 'ask', 'cause', 'group', 'event', 'playbook')),
  target_id uuid not null,
  primary key (post_id, position)
);

create table studio_jobs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references studio_projects(id) on delete cascade,
  edit_version integer not null,
  kind text not null check (kind in ('render', 'publish')),
  status text not null default 'queued' check (status in ('queued', 'running', 'ready', 'failed', 'canceled')),
  attempt integer not null default 0,
  error text,
  locked_at timestamptz,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);

create index studio_jobs_queue_idx on studio_jobs (created_at) where status in ('queued', 'running');
create index studio_projects_schedule_idx on studio_projects (scheduled_at) where status = 'scheduled';

create table studio_revisions (
  project_id uuid not null references studio_projects(id) on delete cascade,
  version integer not null,
  snapshot jsonb not null,
  created_at timestamptz not null default now(),
  primary key (project_id, version)
);

create table studio_events (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references studio_projects(id) on delete cascade,
  actor_id uuid references users(id) on delete set null,
  action text not null,
  note text not null default '',
  created_at timestamptz not null default now()
);

alter table posts
  add constraint posts_studio_project_fk foreign key (studio_project_id) references studio_projects(id) on delete set null;
