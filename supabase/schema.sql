-- Supabase → SQL Editor → вставить и выполнить целиком
create table if not exists users (
  id text primary key,
  name text not null default 'Гость',
  plus_until bigint not null default 0,
  joined bigint not null default (extract(epoch from now())*1000)::bigint
);
create table if not exists sessions (
  sid text primary key,
  uid text not null references users(id) on delete cascade
);
create table if not exists pending (
  token text primary key,
  uid text,
  t bigint not null
);
create table if not exists rooms (
  id text primary key,
  name text not null,
  owner text not null,
  video text not null default '',
  playing boolean not null default false,
  pos double precision not null default 0,
  pos_at bigint not null default 0,
  updated bigint not null default 0
);
create table if not exists messages (
  id bigserial primary key,
  room text not null references rooms(id) on delete cascade,
  name text not null,
  plus boolean not null default false,
  text text not null,
  ts bigint not null
);
create index if not exists messages_room_idx on messages(room, id desc);
create table if not exists reviews (
  id bigserial primary key,
  uid text, rating int, text text, room text, ts bigint
);
create table if not exists settings (
  key text primary key,
  value jsonb not null
);
-- Доступ только через сервер (service role). Прямой доступ из браузера закрыт.
alter table users enable row level security;
alter table sessions enable row level security;
alter table pending enable row level security;
alter table rooms enable row level security;
alter table messages enable row level security;
alter table reviews enable row level security;
alter table settings enable row level security;
