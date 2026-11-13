-- Account recovery. Existing users stay signed in. Mail stays off until SMTP_HOST is set.

alter table users add column email_verified_at timestamptz;

create table account_tokens (
  id uuid primary key,
  user_id uuid not null references users(id) on delete cascade,
  purpose text not null check (purpose in ('reset', 'verify')),
  token_hash text not null unique,
  expires_at timestamptz not null,
  used_at timestamptz
);
