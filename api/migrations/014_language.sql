-- Interface language on the account, and a cache of translated text.
-- Existing rows stay. Language defaults to English. Nothing is translated until a provider is configured.

alter table users add column language text not null default 'en'
  check (language in ('en', 'pt-BR', 'es', 'ja', 'ko', 'zh-CN'));

create table translations (
  text_hash text not null,
  target text not null check (target in ('en', 'pt-BR', 'es', 'ja', 'ko', 'zh-CN')),
  translated text not null check (char_length(translated) between 1 and 8000),
  created_at timestamptz not null default now(),
  primary key (text_hash, target)
);
