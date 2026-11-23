-- Shelfmark server, for a Supabase project (the free plan is enough).
--
-- Run this whole file in the SQL editor of the project. Running it again is safe: it
-- only updates the functions and keeps all data.
--
-- Upgrading from the first version of this file (profiles tied to one phone, before
-- there were accounts): this file removes those old profiles. They cannot be turned
-- into accounts, people simply sign in and connect with their friends again.
--
-- How it is built
--   * People sign in with Supabase Auth (e-mail and password). An account is who you are,
--     on the phone and on the website alike.
--   * All data lives in the schema "shelfmark", which the Data API does not expose.
--     Row level security is switched on and has no policies, so even a mistake in the
--     API settings does not open the tables.
--   * The apps only call the functions named public.shelfmark_*. Each one works for the
--     signed-in caller and for nobody else. There is no way to name another user.
--   * Per account the server keeps: the whole library, so that phone and website show the
--     same shelf (the "vault"), the part of it the person chose to share with friends,
--     and borrow requests on their way to a friend.

create schema if not exists shelfmark;

-- ---------------------------------------------------------------------------------
-- Leaving the first version behind
-- ---------------------------------------------------------------------------------

do $$
begin
    if exists (
        select 1 from information_schema.columns
        where table_schema = 'shelfmark' and table_name = 'profiles' and column_name = 'secret_hash'
    ) then
        drop table if exists shelfmark.messages, shelfmark.libraries, shelfmark.friendships, shelfmark.profiles cascade;
    end if;
end
$$;

drop function if exists public.shelfmark_register(uuid, text, text);
drop function if exists public.shelfmark_new_code(uuid, text);
drop function if exists public.shelfmark_add_friend(uuid, text, text);
drop function if exists public.shelfmark_remove_friend(uuid, text, uuid);
drop function if exists public.shelfmark_publish(uuid, text, jsonb);
drop function if exists public.shelfmark_send(uuid, text, uuid, jsonb);
drop function if exists public.shelfmark_sync(uuid, text, jsonb, uuid[]);
drop function if exists public.shelfmark_delete_account(uuid, text);
drop function if exists shelfmark.check_caller(uuid, text);
drop function if exists shelfmark.hash_secret(text);

-- ---------------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------------

-- What friends see of an account: a name and the code to connect with.
create table if not exists shelfmark.profiles (
    id uuid primary key references auth.users (id) on delete cascade,
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

-- The snapshot of a library that its owner shares with friends.
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

-- The whole library of an account, as one document. Only its owner ever sees it.
-- The revision goes up by one with every save, which is how a phone notices that the
-- website changed something in the meantime, and the other way round.
create table if not exists shelfmark.vaults (
    owner_id uuid primary key references auth.users (id) on delete cascade,
    payload jsonb not null,
    revision bigint not null default 1,
    updated_at timestamptz not null default now()
);

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
alter table shelfmark.vaults enable row level security;
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

-- Who is calling. Stops the call when nobody is signed in. Makes sure the caller has a
-- profile (it is created the first time it is needed) and notes that they were seen.
create or replace function shelfmark.me()
returns uuid
language plpgsql
set search_path = ''
as $$
declare
    caller uuid := auth.uid();
begin
    if caller is null then
        raise exception 'shelfmark:signed_out';
    end if;
    update shelfmark.profiles set seen_at = now() where id = caller;
    if not found then
        insert into shelfmark.profiles (id, code) values (caller, shelfmark.new_code())
        on conflict (id) do nothing;
    end if;
    return caller;
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
-- What the apps call
-- ---------------------------------------------------------------------------------

-- The daily check. Needs no account and tells nothing about anyone.
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
    return jsonb_build_object('ok', true, 'schema', 2, 'time', shelfmark.millis(now()));
end
$$;

-- Says hello after signing in: returns the caller's profile, and sets the name when one is given.
create or replace function public.shelfmark_hello(p_name text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    me uuid := shelfmark.me();
begin
    if p_name is not null then
        update shelfmark.profiles set name = left(p_name, 60) where id = me;
    end if;
    return (select jsonb_build_object('id', id, 'code', code, 'name', name) from shelfmark.profiles where id = me);
end
$$;

-- Replaces the friend code, so the old one stops working for people who still have it.
create or replace function public.shelfmark_new_code()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    me uuid := shelfmark.me();
    fresh text := shelfmark.new_code();
begin
    update shelfmark.profiles set code = fresh where id = me;
    return jsonb_build_object('code', fresh);
end
$$;

-- Redeems a friend's code. Both become friends of each other at once.
create or replace function public.shelfmark_add_friend(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    me uuid := shelfmark.me();
    friend shelfmark.profiles%rowtype;
begin
    select * into friend
    from shelfmark.profiles
    where code = upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
    if not found then
        raise exception 'shelfmark:unknown_code';
    end if;
    if friend.id = me then
        raise exception 'shelfmark:own_code';
    end if;
    if (select count(*) from shelfmark.friendships where user_id = me) >= 500 then
        raise exception 'shelfmark:full';
    end if;
    insert into shelfmark.friendships (user_id, friend_id) values (me, friend.id), (friend.id, me)
    on conflict do nothing;
    return jsonb_build_object('id', friend.id, 'name', friend.name);
end
$$;

-- Ends a friendship for both sides and drops what was still on its way between them.
create or replace function public.shelfmark_remove_friend(p_friend uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    me uuid := shelfmark.me();
begin
    delete from shelfmark.friendships
    where (user_id = me and friend_id = p_friend) or (user_id = p_friend and friend_id = me);
    delete from shelfmark.messages
    where (to_id = me and from_id = p_friend) or (to_id = p_friend and from_id = me);
    return jsonb_build_object('ok', true);
end
$$;

-- Stores the snapshot of the caller's library that friends may see.
create or replace function public.shelfmark_publish(p_library jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    me uuid := shelfmark.me();
    stamp timestamptz := now();
begin
    if p_library is null or jsonb_typeof(p_library) <> 'object' then
        raise exception 'shelfmark:bad_request';
    end if;
    if octet_length(p_library::text) > 4000000 then
        raise exception 'shelfmark:too_large';
    end if;
    insert into shelfmark.libraries (owner_id, payload, updated_at) values (me, p_library, stamp)
    on conflict (owner_id) do update set payload = excluded.payload, updated_at = excluded.updated_at;
    return jsonb_build_object('at', shelfmark.millis(stamp));
end
$$;

-- Leaves a message (a borrow request or its answer) for a friend.
create or replace function public.shelfmark_send(p_to uuid, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    me uuid := shelfmark.me();
    fresh uuid;
begin
    if not exists (select 1 from shelfmark.friendships where user_id = me and friend_id = p_to) then
        raise exception 'shelfmark:not_friends';
    end if;
    if p_payload is null or octet_length(p_payload::text) > 64000 then
        raise exception 'shelfmark:too_large';
    end if;
    if (select count(*) from shelfmark.messages where to_id = p_to and from_id = me) >= 200 then
        raise exception 'shelfmark:full';
    end if;
    insert into shelfmark.messages (to_id, from_id, payload) values (p_to, me, p_payload) returning id into fresh;
    return jsonb_build_object('id', fresh);
end
$$;

-- Everything about friends in one call: who they are, their libraries that changed since
-- the versions the caller already has (p_known maps friend id to a timestamp), and the
-- messages waiting. Messages named in p_ack were handled and are deleted.
create or replace function public.shelfmark_sync(p_known jsonb default '{}'::jsonb, p_ack uuid[] default '{}'::uuid[])
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    me uuid := shelfmark.me();
    mine shelfmark.profiles%rowtype;
    known jsonb := coalesce(p_known, '{}'::jsonb);
begin
    if p_ack is not null and array_length(p_ack, 1) > 0 then
        delete from shelfmark.messages where to_id = me and id = any (p_ack);
    end if;
    select * into mine from shelfmark.profiles where id = me;
    return jsonb_build_object(
        'id', me,
        'code', mine.code,
        'name', mine.name,
        'time', shelfmark.millis(now()),
        'friends', coalesce((
            select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name) order by p.name, p.id)
            from shelfmark.friendships f
            join shelfmark.profiles p on p.id = f.friend_id
            where f.user_id = me
        ), '[]'::jsonb),
        'libraries', coalesce((
            select jsonb_agg(jsonb_build_object('owner', l.owner_id, 'at', shelfmark.millis(l.updated_at), 'payload', l.payload) order by l.owner_id)
            from shelfmark.friendships f
            join shelfmark.libraries l on l.owner_id = f.friend_id
            where f.user_id = me
              and shelfmark.millis(l.updated_at) > coalesce((known ->> l.owner_id::text)::bigint, 0)
        ), '[]'::jsonb),
        'messages', coalesce((
            select jsonb_agg(jsonb_build_object('id', m.id, 'from', m.from_id, 'at', shelfmark.millis(m.created_at), 'payload', m.payload) order by m.created_at, m.id)
            from shelfmark.messages m
            where m.to_id = me
        ), '[]'::jsonb)
    );
end
$$;

-- Fetches the caller's whole library. The payload is left out when the caller already
-- has this revision (p_known), which makes "anything new?" a cheap question.
-- An account that never saved anything has revision 0 and no payload.
create or replace function public.shelfmark_vault_pull(p_known bigint default 0)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    me uuid := shelfmark.me();
    vault shelfmark.vaults%rowtype;
begin
    select * into vault from shelfmark.vaults where owner_id = me;
    if not found then
        return jsonb_build_object('revision', 0, 'at', 0, 'payload', null);
    end if;
    return jsonb_build_object(
        'revision', vault.revision,
        'at', shelfmark.millis(vault.updated_at),
        'payload', case when vault.revision = coalesce(p_known, 0) then null else vault.payload end
    );
end
$$;

-- Saves the caller's whole library. p_expected is the revision the caller started from:
-- if somebody else (the website, another phone) saved in the meantime, nothing is
-- written and the caller is told so with 'shelfmark:conflict', to fetch, merge and try
-- again. Passing null saves no matter what.
create or replace function public.shelfmark_vault_push(p_payload jsonb, p_expected bigint default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    me uuid := shelfmark.me();
    current_revision bigint;
    stamp timestamptz := now();
begin
    if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
        raise exception 'shelfmark:bad_request';
    end if;
    if octet_length(p_payload::text) > 12000000 then
        raise exception 'shelfmark:too_large';
    end if;
    -- The row is locked until this save is done, so two saves cannot both think they were first.
    select revision into current_revision from shelfmark.vaults where owner_id = me for update;
    if not found then
        if p_expected is not null and p_expected <> 0 then
            raise exception 'shelfmark:conflict';
        end if;
        insert into shelfmark.vaults (owner_id, payload, revision, updated_at) values (me, p_payload, 1, stamp)
        on conflict (owner_id) do nothing;
        if not found then
            raise exception 'shelfmark:conflict';
        end if;
        return jsonb_build_object('revision', 1, 'at', shelfmark.millis(stamp));
    end if;
    if p_expected is not null and p_expected <> current_revision then
        raise exception 'shelfmark:conflict';
    end if;
    update shelfmark.vaults set payload = p_payload, revision = current_revision + 1, updated_at = stamp where owner_id = me;
    return jsonb_build_object('revision', current_revision + 1, 'at', shelfmark.millis(stamp));
end
$$;

-- Deletes the caller's account and everything that belongs to it: library, shared
-- snapshot, friendships, messages, and the sign-in itself.
create or replace function public.shelfmark_delete_account()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    caller uuid := auth.uid();
begin
    if caller is null then
        raise exception 'shelfmark:signed_out';
    end if;
    delete from shelfmark.vaults where owner_id = caller;
    delete from shelfmark.profiles where id = caller;
    -- The sign-in itself. Should the project not allow this function to touch it, the
    -- data is gone all the same, and the empty sign-in can be removed in the dashboard.
    begin
        delete from auth.users where id = caller;
    exception
        when insufficient_privilege then
            return jsonb_build_object('ok', true, 'login_kept', true);
    end;
    return jsonb_build_object('ok', true, 'login_kept', false);
end
$$;

-- ---------------------------------------------------------------------------------
-- Cover photos
-- ---------------------------------------------------------------------------------

-- A cover somebody photographed has to be a picture with an address, so that the website,
-- another phone and friends can show it. The pictures go into a bucket of Supabase
-- Storage. Everybody may write below a folder named after their own user id and nowhere
-- else. Reading needs no sign-in, but it needs the full address, which nobody can guess.
do $$
begin
    -- A plain PostgreSQL used for development has no storage, and nothing to set up.
    if exists (select 1 from pg_namespace where nspname = 'storage') then
        insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
        values ('shelfmark-covers', 'shelfmark-covers', true, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
        on conflict (id) do update
            set public = true, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

        drop policy if exists "Shelfmark covers: see my own" on storage.objects;
        create policy "Shelfmark covers: see my own" on storage.objects for select to authenticated
            using (bucket_id = 'shelfmark-covers' and (storage.foldername(name))[1] = auth.uid()::text);

        drop policy if exists "Shelfmark covers: add my own" on storage.objects;
        create policy "Shelfmark covers: add my own" on storage.objects for insert to authenticated
            with check (bucket_id = 'shelfmark-covers' and (storage.foldername(name))[1] = auth.uid()::text);

        drop policy if exists "Shelfmark covers: replace my own" on storage.objects;
        create policy "Shelfmark covers: replace my own" on storage.objects for update to authenticated
            using (bucket_id = 'shelfmark-covers' and (storage.foldername(name))[1] = auth.uid()::text)
            with check (bucket_id = 'shelfmark-covers' and (storage.foldername(name))[1] = auth.uid()::text);

        drop policy if exists "Shelfmark covers: remove my own" on storage.objects;
        create policy "Shelfmark covers: remove my own" on storage.objects for delete to authenticated
            using (bucket_id = 'shelfmark-covers' and (storage.foldername(name))[1] = auth.uid()::text);
    end if;
end
$$;

-- ---------------------------------------------------------------------------------
-- Who may call what
-- ---------------------------------------------------------------------------------

do $$
declare
    fn record;
begin
    for fn in
        select p.oid::regprocedure::text as signature, p.proname as name
        from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname like 'shelfmark\_%'
    loop
        execute format('revoke all on function %s from public', fn.signature);
        if exists (select 1 from pg_roles where rolname = 'anon') then
            execute format('revoke all on function %s from anon', fn.signature);
        end if;
        if exists (select 1 from pg_roles where rolname = 'authenticated') then
            execute format('grant execute on function %s to authenticated', fn.signature);
        end if;
        -- The daily check is the one thing that works without signing in.
        if fn.name = 'shelfmark_ping' and exists (select 1 from pg_roles where rolname = 'anon') then
            execute format('grant execute on function %s to anon', fn.signature);
        end if;
    end loop;
    for fn in
        select p.oid::regprocedure::text as signature, p.proname as name
        from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'shelfmark'
    loop
        execute format('revoke all on function %s from public', fn.signature);
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

-- Tells the Data API that the functions changed.
notify pgrst, 'reload schema';
