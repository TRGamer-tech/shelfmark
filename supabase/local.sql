-- For development only. Never run this on a Supabase project: it is what Supabase
-- already has, rebuilt in the smallest way, so that schema.sql and test.sql can run on a
-- plain local PostgreSQL (see dev_server.py).

do $$
begin
    if not exists (select 1 from pg_roles where rolname = 'anon') then
        create role anon nologin;
    end if;
    if not exists (select 1 from pg_roles where rolname = 'authenticated') then
        create role authenticated nologin;
    end if;
end
$$;

create schema if not exists auth;

create table if not exists auth.users (
    id uuid primary key default gen_random_uuid(),
    email text unique,
    encrypted_password text,
    confirmed boolean not null default true,
    created_at timestamptz not null default now()
);

-- Who the request says it is, the way Supabase tells the database.
create or replace function auth.uid()
returns uuid
language sql
stable
as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

grant usage on schema auth to anon, authenticated;
grant execute on function auth.uid() to anon, authenticated;
