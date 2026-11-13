-- Additive digital guides. Existing physical listings stay published and unchanged.

alter table posts add column listing_status text not null default 'published';
alter table posts add constraint posts_listing_status_chk check (listing_status in ('draft', 'published'));
alter table posts add column digital_form text;
alter table posts add column content_format text;
alter table posts add column content_language text;
alter table posts add column content_version text not null default '';
alter table posts add column compatibility text not null default '';
alter table posts add column skill_level text;
alter table posts add column accessibility_note text not null default '';
alter table posts add column learning_purpose text not null default '';
alter table posts add column license_kind text;
alter table posts add column license_terms text not null default '';
alter table posts add column license_allows_resale boolean not null default false;
alter table posts add column origin_kind text;
alter table posts add column seller_role text;
alter table posts add column production_credit text not null default '';
alter table posts add column collaborator_credit text not null default '';
alter table posts add column distribution_rights boolean not null default false;
alter table posts add column health_promotion boolean not null default false;
alter table posts add column personalization_prompt text not null default '';
alter table posts add column seller_cost_cents integer;
alter table posts add column expires_at timestamptz;
alter table posts add column demo_video_id uuid references videos(id) on delete set null;
alter table posts add column edit_version integer not null default 1;
alter table posts add column featured boolean not null default false;
alter table posts add constraint posts_digital_form_chk check (digital_form is null or digital_form in ('guide', 'ebook', 'pdf', 'template', 'printable', 'audio', 'video', 'course_bundle'));
alter table posts add constraint posts_content_format_chk check (content_format is null or content_format in ('pdf', 'epub', 'mp3', 'm4a', 'wav', 'mp4', 'webm', 'zip', 'mixed'));
alter table posts add constraint posts_skill_chk check (skill_level is null or skill_level in ('beginner', 'intermediate', 'advanced'));
alter table posts add constraint posts_license_chk check (license_kind is null or license_kind in ('personal', 'commercial'));
alter table posts add constraint posts_origin_chk check (origin_kind is null or origin_kind in ('made', 'designed', 'curated', 'sourced'));
alter table posts add constraint posts_seller_role_chk check (seller_role is null or seller_role in ('creator', 'licensed_reseller'));
alter table posts add constraint posts_seller_cost_chk check (seller_cost_cents is null or seller_cost_cents between 0 and 100000000);

alter table videos drop constraint videos_purpose_chk;
alter table videos add constraint videos_purpose_chk check (purpose in ('upload', 'render', 'listing_demo'));

do $$
declare cname text;
begin
  select conname into cname from pg_constraint
  where conrelid = 'post_images'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%position%';
  if cname is not null then
    execute format('alter table post_images drop constraint %I', cname);
  end if;
end $$;
alter table post_images add constraint post_images_position_chk check (position between 0 and 19);
alter table post_images add column focal_x smallint not null default 50;
alter table post_images add column focal_y smallint not null default 50;
alter table post_images add constraint post_images_focal_chk check (focal_x between 0 and 100 and focal_y between 0 and 100);

alter table inquiries add column personalization text not null default '';
alter table inquiries add constraint inquiries_personalization_chk check (char_length(personalization) <= 500);

create table post_tags (
  post_id uuid not null references posts(id) on delete cascade,
  position smallint not null check (position between 0 and 12),
  tag text not null check (char_length(tag) between 2 and 24),
  primary key (post_id, position),
  unique (post_id, tag)
);

create table shop_sections (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references users(id) on delete cascade,
  name text not null check (char_length(name) between 2 and 40),
  position smallint not null check (position between 0 and 11),
  unique (owner_id, position)
);

alter table posts add column shop_section_id uuid references shop_sections(id) on delete set null;

create table listing_variants (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references posts(id) on delete cascade,
  position smallint not null check (position between 0 and 7),
  axis_a text not null default '',
  axis_b text not null default '',
  is_free boolean not null default false,
  price_cents integer,
  sku text not null default '',
  available boolean not null default true,
  unique (post_id, position),
  constraint listing_variant_price_chk check (
    (is_free = true and price_cents is null) or (is_free = false and price_cents between 1 and 100000000)
  )
);

create table listing_files (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references posts(id) on delete cascade,
  variant_id uuid references listing_variants(id) on delete cascade,
  version integer not null check (version > 0),
  storage_key text not null unique,
  original_name text not null,
  mime text not null,
  byte_size integer not null check (byte_size > 0 and byte_size <= 26214400),
  duration_ms integer,
  note text not null default '',
  is_current boolean not null default true,
  created_at timestamptz not null default now()
);

create table library_grants (
  user_id uuid not null references users(id) on delete cascade,
  variant_id uuid not null references listing_variants(id) on delete cascade,
  post_id uuid not null references posts(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, variant_id)
);

create table library_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  variant_id uuid not null references listing_variants(id) on delete cascade,
  action text not null check (action in ('claim', 'download')),
  created_at timestamptz not null default now()
);
