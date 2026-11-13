-- Additive. Existing offers stay available. No sample listings are inserted.

alter table posts add column item_condition text;
alter table posts add column quantity integer;
alter table posts add column availability text not null default 'available';
alter table posts add column handoff text;

alter table posts add constraint posts_condition_chk check (item_condition is null or item_condition in ('new', 'good', 'fair', 'worn'));
alter table posts add constraint posts_quantity_chk check (quantity is null or quantity between 0 and 10000);
alter table posts add constraint posts_availability_chk check (availability in ('available', 'unavailable', 'sold', 'archived'));
alter table posts add constraint posts_handoff_chk check (handoff is null or handoff in ('pickup', 'delivery', 'either'));

create table post_images (
  post_id uuid not null references posts(id) on delete cascade,
  media_id uuid not null references media(id) on delete cascade,
  position smallint not null check (position between 0 and 5),
  primary key (post_id, media_id),
  unique (post_id, position)
);
