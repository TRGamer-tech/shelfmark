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
    loan uuid;
    other uuid;
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
    assert (r ->> 'ok')::boolean and (r ->> 'schema')::int = 3, 'ping';
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

    -- Cleo is nobody's friend: she sees nothing and cannot ask anyone for a book.
    perform pg_temp.sign_in(cleo);
    r := public.shelfmark_sync();
    assert jsonb_array_length(r -> 'friends') = 0 and jsonb_array_length(r -> 'libraries') = 0 and jsonb_array_length(r -> 'loans') = 0, 'stranger sees nothing';
    failed := false;
    begin
        perform public.shelfmark_loan_ask(anna, 7, '{"title":"Emma"}');
    exception when others then
        failed := sqlerrm = 'shelfmark:not_friends';
    end;
    assert failed, 'a stranger cannot ask';
    -- A version of the app from before the loans is told that it is too old.
    perform pg_temp.sign_in(ben);
    failed := false;
    begin
        perform public.shelfmark_send(anna, '{"type":"lend_request"}');
    exception when others then
        failed := sqlerrm = 'shelfmark:outdated';
    end;
    assert failed, 'the mailbox is closed';

    -- A loan, from the question to the day the book is back. Ben asks Anna for book 7.
    r := public.shelfmark_loan_ask(anna, 7, '{"title":"  Emma ","authors":"Jane Austen","isbn":"9780141439587","coverUrl":"https://example.org/emma.jpg","pageCount":"474","format":"PAPERBACK","rating":5}', ' Over the holidays? ');
    loan := (r ->> 'id')::uuid;
    assert r ->> 'state' = 'asked' and r ->> 'role' = 'borrower' and r ->> 'peer' = anna::text and r ->> 'peerName' = 'Anna B.', 'the asker sees the question';
    assert r -> 'book' ->> 'title' = 'Emma' and (r -> 'book' ->> 'pageCount')::int = 474 and not (r -> 'book' ? 'rating'), 'only what a book needs is kept';
    assert r ->> 'note' = 'Over the holidays?' and (r ->> 'byMe')::boolean and r ->> 'dueOn' is null, 'note and who did it';
    -- Asking again gives the same question back, not a second one.
    assert (public.shelfmark_loan_ask(anna, 7, '{"title":"Emma"}') ->> 'id')::uuid = loan, 'asking twice';
    -- A question needs a book with a title, and nobody asks themselves.
    failed := false;
    begin
        perform public.shelfmark_loan_ask(anna, 8, '{"title":" "}');
    exception when others then
        failed := sqlerrm = 'shelfmark:invalid';
    end;
    assert failed, 'a book without a title';
    -- The asker cannot answer for the lender, and nothing can be handed over before the yes.
    failed := false;
    begin
        perform public.shelfmark_loan_act(loan, 'agree');
    exception when others then
        failed := sqlerrm = 'shelfmark:not_allowed';
    end;
    assert failed, 'the borrower cannot say yes';
    -- Cleo has nothing to do with this loan: for her it does not exist.
    perform pg_temp.sign_in(cleo);
    failed := false;
    begin
        perform public.shelfmark_loan_act(loan, 'withdraw');
    exception when others then
        failed := sqlerrm = 'shelfmark:unknown_loan';
    end;
    assert failed, 'a third person cannot touch a loan';

    -- Cleo becomes Anna's friend and asks for the same book.
    perform public.shelfmark_add_friend(anna_code);
    other := (public.shelfmark_loan_ask(anna, 7, '{"title":"Emma"}') ->> 'id')::uuid;
    assert other <> loan, 'two people can ask for one book';

    -- Anna sees both questions and says yes to Ben, back by day 20800.
    perform pg_temp.sign_in(anna);
    r := public.shelfmark_sync();
    assert jsonb_array_length(r -> 'loans') = 2 and r -> 'loans' -> 0 ->> 'role' = 'lender', 'the lender sees who asked';
    failed := false;
    begin
        perform public.shelfmark_loan_act(loan, 'hand');
    exception when others then
        failed := sqlerrm = 'shelfmark:not_allowed';
    end;
    assert failed, 'nothing is handed over before the yes';
    r := public.shelfmark_loan_act(loan, 'agree', 20800);
    assert r ->> 'state' = 'agreed' and (r ->> 'dueOn')::bigint = 20800 and (r ->> 'agreedAt') is not null, 'yes, with a day';
    -- Cleo is told that the book went to somebody else, and asking again says the same.
    perform pg_temp.sign_in(cleo);
    r := public.shelfmark_sync();
    assert r -> 'loans' -> 0 ->> 'state' = 'declined' and r -> 'loans' -> 0 ->> 'reason' = 'taken' and not (r -> 'loans' -> 0 ->> 'byMe')::boolean, 'the other asker is told';
    failed := false;
    begin
        perform public.shelfmark_loan_ask(anna, 7, '{"title":"Emma"}');
    exception when others then
        failed := sqlerrm = 'shelfmark:taken';
    end;
    assert failed, 'a reserved book cannot be asked for';
    -- She puts the answer away. It is gone for her and still there for Anna.
    perform public.shelfmark_loan_act(other, 'hide');
    assert jsonb_array_length(public.shelfmark_sync() -> 'loans') = 0, 'put away';
    perform public.shelfmark_remove_friend(anna);

    -- Handing over: the lender first, then the borrower.
    perform pg_temp.sign_in(ben);
    failed := false;
    begin
        perform public.shelfmark_loan_act(loan, 'receive');
    exception when others then
        failed := sqlerrm = 'shelfmark:not_allowed';
    end;
    assert failed, 'the borrower cannot have it before the lender gave it';
    perform pg_temp.sign_in(anna);
    r := public.shelfmark_loan_act(loan, 'hand');
    assert r ->> 'state' = 'handed' and (r ->> 'handedAt') is not null, 'handed over, says the lender';
    -- Ben did not get it: back to reserved. Then for real.
    perform pg_temp.sign_in(ben);
    r := public.shelfmark_loan_act(loan, 'not_received');
    assert r ->> 'state' = 'agreed' and (r ->> 'handedAt') is null, 'not received';
    perform pg_temp.sign_in(anna);
    perform public.shelfmark_loan_act(loan, 'hand');
    -- The lender cannot confirm for the borrower.
    failed := false;
    begin
        perform public.shelfmark_loan_act(loan, 'receive');
    exception when others then
        failed := sqlerrm = 'shelfmark:not_allowed';
    end;
    assert failed, 'the lender cannot receive';
    perform pg_temp.sign_in(ben);
    r := public.shelfmark_loan_act(loan, 'receive');
    assert r ->> 'state' = 'on_loan' and (r ->> 'receivedAt') is not null, 'on loan once both said so';
    -- No way out of a loan except giving the book back.
    failed := false;
    begin
        perform public.shelfmark_loan_act(loan, 'withdraw');
    exception when others then
        failed := sqlerrm = 'shelfmark:not_allowed';
    end;
    assert failed, 'a book in hand cannot be withdrawn';

    -- Anna gives him more time, and then no fixed day at all.
    perform pg_temp.sign_in(anna);
    assert (public.shelfmark_loan_act(loan, 'set_due', 20830) ->> 'dueOn')::bigint = 20830, 'another day';
    assert public.shelfmark_loan_act(loan, 'set_due') ->> 'dueOn' is null, 'no fixed day';
    failed := false;
    begin
        perform public.shelfmark_loan_act(loan, 'set_due', -5);
    exception when others then
        failed := sqlerrm = 'shelfmark:invalid';
    end;
    assert failed, 'a day that is none';
    -- She cannot take it back before he says he gave it back.
    failed := false;
    begin
        perform public.shelfmark_loan_act(loan, 'take_back');
    exception when others then
        failed := sqlerrm = 'shelfmark:not_allowed';
    end;
    assert failed, 'giving back takes the borrower first';

    -- Giving back: the borrower first, then the lender.
    perform pg_temp.sign_in(ben);
    r := public.shelfmark_loan_act(loan, 'give_back');
    assert r ->> 'state' = 'given_back' and (r ->> 'givenBackAt') is not null, 'given back, says the borrower';
    failed := false;
    begin
        perform public.shelfmark_loan_act(loan, 'take_back');
    exception when others then
        failed := sqlerrm = 'shelfmark:not_allowed';
    end;
    assert failed, 'the borrower cannot confirm the return';
    -- It is not back, says Anna. He gives it back again, and now it is.
    perform pg_temp.sign_in(anna);
    r := public.shelfmark_loan_act(loan, 'not_returned');
    assert r ->> 'state' = 'on_loan' and (r ->> 'givenBackAt') is null, 'not returned';
    perform pg_temp.sign_in(ben);
    perform public.shelfmark_loan_act(loan, 'give_back');
    perform pg_temp.sign_in(anna);
    r := public.shelfmark_loan_act(loan, 'take_back');
    assert r ->> 'state' = 'returned' and (r ->> 'closedAt') is not null and (r ->> 'byMe')::boolean, 'returned once both said so';
    -- What is over stays over.
    failed := false;
    begin
        perform public.shelfmark_loan_act(loan, 'hand');
    exception when others then
        failed := sqlerrm = 'shelfmark:not_allowed';
    end;
    assert failed, 'a loan that is over does not start again';
    -- The book is free again: Ben can ask once more, and take the question back.
    perform pg_temp.sign_in(ben);
    r := public.shelfmark_sync();
    assert r -> 'loans' -> 0 ->> 'state' = 'returned' and not (r -> 'loans' -> 0 ->> 'byMe')::boolean, 'the borrower hears that it is back';
    other := (public.shelfmark_loan_ask(anna, 7, '{"title":"Emma"}') ->> 'id')::uuid;
    assert other <> loan, 'asking again after a return';
    assert public.shelfmark_loan_act(other, 'withdraw') ->> 'state' = 'withdrawn', 'withdrawn';
    -- The lender who has the book back before the borrower said a word can close the loan herself.
    other := (public.shelfmark_loan_ask(anna, 9, '{"title":"Persuasion"}') ->> 'id')::uuid;
    perform pg_temp.sign_in(anna);
    perform public.shelfmark_loan_act(other, 'agree');
    perform public.shelfmark_loan_act(other, 'hand');
    perform pg_temp.sign_in(ben);
    perform public.shelfmark_loan_act(other, 'receive');
    perform pg_temp.sign_in(anna);
    assert public.shelfmark_loan_act(other, 'close') ->> 'state' = 'returned', 'closed by the lender';
    -- A yes can be taken back as long as the book has not changed hands, and a no can carry a reason.
    perform pg_temp.sign_in(ben);
    other := (public.shelfmark_loan_ask(anna, 10, '{"title":"Sanditon"}') ->> 'id')::uuid;
    loan := (public.shelfmark_loan_ask(anna, 11, '{"title":"Lady Susan"}') ->> 'id')::uuid;
    perform pg_temp.sign_in(anna);
    perform public.shelfmark_loan_act(other, 'agree');
    r := public.shelfmark_loan_act(other, 'cancel', null, 'I need it myself after all');
    assert r ->> 'state' = 'cancelled' and r ->> 'reason' = 'I need it myself after all', 'the yes taken back';
    r := public.shelfmark_loan_act(loan, 'decline', null, 'Not this one');
    assert r ->> 'state' = 'declined' and r ->> 'reason' = 'Not this one', 'no, with a reason';
    -- A question nobody answered ends with the friendship. A book on loan stays a loan.
    perform pg_temp.sign_in(ben);
    other := (public.shelfmark_loan_ask(anna, 12, '{"title":"Mansfield Park"}') ->> 'id')::uuid;
    loan := (public.shelfmark_loan_ask(anna, 13, '{"title":"Northanger Abbey"}') ->> 'id')::uuid;
    perform pg_temp.sign_in(anna);
    perform public.shelfmark_loan_act(loan, 'agree');

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

    -- Ending a friendship ends it for both.
    perform pg_temp.sign_in(anna);
    perform public.shelfmark_remove_friend(ben);
    perform pg_temp.sign_in(ben);
    r := public.shelfmark_sync();
    assert jsonb_array_length(r -> 'friends') = 0 and jsonb_array_length(r -> 'messages') = 0 and jsonb_array_length(r -> 'libraries') = 0, 'unfriended';
    assert (select l ->> 'state' from jsonb_array_elements(r -> 'loans') l where l ->> 'id' = other::text) = 'withdrawn', 'an open question ends with the friendship';
    assert (select l ->> 'state' from jsonb_array_elements(r -> 'loans') l where l ->> 'id' = loan::text) = 'agreed', 'a reserved book stays reserved';
    -- Without the friendship there is no new question.
    failed := false;
    begin
        perform public.shelfmark_loan_ask(anna, 14, '{"title":"Love and Freindship"}');
    exception when others then
        failed := sqlerrm = 'shelfmark:not_friends';
    end;
    assert failed, 'no question without a friendship';

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
    assert (select count(*) from shelfmark.loans) = 0, 'loans left';
    assert (select count(*) from auth.users where email like '%@example.org') = 0, 'sign-ins left';
end
$$;
