-- Plays the whole friend flow against the functions of schema.sql, as the role the app
-- uses. Run it against a scratch database, never against the real project:
--   psql -v ON_ERROR_STOP=1 -f supabase/schema.sql -f supabase/test.sql
-- It ends with "all server checks passed" or stops at the first failed check.

set role anon;

do $$
declare
    anna constant uuid := '11111111-1111-4111-8111-111111111111';
    ben constant uuid := '22222222-2222-4222-8222-222222222222';
    cleo constant uuid := '33333333-3333-4333-8333-333333333333';
    anna_secret constant text := 'anna-secret-anna-secret-anna-secret-1';
    ben_secret constant text := 'ben-secret-ben-secret-ben-secret-ben1';
    cleo_secret constant text := 'cleo-secret-cleo-secret-cleo-secret1';
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
    assert failed, 'anon must not read the tables';

    r := public.shelfmark_ping();
    assert (r ->> 'ok')::boolean, 'ping';

    r := public.shelfmark_register(anna, anna_secret, 'Anna');
    anna_code := r ->> 'code';
    assert anna_code ~ '^[A-HJ-NP-Z2-9]{10}$', 'code format: ' || anna_code;
    perform public.shelfmark_register(ben, ben_secret, 'Ben');
    perform public.shelfmark_register(cleo, cleo_secret, 'Cleo');

    -- Registering again keeps the code and changes the name.
    r := public.shelfmark_register(anna, anna_secret, 'Anna B.');
    assert r ->> 'code' = anna_code and r ->> 'name' = 'Anna B.', 're-register';

    -- A wrong secret gets nowhere, for any function.
    failed := false;
    begin
        perform public.shelfmark_register(anna, 'wrong-secret-wrong-secret-wrong-secret', 'Mallory');
    exception when others then
        failed := sqlerrm = 'shelfmark:forbidden';
    end;
    assert failed, 'wrong secret on register';
    failed := false;
    begin
        perform public.shelfmark_sync(anna, 'wrong-secret-wrong-secret-wrong-secret');
    exception when others then
        failed := sqlerrm = 'shelfmark:forbidden';
    end;
    assert failed, 'wrong secret on sync';
    failed := false;
    begin
        perform public.shelfmark_register('44444444-4444-4444-8444-444444444444', 'short', 'X');
    exception when others then
        failed := sqlerrm = 'shelfmark:bad_request';
    end;
    assert failed, 'short secret';

    perform public.shelfmark_publish(anna, anna_secret, '{"type":"library","library":{"ownerName":"Anna","books":[{"id":1,"title":"Emma"}]}}');
    perform public.shelfmark_publish(ben, ben_secret, '{"type":"library","library":{"ownerName":"Ben","books":[]}}');

    -- Nobody sees anything before a code is redeemed.
    r := public.shelfmark_sync(ben, ben_secret);
    assert jsonb_array_length(r -> 'friends') = 0 and jsonb_array_length(r -> 'libraries') = 0, 'no friends yet';

    failed := false;
    begin
        perform public.shelfmark_add_friend(ben, ben_secret, 'ZZZZZ-ZZZZZ');
    exception when others then
        failed := sqlerrm = 'shelfmark:unknown_code';
    end;
    assert failed, 'unknown code';
    failed := false;
    begin
        perform public.shelfmark_add_friend(anna, anna_secret, anna_code);
    exception when others then
        failed := sqlerrm = 'shelfmark:own_code';
    end;
    assert failed, 'own code';

    -- Ben types Anna's code the way people do: lower case, with a dash and a space.
    r := public.shelfmark_add_friend(ben, ben_secret, lower(substr(anna_code, 1, 5)) || '- ' || substr(anna_code, 6));
    assert r ->> 'id' = anna::text and r ->> 'name' = 'Anna B.', 'add friend';
    perform public.shelfmark_add_friend(ben, ben_secret, anna_code);

    -- Both sides are friends now and see each other's library.
    r := public.shelfmark_sync(ben, ben_secret);
    assert jsonb_array_length(r -> 'friends') = 1 and r -> 'friends' -> 0 ->> 'name' = 'Anna B.', 'ben sees anna';
    assert r -> 'libraries' -> 0 -> 'payload' -> 'library' -> 'books' -> 0 ->> 'title' = 'Emma', 'ben gets the library';
    r := public.shelfmark_sync(anna, anna_secret);
    assert r -> 'friends' -> 0 ->> 'id' = ben::text, 'anna sees ben';
    assert jsonb_array_length(r -> 'libraries') = 1, 'anna gets ben''s library';

    -- A library the phone already has is not sent again, a newer one is.
    r := public.shelfmark_sync(ben, ben_secret);
    r := public.shelfmark_sync(ben, ben_secret, jsonb_build_object(anna::text, r -> 'libraries' -> 0 -> 'at'));
    assert jsonb_array_length(r -> 'libraries') = 0, 'known library is skipped';
    assert jsonb_array_length(r -> 'friends') = 1, 'friends are always listed';
    perform pg_sleep(0.01);
    perform public.shelfmark_publish(anna, anna_secret, '{"type":"library","library":{"ownerName":"Anna","books":[]}}');
    r := public.shelfmark_sync(ben, ben_secret, jsonb_build_object(anna::text, (r ->> 'time')::bigint - 60000));
    assert jsonb_array_length(r -> 'libraries') = 1, 'changed library is sent';

    -- Cleo is nobody's friend: she sees nothing and cannot write to anyone.
    r := public.shelfmark_sync(cleo, cleo_secret);
    assert jsonb_array_length(r -> 'friends') = 0 and jsonb_array_length(r -> 'libraries') = 0, 'stranger sees nothing';
    failed := false;
    begin
        perform public.shelfmark_send(cleo, cleo_secret, anna, '{"type":"lend_request"}');
    exception when others then
        failed := sqlerrm = 'shelfmark:not_friends';
    end;
    assert failed, 'stranger cannot send';

    -- A borrow request travels from Ben to Anna and is gone once she has it.
    r := public.shelfmark_send(ben, ben_secret, anna, '{"type":"lend_request","request":{"requestId":"r1","bookTitle":"Emma"}}');
    message_id := (r ->> 'id')::uuid;
    r := public.shelfmark_sync(anna, anna_secret);
    assert jsonb_array_length(r -> 'messages') = 1, 'message arrives';
    assert r -> 'messages' -> 0 ->> 'from' = ben::text, 'sender is named';
    assert r -> 'messages' -> 0 -> 'payload' -> 'request' ->> 'bookTitle' = 'Emma', 'payload intact';
    -- Somebody else cannot acknowledge it away.
    perform public.shelfmark_sync(ben, ben_secret, '{}', array[message_id]);
    r := public.shelfmark_sync(anna, anna_secret);
    assert jsonb_array_length(r -> 'messages') = 1, 'only the receiver can acknowledge';
    r := public.shelfmark_sync(anna, anna_secret, '{}', array[message_id]);
    assert jsonb_array_length(r -> 'messages') = 0, 'acknowledged message is deleted';

    failed := false;
    begin
        perform public.shelfmark_send(ben, ben_secret, anna, to_jsonb(repeat('x', 70000)));
    exception when others then
        failed := sqlerrm = 'shelfmark:too_large';
    end;
    assert failed, 'oversized message';

    -- A new code makes the old one useless.
    old_code := anna_code;
    anna_code := public.shelfmark_new_code(anna, anna_secret) ->> 'code';
    assert anna_code <> old_code, 'new code differs';
    failed := false;
    begin
        perform public.shelfmark_add_friend(cleo, cleo_secret, old_code);
    exception when others then
        failed := sqlerrm = 'shelfmark:unknown_code';
    end;
    assert failed, 'old code is dead';

    -- Ending a friendship ends it for both and drops what was on its way.
    perform public.shelfmark_send(anna, anna_secret, ben, '{"type":"lend_answer"}');
    perform public.shelfmark_remove_friend(anna, anna_secret, ben);
    r := public.shelfmark_sync(ben, ben_secret);
    assert jsonb_array_length(r -> 'friends') = 0 and jsonb_array_length(r -> 'messages') = 0 and jsonb_array_length(r -> 'libraries') = 0, 'unfriended';

    -- Deleting the account removes every trace.
    perform public.shelfmark_add_friend(cleo, cleo_secret, anna_code);
    perform public.shelfmark_delete_account(anna, anna_secret);
    r := public.shelfmark_sync(cleo, cleo_secret);
    assert jsonb_array_length(r -> 'friends') = 0, 'deleted account is no friend';
    failed := false;
    begin
        perform public.shelfmark_sync(anna, anna_secret);
    exception when others then
        failed := sqlerrm = 'shelfmark:forbidden';
    end;
    assert failed, 'deleted account cannot sync';

    perform public.shelfmark_delete_account(ben, ben_secret);
    perform public.shelfmark_delete_account(cleo, cleo_secret);
    raise notice 'all server checks passed';
end
$$;

reset role;
