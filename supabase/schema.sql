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
--     and the loans between friends: one record per loan that both sides read, so that
--     lender and borrower always see the same state of it. And up to ten earlier versions
--     of the library, which only the owner can list and bring back.

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

-- The second version passed borrow requests as messages, one private note on each side.
-- Loans replaced them. A request that was still on its way is dropped with the mailbox.
drop table if exists shelfmark.messages;

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
-- On the row of the one whose code was typed in: the friend came by that code. That is
-- what every device of the code's owner is told as news, and what the one who typed it
-- already knows.
alter table shelfmark.friendships add column if not exists joined boolean not null default false;


-- The snapshot of a library that its owner shares with friends.
create table if not exists shelfmark.libraries (
    owner_id uuid primary key references shelfmark.profiles (id) on delete cascade,
    payload jsonb not null,
    updated_at timestamptz not null default now()
);

-- A loan of one book between two friends, from the first question to the day the book is
-- back. One row that both of them read, changed only through shelfmark_loan_act, which
-- knows who may do what and when:
--
--   asked       the borrower asked
--   agreed      the lender said yes: the book is reserved
--   handed      the lender says the book was handed over
--   on_loan     the borrower confirmed having it
--   given_back  the borrower says the book was given back
--   returned    the lender confirmed having it back          (the end)
--   declined    the lender said no                           (the end)
--   withdrawn   the borrower took the question back          (the end)
--   cancelled   the lender took the yes back                 (the end)
create table if not exists shelfmark.loans (
    id uuid primary key default gen_random_uuid(),
    lender_id uuid not null references shelfmark.profiles (id) on delete cascade,
    borrower_id uuid not null references shelfmark.profiles (id) on delete cascade,
    -- The id of the book in the lender's own library.
    book_id bigint not null,
    -- What the borrower saw when asking: title, authors, isbn, coverUrl, pageCount, format.
    book jsonb not null default '{}'::jsonb,
    note text not null default '',
    state text not null default 'asked'
        check (state in ('asked', 'agreed', 'handed', 'on_loan', 'given_back', 'returned', 'declined', 'withdrawn', 'cancelled')),
    -- Why it was declined or cancelled, in the lender's words. 'taken' when somebody else got the book.
    reason text not null default '',
    -- Back by this day, counted in days since 1 January 1970. Null: no fixed day.
    due_on bigint,
    -- Moments, in milliseconds since 1970 like everywhere else.
    asked_at bigint not null,
    agreed_at bigint,
    handed_at bigint,
    received_at bigint,
    given_back_at bigint,
    closed_at bigint,
    updated_at bigint not null,
    updated_by uuid,
    -- A loan that is over can be put away by each side for itself.
    hidden_by_lender boolean not null default false,
    hidden_by_borrower boolean not null default false
);

create index if not exists loans_lender on shelfmark.loans (lender_id, book_id);
create index if not exists loans_borrower on shelfmark.loans (borrower_id);

-- The whole library of an account, as one document. Only its owner ever sees it.
-- The revision goes up by one with every save, which is how a phone notices that the
-- website changed something in the meantime, and the other way round.
create table if not exists shelfmark.vaults (
    owner_id uuid primary key references auth.users (id) on delete cascade,
    payload jsonb not null,
    revision bigint not null default 1,
    updated_at timestamptz not null default now()
);

-- Earlier versions of a library, as a net under everything that could ever go wrong with
-- keeping one library in step on several devices. A save puts the version it replaces
-- here, unless one was put here within the last hour. Kept are the five newest, and
-- beyond those the last one of each of the five most recent days that have any: ten at
-- most, reaching back hours and days. Only the owner can list them and bring one back.
create table if not exists shelfmark.vault_history (
    owner_id uuid not null references auth.users (id) on delete cascade,
    revision bigint not null,
    payload jsonb not null,
    -- When this version was saved, not when it was replaced.
    saved_at timestamptz not null,
    primary key (owner_id, revision)
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
alter table shelfmark.loans enable row level security;
alter table shelfmark.vaults enable row level security;
alter table shelfmark.vault_history enable row level security;
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
    -- Housekeeping on the way: loans that are over and that both sides have put away.
    delete from shelfmark.loans where hidden_by_lender and hidden_by_borrower;
    return jsonb_build_object('ok', true, 'schema', 4, 'time', shelfmark.millis(now()));
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
    insert into shelfmark.friendships (user_id, friend_id, joined) values (me, friend.id, false), (friend.id, me, true)
    on conflict do nothing;
    return jsonb_build_object('id', friend.id, 'name', friend.name);
end
$$;

-- Ends a friendship for both sides. Questions nobody answered yet end with it. A book that
-- is reserved or on loan stays a loan: it is still in somebody else's hands.
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
    -- Whoever ends the friendship ends the open questions with it: their own are taken back,
    -- the friend's are answered with a no.
    update shelfmark.loans
    set state = case when borrower_id = me then 'withdrawn' else 'declined' end,
        closed_at = shelfmark.millis(now()), updated_at = shelfmark.millis(now()), updated_by = me
    where state = 'asked'
      and ((lender_id = me and borrower_id = p_friend) or (lender_id = p_friend and borrower_id = me));
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

-- Borrow requests used to travel as messages. They are loans now (see below). The
-- function stays so that a version of the app from before says why nothing happens,
-- instead of leaving a request that nobody will ever read.
create or replace function public.shelfmark_send(p_to uuid, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
    perform shelfmark.me();
    raise exception 'shelfmark:outdated';
end
$$;

-- A loan as one of its two sides sees it.
create or replace function shelfmark.loan_json(p_loan shelfmark.loans, p_me uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
    select jsonb_build_object(
        'id', p_loan.id,
        'role', case when p_loan.lender_id = p_me then 'lender' else 'borrower' end,
        'peer', case when p_loan.lender_id = p_me then p_loan.borrower_id else p_loan.lender_id end,
        'peerName', coalesce((
            select name from shelfmark.profiles
            where id = case when p_loan.lender_id = p_me then p_loan.borrower_id else p_loan.lender_id end
        ), ''),
        'bookId', p_loan.book_id,
        'book', p_loan.book,
        'note', p_loan.note,
        'state', p_loan.state,
        'reason', p_loan.reason,
        'dueOn', p_loan.due_on,
        'askedAt', p_loan.asked_at,
        'agreedAt', p_loan.agreed_at,
        'handedAt', p_loan.handed_at,
        'receivedAt', p_loan.received_at,
        'givenBackAt', p_loan.given_back_at,
        'closedAt', p_loan.closed_at,
        'updatedAt', p_loan.updated_at,
        -- Whether the last step was the caller's own. News is what the other side did.
        'byMe', p_loan.updated_by is not distinct from p_me
    )
$$;

-- Asks a friend for a book. p_book is the id of the book in the friend's library, p_info
-- what the asker sees of it (title, authors, isbn, coverUrl, pageCount, format).
-- Asking twice for the same book gives back the question that is still open.
create or replace function public.shelfmark_loan_ask(p_friend uuid, p_book bigint, p_info jsonb default '{}'::jsonb, p_note text default '')
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    me uuid := shelfmark.me();
    info jsonb := coalesce(p_info, '{}'::jsonb);
    pages int;
    loan shelfmark.loans;
    moment bigint := shelfmark.millis(now());
begin
    if p_friend is null or p_book is null or p_friend = me then
        raise exception 'shelfmark:invalid';
    end if;
    if not exists (select 1 from shelfmark.friendships where user_id = me and friend_id = p_friend) then
        raise exception 'shelfmark:not_friends';
    end if;
    if btrim(coalesce(info ->> 'title', '')) = '' then
        raise exception 'shelfmark:invalid';
    end if;
    select * into loan from shelfmark.loans
    where lender_id = p_friend and borrower_id = me and book_id = p_book
      and state in ('asked', 'agreed', 'handed', 'on_loan', 'given_back')
    limit 1;
    if found then
        return shelfmark.loan_json(loan, me);
    end if;
    -- Reserved for somebody, or in somebody's hands.
    if exists (
        select 1 from shelfmark.loans
        where lender_id = p_friend and book_id = p_book and state in ('agreed', 'handed', 'on_loan', 'given_back')
    ) then
        raise exception 'shelfmark:taken';
    end if;
    if (select count(*) from shelfmark.loans where borrower_id = me and state = 'asked') >= 50 then
        raise exception 'shelfmark:full';
    end if;
    begin
        pages := greatest(0, least(100000, (info ->> 'pageCount')::int));
    exception when others then
        pages := 0;
    end;
    insert into shelfmark.loans (lender_id, borrower_id, book_id, book, note, asked_at, updated_at, updated_by)
    values (
        p_friend, me, p_book,
        -- Only what is known to be there, and no longer than a book needs.
        jsonb_build_object(
            'title', left(btrim(info ->> 'title'), 300),
            'authors', left(coalesce(info ->> 'authors', ''), 300),
            'isbn', left(coalesce(info ->> 'isbn', ''), 20),
            'coverUrl', left(coalesce(info ->> 'coverUrl', ''), 600),
            'pageCount', coalesce(pages, 0),
            'format', left(coalesce(info ->> 'format', 'UNKNOWN'), 20)
        ),
        left(btrim(coalesce(p_note, '')), 300), moment, moment, me
    )
    returning * into loan;
    return shelfmark.loan_json(loan, me);
end
$$;

-- One step in the life of a loan. Who may take which step, and from where:
--
--   the lender     agree        asked -> agreed        p_due: back by this day, null for no fixed day
--                  decline      asked -> declined      p_reason: why, optional
--                  cancel       agreed, handed -> cancelled
--                  hand         agreed -> handed       "I handed it over"
--                  undo_hand    handed -> agreed
--                  take_back    given_back -> returned "I have it back"
--                  not_returned given_back -> on_loan  "I did not get it back"
--                  close        on_loan -> returned    the book is back and the borrower never said so
--                  set_due      agreed, handed, on_loan, given_back: another day, or none
--   the borrower   withdraw     asked, agreed -> withdrawn
--                  receive      handed -> on_loan      "I have it"
--                  not_received handed -> agreed       "I did not get it"
--                  give_back    on_loan -> given_back  "I gave it back"
--                  undo_give_back given_back -> on_loan
--   either         hide         a loan that is over, put away for the caller only
--
-- Handing over takes the lender first and then the borrower, giving back the borrower
-- first and then the lender. Anything else is refused with shelfmark:not_allowed.
create or replace function public.shelfmark_loan_act(p_loan uuid, p_action text, p_due bigint default null, p_reason text default '')
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    me uuid := shelfmark.me();
    loan shelfmark.loans;
    lender boolean;
    moment bigint := shelfmark.millis(now());
    over constant text[] := array['returned', 'declined', 'withdrawn', 'cancelled'];
begin
    select * into loan from shelfmark.loans
    where id = p_loan and (lender_id = me or borrower_id = me)
    for update;
    if not found then
        raise exception 'shelfmark:unknown_loan';
    end if;
    lender := loan.lender_id = me;
    if p_due is not null and (p_due < 0 or p_due > 100000) then
        raise exception 'shelfmark:invalid';
    end if;

    if p_action = 'hide' and loan.state = any (over) then
        if lender then
            update shelfmark.loans set hidden_by_lender = true where id = loan.id returning * into loan;
        else
            update shelfmark.loans set hidden_by_borrower = true where id = loan.id returning * into loan;
        end if;
        return shelfmark.loan_json(loan, me);
    end if;

    if lender and p_action = 'agree' and loan.state = 'asked' then
        -- A book can be promised to one person at a time.
        if exists (
            select 1 from shelfmark.loans
            where lender_id = me and book_id = loan.book_id and id <> loan.id
              and state in ('agreed', 'handed', 'on_loan', 'given_back')
        ) then
            raise exception 'shelfmark:taken';
        end if;
        update shelfmark.loans set state = 'agreed', agreed_at = moment, due_on = p_due where id = loan.id;
        -- Whoever else asked for it is told that it went to somebody else.
        update shelfmark.loans
        set state = 'declined', reason = 'taken', closed_at = moment, updated_at = moment, updated_by = me
        where lender_id = me and book_id = loan.book_id and id <> loan.id and state = 'asked';
    elsif lender and p_action = 'decline' and loan.state = 'asked' then
        update shelfmark.loans set state = 'declined', reason = left(btrim(coalesce(p_reason, '')), 200), closed_at = moment where id = loan.id;
    elsif lender and p_action = 'cancel' and loan.state in ('agreed', 'handed') then
        update shelfmark.loans set state = 'cancelled', reason = left(btrim(coalesce(p_reason, '')), 200), closed_at = moment where id = loan.id;
    elsif lender and p_action = 'hand' and loan.state = 'agreed' then
        update shelfmark.loans set state = 'handed', handed_at = moment where id = loan.id;
    elsif lender and p_action = 'undo_hand' and loan.state = 'handed' then
        update shelfmark.loans set state = 'agreed', handed_at = null where id = loan.id;
    elsif lender and p_action = 'take_back' and loan.state = 'given_back' then
        update shelfmark.loans set state = 'returned', closed_at = moment where id = loan.id;
    elsif lender and p_action = 'not_returned' and loan.state = 'given_back' then
        update shelfmark.loans set state = 'on_loan', given_back_at = null where id = loan.id;
    elsif lender and p_action = 'close' and loan.state = 'on_loan' then
        update shelfmark.loans set state = 'returned', closed_at = moment where id = loan.id;
    elsif lender and p_action = 'set_due' and loan.state in ('agreed', 'handed', 'on_loan', 'given_back') then
        update shelfmark.loans set due_on = p_due where id = loan.id;
    elsif not lender and p_action = 'withdraw' and loan.state in ('asked', 'agreed') then
        update shelfmark.loans set state = 'withdrawn', closed_at = moment where id = loan.id;
    elsif not lender and p_action = 'receive' and loan.state = 'handed' then
        update shelfmark.loans set state = 'on_loan', received_at = moment where id = loan.id;
    elsif not lender and p_action = 'not_received' and loan.state = 'handed' then
        update shelfmark.loans set state = 'agreed', handed_at = null where id = loan.id;
    elsif not lender and p_action = 'give_back' and loan.state = 'on_loan' then
        update shelfmark.loans set state = 'given_back', given_back_at = moment where id = loan.id;
    elsif not lender and p_action = 'undo_give_back' and loan.state = 'given_back' then
        update shelfmark.loans set state = 'on_loan', given_back_at = null where id = loan.id;
    else
        raise exception 'shelfmark:not_allowed';
    end if;

    update shelfmark.loans set updated_at = moment, updated_by = me where id = loan.id returning * into loan;
    return shelfmark.loan_json(loan, me);
end
$$;

-- Everything about friends in one call: who they are, their libraries that changed since
-- the versions the caller already has (p_known maps friend id to a timestamp), and every
-- loan the caller is part of and has not put away. p_ack and "messages" are leftovers of
-- the mailbox: the first is ignored, the second is always empty.
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
    select * into mine from shelfmark.profiles where id = me;
    return jsonb_build_object(
        'id', me,
        'code', mine.code,
        'name', mine.name,
        'time', shelfmark.millis(now()),
        'friends', coalesce((
            select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'joined', f.joined, 'since', shelfmark.millis(f.created_at)) order by p.name, p.id)
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
        'loans', coalesce((
            select jsonb_agg(shelfmark.loan_json(l, me) order by l.asked_at desc, l.id)
            from shelfmark.loans l
            where (l.lender_id = me and not l.hidden_by_lender) or (l.borrower_id = me and not l.hidden_by_borrower)
        ), '[]'::jsonb),
        'messages', '[]'::jsonb
    );
end
$$;

-- Puts the library as it is now among the earlier versions, before something replaces it.
-- Not more often than once an hour unless p_always, and then tidies up: the five newest
-- stay, and of the older ones the last of each of the five most recent days.
create or replace function shelfmark.keep_version(p_owner uuid, p_always boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
    if not p_always and exists (
        select 1 from shelfmark.vault_history
        where owner_id = p_owner and saved_at > now() - interval '1 hour'
    ) then
        return;
    end if;
    insert into shelfmark.vault_history (owner_id, revision, payload, saved_at)
    select owner_id, revision, payload, updated_at from shelfmark.vaults where owner_id = p_owner
    on conflict (owner_id, revision) do nothing;
    delete from shelfmark.vault_history h
    where h.owner_id = p_owner
      and h.revision not in (
          select revision from shelfmark.vault_history
          where owner_id = p_owner order by saved_at desc, revision desc limit 5
      )
      and h.revision not in (
          select distinct on ((saved_at at time zone 'UTC')::date) revision
          from shelfmark.vault_history
          where owner_id = p_owner
            and (saved_at at time zone 'UTC')::date in (
                select distinct (saved_at at time zone 'UTC')::date from shelfmark.vault_history
                where owner_id = p_owner order by 1 desc limit 5
            )
          order by (saved_at at time zone 'UTC')::date, saved_at desc, revision desc
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
    perform shelfmark.keep_version(me, false);
    update shelfmark.vaults set payload = p_payload, revision = current_revision + 1, updated_at = stamp where owner_id = me;
    return jsonb_build_object('revision', current_revision + 1, 'at', shelfmark.millis(stamp));
end
$$;

-- The earlier versions of the caller's library, the newest first: which revision, when it
-- was saved and how many books it holds. The documents themselves are not handed out here.
create or replace function public.shelfmark_vault_history()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    me uuid := shelfmark.me();
begin
    return jsonb_build_object('versions', coalesce((
        select jsonb_agg(jsonb_build_object(
            'revision', h.revision,
            'at', shelfmark.millis(h.saved_at),
            'books', case when jsonb_typeof(h.payload -> 'books') = 'array' then jsonb_array_length(h.payload -> 'books') else 0 end
        ) order by h.revision desc)
        from shelfmark.vault_history h
        where h.owner_id = me
    ), '[]'::jsonb));
end
$$;

-- Makes an earlier version the library again. It becomes a new revision, so every device
-- takes it over like any other change, and the version it replaces is kept in turn:
-- bringing something back can itself be taken back.
create or replace function public.shelfmark_vault_restore(p_revision bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    me uuid := shelfmark.me();
    earlier jsonb;
    current_revision bigint;
    stamp timestamptz := now();
begin
    select revision into current_revision from shelfmark.vaults where owner_id = me for update;
    if not found then
        raise exception 'shelfmark:unknown_version';
    end if;
    select payload into earlier from shelfmark.vault_history where owner_id = me and revision = p_revision;
    if not found then
        raise exception 'shelfmark:unknown_version';
    end if;
    perform shelfmark.keep_version(me, true);
    update shelfmark.vaults set payload = earlier, revision = current_revision + 1, updated_at = stamp where owner_id = me;
    return jsonb_build_object('revision', current_revision + 1, 'at', shelfmark.millis(stamp));
end
$$;

-- Deletes the caller's account and everything that belongs to it: library, shared
-- snapshot, friendships, loans, and the sign-in itself.
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
    delete from shelfmark.vault_history where owner_id = caller;
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
