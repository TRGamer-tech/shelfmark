-- Plays the whole story against the functions of schema.sql, as the roles the apps use.
-- Run it against a scratch database, never against the real project:
--   psql -v ON_ERROR_STOP=1 -f supabase/local.sql -f supabase/schema.sql -f supabase/test.sql
-- It ends with "all server checks passed" or stops at the first failed check.

-- Three accounts, as signing up would create them.
insert into auth.users (id, email) values
    ('11111111-1111-4111-8111-111111111111', 'anna@example.org'),
    ('22222222-2222-4222-8222-222222222222', 'ben@example.org'),
    ('33333333-3333-4333-8333-333333333333', 'cleo@example.org')
on conflict (id) do nothing;

-- Signs in as somebody for the rest of the transaction, or as nobody with null.
create or replace function pg_temp.sign_in(p_user uuid) returns void language plpgsql as $$
begin
    perform set_config('request.jwt.claim.sub', coalesce(p_user::text, ''), false);
end
$$;

set role authenticated;

do $$
declare
    anna constant uuid := '11111111-1111-4111-8111-111111111111';
    ben constant uuid := '22222222-2222-4222-8222-222222222222';
    cleo constant uuid := '33333333-3333-4333-8333-333333333333';
    r jsonb;
    anna_code text;
    old_code text;
    message_id uuid;
    failed boolean;
begin
    -- The tables themselves are out of reach.
    failed := false;
    begin
        perform count(*) from shelfmark.profiles;
    exception when insufficient_privilege then
        failed := true;
    end;
    assert failed, 'the tables must not be readable';

    -- Without signing in there is the daily check and nothing else.
    perform pg_temp.sign_in(null);
    r := public.shelfmark_ping();
    assert (r ->> 'ok')::boolean and (r ->> 'schema')::int = 2, 'ping';
    failed := false;
    begin
        perform public.shelfmark_hello('Nobody');
    exception when others then
        failed := sqlerrm = 'shelfmark:signed_out';
    end;
    assert failed, 'hello without signing in';
    failed := false;
    begin
        perform public.shelfmark_vault_pull();
    exception when others then
        failed := sqlerrm = 'shelfmark:signed_out';
    end;
    assert failed, 'vault without signing in';

    -- Saying hello creates the profile with a code, and sets the name.
    perform pg_temp.sign_in(anna);
    r := public.shelfmark_hello('Anna');
    anna_code := r ->> 'code';
    assert anna_code ~ '^[A-HJ-NP-Z2-9]{10}$', 'code format: ' || anna_code;
    assert r ->> 'id' = anna::text and r ->> 'name' = 'Anna', 'hello';
    r := public.shelfmark_hello();
    assert r ->> 'code' = anna_code and r ->> 'name' = 'Anna', 'hello again keeps code and name';
    r := public.shelfmark_hello('Anna B.');
    assert r ->> 'name' = 'Anna B.', 'rename';

    -- The vault: empty at first, then saved and fetched, with a revision that counts up.
    r := public.shelfmark_vault_pull();
    assert (r ->> 'revision')::bigint = 0 and r -> 'payload' = 'null'::jsonb, 'empty vault';
    r := public.shelfmark_vault_push('{"books":[{"id":1,"title":"Emma"}]}', 0);
    assert (r ->> 'revision')::bigint = 1, 'first save';
    r := public.shelfmark_vault_pull(0);
    assert (r ->> 'revision')::bigint = 1 and r -> 'payload' -> 'books' -> 0 ->> 'title' = 'Emma', 'fetch';
    r := public.shelfmark_vault_pull(1);
    assert r -> 'payload' = 'null'::jsonb, 'nothing new is cheap';
    r := public.shelfmark_vault_push('{"books":[{"id":1,"title":"Emma"},{"id":2,"title":"Persuasion"}]}', 1);
    assert (r ->> 'revision')::bigint = 2, 'second save';
    -- Somebody who still thinks it is revision 1 is told that it is not.
    failed := false;
    begin
        perform public.shelfmark_vault_push('{"books":[]}', 1);
    exception when others then
        failed := sqlerrm = 'shelfmark:conflict';
    end;
    assert failed, 'stale save is refused';
    r := public.shelfmark_vault_pull();
    assert jsonb_array_length(r -> 'payload' -> 'books') = 2, 'refused save changed nothing';
    r := public.shelfmark_vault_push('{"books":[{"id":2,"title":"Persuasion"}]}');
    assert (r ->> 'revision')::bigint = 3, 'save without a revision always goes through';
    failed := false;
    begin
        perform public.shelfmark_vault_push('[1,2,3]', 3);
    exception when others then
        failed := sqlerrm = 'shelfmark:bad_request';
    end;
    assert failed, 'a vault is an object';

    -- Ben cannot see Anna's vault. He has his own, and it is empty.
    perform pg_temp.sign_in(ben);
    perform public.shelfmark_hello('Ben');
    r := public.shelfmark_vault_pull();
    assert (r ->> 'revision')::bigint = 0, 'vaults are private';
    failed := false;
    begin
        perform public.shelfmark_vault_push('{"books":[]}', 3);
    exception when others then
        failed := sqlerrm = 'shelfmark:conflict';
    end;
    assert failed, 'expecting a revision that is not there';

    perform pg_temp.sign_in(anna);
    perform public.shelfmark_publish('{"type":"library","library":{"ownerName":"Anna","books":[{"id":1,"title":"Emma"}]}}');
    perform pg_temp.sign_in(ben);
    perform public.shelfmark_publish('{"type":"library","library":{"ownerName":"Ben","books":[]}}');

    -- Nobody sees anything before a code is redeemed.
    r := public.shelfmark_sync();
    assert jsonb_array_length(r -> 'friends') = 0 and jsonb_array_length(r -> 'libraries') = 0, 'no friends yet';
    assert r ->> 'id' = ben::text, 'sync says who I am';

    failed := false;
    begin
        perform public.shelfmark_add_friend('ZZZZZ-ZZZZZ');
    exception when others then
        failed := sqlerrm = 'shelfmark:unknown_code';
    end;
    assert failed, 'unknown code';
    perform pg_temp.sign_in(anna);
    failed := false;
    begin
        perform public.shelfmark_add_friend(anna_code);
    exception when others then
        failed := sqlerrm = 'shelfmark:own_code';
    end;
    assert failed, 'own code';

    -- Ben types Anna's code the way people do: lower case, with a dash and a space.
    perform pg_temp.sign_in(ben);
    r := public.shelfmark_add_friend(lower(substr(anna_code, 1, 5)) || '- ' || substr(anna_code, 6));
    assert r ->> 'id' = anna::text and r ->> 'name' = 'Anna B.', 'add friend';
    perform public.shelfmark_add_friend(anna_code);

    -- Both sides are friends now and see each other's library.
    r := public.shelfmark_sync();
    assert jsonb_array_length(r -> 'friends') = 1 and r -> 'friends' -> 0 ->> 'name' = 'Anna B.', 'ben sees anna';
    assert r -> 'libraries' -> 0 -> 'payload' -> 'library' -> 'books' -> 0 ->> 'title' = 'Emma', 'ben gets the library';
    -- A library the phone already has is not sent again, a newer one is.
    r := public.shelfmark_sync(jsonb_build_object(anna::text, r -> 'libraries' -> 0 -> 'at'));
    assert jsonb_array_length(r -> 'libraries') = 0 and jsonb_array_length(r -> 'friends') = 1, 'known library is skipped';
    perform pg_temp.sign_in(anna);
    r := public.shelfmark_sync();
    assert r -> 'friends' -> 0 ->> 'id' = ben::text and jsonb_array_length(r -> 'libraries') = 1, 'anna sees ben';
    perform pg_sleep(0.01);
    perform public.shelfmark_publish('{"type":"library","library":{"ownerName":"Anna","books":[]}}');
    perform pg_temp.sign_in(ben);
    r := public.shelfmark_sync(jsonb_build_object(anna::text, (r ->> 'time')::bigint - 60000));
    assert jsonb_array_length(r -> 'libraries') = 1, 'changed library is sent';

    -- Cleo is nobody's friend: she sees nothing and cannot write to anyone.
    perform pg_temp.sign_in(cleo);
    r := public.shelfmark_sync();
    assert jsonb_array_length(r -> 'friends') = 0 and jsonb_array_length(r -> 'libraries') = 0, 'stranger sees nothing';
    failed := false;
    begin
        perform public.shelfmark_send(anna, '{"type":"lend_request"}');
    exception when others then
        failed := sqlerrm = 'shelfmark:not_friends';
    end;
    assert failed, 'stranger cannot send';

    -- A borrow request travels from Ben to Anna and is gone once she has it.
    perform pg_temp.sign_in(ben);
    r := public.shelfmark_send(anna, '{"type":"lend_request","request":{"requestId":"r1","bookTitle":"Emma"}}');
    message_id := (r ->> 'id')::uuid;
    -- The sender cannot acknowledge it away.
    perform public.shelfmark_sync('{}', array[message_id]);
    perform pg_temp.sign_in(anna);
    r := public.shelfmark_sync();
    assert jsonb_array_length(r -> 'messages') = 1, 'message arrives, and only the receiver can acknowledge';
    assert r -> 'messages' -> 0 ->> 'from' = ben::text, 'sender is named';
    assert r -> 'messages' -> 0 -> 'payload' -> 'request' ->> 'bookTitle' = 'Emma', 'payload intact';
    r := public.shelfmark_sync('{}', array[message_id]);
    assert jsonb_array_length(r -> 'messages') = 0, 'acknowledged message is deleted';

    perform pg_temp.sign_in(ben);
    failed := false;
    begin
        perform public.shelfmark_send(anna, to_jsonb(repeat('x', 70000)));
    exception when others then
        failed := sqlerrm = 'shelfmark:too_large';
    end;
    assert failed, 'oversized message';

    -- A new code makes the old one useless.
    perform pg_temp.sign_in(anna);
    old_code := anna_code;
    anna_code := public.shelfmark_new_code() ->> 'code';
    assert anna_code <> old_code, 'new code differs';
    perform pg_temp.sign_in(cleo);
    failed := false;
    begin
        perform public.shelfmark_add_friend(old_code);
    exception when others then
        failed := sqlerrm = 'shelfmark:unknown_code';
    end;
    assert failed, 'old code is dead';

    -- Ending a friendship ends it for both and drops what was on its way.
    perform pg_temp.sign_in(anna);
    perform public.shelfmark_send(ben, '{"type":"lend_answer"}');
    perform public.shelfmark_remove_friend(ben);
    perform pg_temp.sign_in(ben);
    r := public.shelfmark_sync();
    assert jsonb_array_length(r -> 'friends') = 0 and jsonb_array_length(r -> 'messages') = 0 and jsonb_array_length(r -> 'libraries') = 0, 'unfriended';

    -- Deleting the account removes every trace, the sign-in included.
    perform pg_temp.sign_in(cleo);
    perform public.shelfmark_add_friend(anna_code);
    perform pg_temp.sign_in(anna);
    r := public.shelfmark_delete_account();
    assert (r ->> 'ok')::boolean, 'delete account';
    perform pg_temp.sign_in(cleo);
    r := public.shelfmark_sync();
    assert jsonb_array_length(r -> 'friends') = 0, 'deleted account is no friend';

    perform pg_temp.sign_in(ben);
    perform public.shelfmark_delete_account();
    perform pg_temp.sign_in(cleo);
    perform public.shelfmark_delete_account();
    perform pg_temp.sign_in(null);
    raise notice 'all server checks passed';
end
$$;

reset role;

-- What the three accounts left behind: nothing.
do $$
begin
    assert (select count(*) from shelfmark.profiles) = 0, 'profiles left';
    assert (select count(*) from shelfmark.vaults) = 0, 'vaults left';
    assert (select count(*) from shelfmark.messages) = 0, 'messages left';
    assert (select count(*) from auth.users where email like '%@example.org') = 0, 'sign-ins left';
end
$$;
