-- Shelfmark server, for a Supabase project (free plan is enough).
--
-- Run this whole file once in the SQL editor of the project. Running it again is safe:
-- it only updates the functions and keeps all data.
--
-- How it is built
--   * All data lives in the schema "shelfmark", which the Data API does not expose.
--     Row level security is switched on and has no policies, so even a mistake in the
--     API settings does not open the tables.
--   * The app only calls the functions named public.shelfmark_*. Each one checks who
--     is asking: a profile is an id plus a secret that only that phone knows. The server
--     keeps a hash of the secret, never the secret itself.
--   * The server is a relay. It stores, per person, the library snapshot they chose to
--     share, and passes borrow requests and answers on to the friend they are meant for.
--     Messages are deleted as soon as the receiving phone has fetched them.

create schema if not exists shelfmark;

create table if not exists shelfmark.profiles (
    id uuid primary key,
    secret_hash text not null,
    name text not null default '',
    -- What a friend types in to connect. Handed out by the owner, can be replaced.
    code text not null unique,
    created_at timestamptz not null default now(),
    seen_at timestamptz not null default now()
);

-- One row per direction. Friends always exist as a pair of rows.
create table if not exists shelfmark.friendships (
    user_id uuid not null references shelfmark.profiles (id) on delete cascade,
    friend_id uuid not null references shelfmark.profiles (id) on delete cascade,
    created_at timestamptz not null default now(),
    primary key (user_id, friend_id)
);

create table if not exists shelfmark.libraries (
    owner_id uuid primary key references shelfmark.profiles (id) on delete cascade,
    payload jsonb not null,
    updated_at timestamptz not null default now()
);

create table if not exists shelfmark.messages (
    id uuid primary key default gen_random_uuid(),
    to_id uuid not null references shelfmark.profiles (id) on delete cascade,
    from_id uuid not null references shelfmark.profiles (id) on delete cascade,
    payload jsonb not null,
    created_at timestamptz not null default now()
);

create index if not exists messages_to_id on shelfmark.messages (to_id, created_at);

-- A single row that the daily check of the apps writes to. Free projects are paused
-- when the database sees no activity for a week, and this is that activity.
create table if not exists shelfmark.heartbeat (
    id int primary key default 1 check (id = 1),
    pinged_at timestamptz not null default now(),
    pings bigint not null default 0
);

insert into shelfmark.heartbeat (id) values (1) on conflict (id) do nothing;

alter table shelfmark.profiles enable row level security;
alter table shelfmark.friendships enable row level security;
alter table shelfmark.libraries enable row level security;
alter table shelfmark.messages enable row level security;
alter table shelfmark.heartbeat enable row level security;

revoke all on schema shelfmark from public;
revoke all on all tables in schema shelfmark from public;

do $$
begin
    -- The roles the Data API uses. They exist in every Supabase project.
    if exists (select 1 from pg_roles where rolname = 'anon') then
        revoke all on schema shelfmark from anon;
        revoke all on all tables in schema shelfmark from anon;
    end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then
        revoke all on schema shelfmark from authenticated;
        revoke all on all tables in schema shelfmark from authenticated;
    end if;
end
$$;

-- ---------------------------------------------------------------------------------
-- Helpers, not reachable from outside
-- ---------------------------------------------------------------------------------

create or replace function shelfmark.hash_secret(p_secret text)
returns text
language sql
immutable
set search_path = ''
as $$
    select encode(sha256(convert_to(p_secret, 'UTF8')), 'hex');
$$;

-- Ten characters from an alphabet without the look-alikes 0, O, 1 and I.
create or replace function shelfmark.new_code()
returns text
language plpgsql
set search_path = ''
as $$
declare
    alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    bytes bytea;
    result text;
    i int;
begin
    loop
        bytes := uuid_send(gen_random_uuid());
        result := '';
        -- These ten bytes of a random UUID are random in every bit.
        foreach i in array array[0, 1, 2, 3, 4, 5, 7, 9, 10, 11] loop
            result := result || substr(alphabet, (get_byte(bytes, i) % 32) + 1, 1);
        end loop;
        exit when not exists (select 1 from shelfmark.profiles where code = result);
    end loop;
    return result;
end
$$;

-- Stops the call unless id and secret belong together. Notes that the profile was seen.
create or replace function shelfmark.check_caller(p_id uuid, p_secret text)
returns void
language plpgsql
set search_path = ''
as $$
begin
    update shelfmark.profiles
    set seen_at = now()
    where id = p_id and secret_hash = shelfmark.hash_secret(p_secret);
    if not found then
        raise exception 'shelfmark:forbidden';
    end if;
end
$$;

create or replace function shelfmark.millis(p_time timestamptz)
returns bigint
language sql
immutable
set search_path = ''
as $$
    select floor(extract(epoch from p_time) * 1000)::bigint;
$$;

-- ---------------------------------------------------------------------------------
-- What the app calls
-- ---------------------------------------------------------------------------------

-- The daily check. Needs no profile and tells nothing about anyone.
create or replace function public.shelfmark_ping()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
    update shelfmark.heartbeat set pinged_at = now(), pings = pings + 1 where id = 1;
    -- Housekeeping on the way: messages nobody fetched in three months.
    delete from shelfmark.messages where created_at < now() - interval '90 days';
    return jsonb_build_object('ok', true, 'schema', 1, 'time', shelfmark.millis(now()));
end
$$;

-- Creates the profile, or updates the name of an existing one.
create or replace function public.shelfmark_register(p_id uuid, p_secret text, p_name text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    existing shelfmark.profiles%rowtype;
begin
    if p_id is null or p_secret is null or length(p_secret) < 32 then
        raise exception 'shelfmark:bad_request';
    end if;
    select * into existing from shelfmark.profiles where id = p_id;
    if not found then
        -- A free project is small. This keeps a prankster from filling it up.
        if (select count(*) from shelfmark.profiles) >= 5000 then
            raise exception 'shelfmark:full';
        end if;
        insert into shelfmark.profiles (id, secret_hash, name, code)
        values (p_id, shelfmark.hash_secret(p_secret), left(coalesce(p_name, ''), 60), shelfmark.new_code());
    elsif existing.secret_hash <> shelfmark.hash_secret(p_secret) then
        raise exception 'shelfmark:forbidden';
    else
        update shelfmark.profiles set name = left(coalesce(p_name, ''), 60), seen_at = now() where id = p_id;
    end if;
    return (select jsonb_build_object('id', id, 'code', code, 'name', name) from shelfmark.profiles where id = p_id);
end
$$;

-- Replaces the friend code, so the old one stops working for people who still have it.
create or replace function public.shelfmark_new_code(p_id uuid, p_secret text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    fresh text;
begin
    perform shelfmark.check_caller(p_id, p_secret);
    fresh := shelfmark.new_code();
    update shelfmark.profiles set code = fresh where id = p_id;
    return jsonb_build_object('code', fresh);
end
$$;

-- Redeems a friend's code. Both become friends of each other at once.
create or replace function public.shelfmark_add_friend(p_id uuid, p_secret text, p_code text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    friend shelfmark.profiles%rowtype;
begin
    perform shelfmark.check_caller(p_id, p_secret);
    select * into friend
    from shelfmark.profiles
    where code = upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
    if not found then
        raise exception 'shelfmark:unknown_code';
    end if;
    if friend.id = p_id then
        raise exception 'shelfmark:own_code';
    end if;
    if (select count(*) from shelfmark.friendships where user_id = p_id) >= 500 then
        raise exception 'shelfmark:full';
    end if;
    insert into shelfmark.friendships (user_id, friend_id) values (p_id, friend.id), (friend.id, p_id)
    on conflict do nothing;
    return jsonb_build_object('id', friend.id, 'name', friend.name);
end
$$;

-- Ends a friendship for both sides and drops what was still on its way between them.
create or replace function public.shelfmark_remove_friend(p_id uuid, p_secret text, p_friend uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
    perform shelfmark.check_caller(p_id, p_secret);
    delete from shelfmark.friendships
    where (user_id = p_id and friend_id = p_friend) or (user_id = p_friend and friend_id = p_id);
    delete from shelfmark.messages
    where (to_id = p_id and from_id = p_friend) or (to_id = p_friend and from_id = p_id);
    return jsonb_build_object('ok', true);
end
$$;

-- Stores the snapshot of the caller's library that friends may see.
create or replace function public.shelfmark_publish(p_id uuid, p_secret text, p_library jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    stamp timestamptz := now();
begin
    perform shelfmark.check_caller(p_id, p_secret);
    if p_library is null or jsonb_typeof(p_library) <> 'object' then
        raise exception 'shelfmark:bad_request';
    end if;
    if octet_length(p_library::text) > 4000000 then
        raise exception 'shelfmark:too_large';
    end if;
    insert into shelfmark.libraries (owner_id, payload, updated_at) values (p_id, p_library, stamp)
    on conflict (owner_id) do update set payload = excluded.payload, updated_at = excluded.updated_at;
    return jsonb_build_object('at', shelfmark.millis(stamp));
end
$$;

-- Leaves a message (a borrow request or its answer) for a friend.
create or replace function public.shelfmark_send(p_id uuid, p_secret text, p_to uuid, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    fresh uuid;
begin
    perform shelfmark.check_caller(p_id, p_secret);
    if not exists (select 1 from shelfmark.friendships where user_id = p_id and friend_id = p_to) then
        raise exception 'shelfmark:not_friends';
    end if;
    if p_payload is null or octet_length(p_payload::text) > 64000 then
        raise exception 'shelfmark:too_large';
    end if;
    if (select count(*) from shelfmark.messages where to_id = p_to and from_id = p_id) >= 200 then
        raise exception 'shelfmark:full';
    end if;
    insert into shelfmark.messages (to_id, from_id, payload) values (p_to, p_id, p_payload) returning id into fresh;
    return jsonb_build_object('id', fresh);
end
$$;

-- Everything a phone needs in one call: who my friends are, the libraries that changed
-- since the versions I already have (p_known maps friend id to a timestamp), and the
-- messages waiting for me. Messages named in p_ack were handled and are deleted.
create or replace function public.shelfmark_sync(p_id uuid, p_secret text, p_known jsonb default '{}'::jsonb, p_ack uuid[] default '{}'::uuid[])
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    me shelfmark.profiles%rowtype;
    known jsonb := coalesce(p_known, '{}'::jsonb);
begin
    perform shelfmark.check_caller(p_id, p_secret);
    if p_ack is not null and array_length(p_ack, 1) > 0 then
        delete from shelfmark.messages where to_id = p_id and id = any (p_ack);
    end if;
    select * into me from shelfmark.profiles where id = p_id;
    return jsonb_build_object(
        'code', me.code,
        'name', me.name,
        'time', shelfmark.millis(now()),
        'friends', coalesce((
            select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name) order by p.name, p.id)
            from shelfmark.friendships f
            join shelfmark.profiles p on p.id = f.friend_id
            where f.user_id = p_id
        ), '[]'::jsonb),
        'libraries', coalesce((
            select jsonb_agg(jsonb_build_object('owner', l.owner_id, 'at', shelfmark.millis(l.updated_at), 'payload', l.payload) order by l.owner_id)
            from shelfmark.friendships f
            join shelfmark.libraries l on l.owner_id = f.friend_id
            where f.user_id = p_id
              and shelfmark.millis(l.updated_at) > coalesce((known ->> l.owner_id::text)::bigint, 0)
        ), '[]'::jsonb),
        'messages', coalesce((
            select jsonb_agg(jsonb_build_object('id', m.id, 'from', m.from_id, 'at', shelfmark.millis(m.created_at), 'payload', m.payload) order by m.created_at, m.id)
            from shelfmark.messages m
            where m.to_id = p_id
        ), '[]'::jsonb)
    );
end
$$;

-- Removes the caller and everything of theirs from the server.
create or replace function public.shelfmark_delete_account(p_id uuid, p_secret text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
    perform shelfmark.check_caller(p_id, p_secret);
    delete from shelfmark.profiles where id = p_id;
    return jsonb_build_object('ok', true);
end
$$;

-- ---------------------------------------------------------------------------------
-- Who may call what
-- ---------------------------------------------------------------------------------

do $$
declare
    fn text;
begin
    for fn in
        select p.oid::regprocedure::text
        from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname like 'shelfmark\_%'
    loop
        execute format('revoke all on function %s from public', fn);
        if exists (select 1 from pg_roles where rolname = 'anon') then
            execute format('grant execute on function %s to anon', fn);
        end if;
        if exists (select 1 from pg_roles where rolname = 'authenticated') then
            execute format('grant execute on function %s to authenticated', fn);
        end if;
    end loop;
    for fn in
        select p.oid::regprocedure::text
        from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'shelfmark'
    loop
        execute format('revoke all on function %s from public', fn);
    end loop;
end
$$;

-- An extra heartbeat from inside the database, where the cron extension is available.
-- The apps check in daily on their own, so this is a second line of defence only.
do $$
begin
    create extension if not exists pg_cron;
    perform cron.schedule('shelfmark-heartbeat', '17 3 * * *', 'select public.shelfmark_ping()');
exception
    when others then
        raise notice 'pg_cron is not available here (%). The apps keep the project awake on their own.', sqlerrm;
end
$$;

-- Tells the Data API that there are new functions.
notify pgrst, 'reload schema';
