# The Shelfmark server

A Supabase project, used for three things: signing in, keeping a library in step between
phone and website, and friends. `schema.sql` is all of it. This page is the contract that
the Android app (`app/`) and the website (`web/`) are written against.

## Signing in

Supabase Auth with e-mail and password. Every request carries the project's publishable
key in the header `apikey`. A signed-in caller adds `Authorization: Bearer <access token>`.
The user id of the account (`auth.uid()`) is the person's id everywhere: in the library
shared with friends, in loans, in the list of friends.

## Functions

All calls are `POST /rest/v1/rpc/<name>` with a JSON object of named arguments. All of
them answer with a JSON object. All but the first need a signed-in caller and act for that
caller only. A refusal is HTTP 400 with `{"code": "P0001", "message": "shelfmark:<reason>"}`.

| Function | Arguments | Answer | Refusals |
| --- | --- | --- | --- |
| `shelfmark_ping` | none | `{ok, schema, time}` | none. Works without signing in. The daily check |
| `shelfmark_hello` | `p_name?` | `{id, code, name}` | Creates the profile on first use, sets the name when given |
| `shelfmark_new_code` | none | `{code}` | |
| `shelfmark_add_friend` | `p_code` | `{id, name}` | `unknown_code`, `own_code`, `full` |
| `shelfmark_remove_friend` | `p_friend` | `{ok}` | |
| `shelfmark_publish` | `p_library` | `{at}` | `bad_request`, `too_large` |
| `shelfmark_loan_ask` | `p_friend`, `p_book`, `p_info?`, `p_note?` | a loan | `not_friends`, `invalid`, `taken`, `full` |
| `shelfmark_loan_act` | `p_loan`, `p_action`, `p_due?`, `p_reason?` | a loan | `unknown_loan`, `not_allowed`, `taken`, `invalid` |
| `shelfmark_sync` | `p_known?` | `{id, code, name, time, friends, libraries, loans, messages}` | |
| `shelfmark_send` | | | always `outdated` |
| `shelfmark_vault_pull` | `p_known?` | `{revision, at, payload}` | |
| `shelfmark_vault_push` | `p_payload`, `p_expected?` | `{revision, at}` | `conflict`, `bad_request`, `too_large` |
| `shelfmark_vault_history` | | `{versions: [{revision, at, books}]}` | |
| `shelfmark_vault_restore` | `p_revision` | `{revision, at}` | `unknown_version` |
| `shelfmark_delete_account` | none | `{ok, login_kept}` | |

Every one of them refuses with `signed_out` when nobody is signed in (or with HTTP 401
"permission denied for function" when the request carries no user at all).

Times are milliseconds since 1970. Friend codes are ten characters from
`ABCDEFGHJKLMNPQRSTUVWXYZ23456789`, shown to people as `ABCDE-FGHJK`. Whatever is typed in
is accepted in any case and with any punctuation.

`shelfmark_sync` answers with:

- `friends`: `[{id, name}]`, everybody the caller is friends with.
- `libraries`: `[{owner, at, payload}]`, the shared libraries of friends that are newer
  than the caller has. `p_known` maps a friend's id to the `at` of the copy the caller
  holds. A caller that keeps nothing passes `{}` and gets all of them.
- `friends`: `[{id, name, joined, since}]`. `joined` is true on the side of the one whose
  friend code was typed in: this friend came by my code. `since` is when, in milliseconds.
  See [Friends who join](#friends-who-join).
- `loans`: every loan the caller is part of and has not put away, the newest question
  first. See [Loans](#loans).
- `messages`: always `[]`. A leftover of the mailbox that borrow requests used to travel
  through, like `p_ack`, which is ignored, and `shelfmark_send`, which only says `outdated`
  so that a version of the app from before explains itself.

## The vault: one library on every device

`payload` of the vault is the whole library of an account as one JSON document. It is the
same document as a backup of the app, the class `BackupPayload` in
`app/src/main/java/ch/schmidtbit/shelfmark/data/share/SharePayloads.kt`, whose parts are
the classes in `data/model/Models.kt`: `books`, `shelves`, `links`, `quotes`, `sessions`,
`notes`, `goals`, `purchases`, `ornaments` and `prefs`. Fields that have their
default value are left out by the app, so a reader fills in the defaults. The website keeps
fields it does not know when it writes a document back. The app does not, so a new field
is taught to the app first.

`prefs` is everything that makes the shelf look the way its owner left it, so that it looks
the same on every device: `profileName`, `shareStatus` and `shareRatings` (what friends may
see), `minutesPerPage`, `theme` (a theme key, `system`, or `custom:<id>`), `customThemes`,
`viewMode` (`COVERS`, `SPINES` or `LIST`), `sort` (`ADDED`, `TITLE`, `AUTHOR` or `RATING`)
and `motion` (the lively shelf on or off). Ornaments and lists are part of the library
itself.

Saving works by revision:

1. `shelfmark_vault_pull(p_known)` answers with the current `revision`. The `payload` is
   `null` when `p_known` is that revision already. An account that never saved has
   revision 0.
2. `shelfmark_vault_push(p_payload, p_expected)` saves only if the vault is still at
   revision `p_expected`, and answers with the new one. Otherwise it refuses with
   `conflict`: fetch, apply the change again to what came back, and save again.

Ids of new books, lists, quotes and so on are numbers that fit a JavaScript number and
must not collide between devices. The website uses `Date.now() * 1000 + (0..999)`. A phone
counts up from a range of its own, below 9e14.

Days (`startedOn`, `finishedOn`, `day`, `lentSince`, goal days) are days since 1970-01-01
in local time (`LocalDate.toEpochDay`). Moments (`addedAt`, `createdAt`, `startedAt`,
`updatedAt`) are milliseconds since 1970.

**A library a client cannot read is never replaced.** A document that is damaged, has a
shape the client does not know, or names a `format` higher than the client knows (a
document without `format` is format 1, and so is everything written today) stops the sync
on that device: the client says that it needs an update, and writes nothing over the
document, neither its own library nor an empty one. "No document yet" (revision 0) is the
only case in which a client writes without having read.

A word the client does not know where a fixed set is expected (an ornament, a format, a
status that a newer version invented) has to come back the way it came. A client that can
keep it as it is and write it back unchanged does that (the website does). A client that
would have to turn it into something else, or drop the entry, stops instead, as for a
document it cannot read (the Android app does, its words are fixed types).

**Earlier versions.** When a save replaces a library, the server keeps the version it
replaced, unless it kept one within the last hour. It holds on to the five newest, and
beyond those to the last one of each of the five most recent days that have any: ten at
most. `shelfmark_vault_history()` lists them (which revision, when it was saved, how many
books, never the documents themselves). `shelfmark_vault_restore(p_revision)` makes one
the library again, as a new revision, and keeps the one it replaces in turn. Every device
then takes the restored library over like any other change from elsewhere. A server from
before this has neither function, and a client says so instead of offering the list.
`shelfmark_ping` answers `schema: 4` on a server that has them.

## Cover photos

A cover that was photographed is uploaded, so that it has an address every device and
every friend can show. Afterwards it is an ordinary `coverUrl`.

- Upload: `POST /storage/v1/object/shelfmark-covers/<user id>/<file name>` with `apikey`,
  `Authorization: Bearer <access token>`, `Content-Type: image/jpeg` (or png, webp),
  `x-upsert: true`, and the picture as the body. At most 2 MB, so clients scale a photo
  down first (the app: 1000 pixels on the longer side, JPEG).
- Its address: `/storage/v1/object/public/shelfmark-covers/<user id>/<file name>`. It needs
  no sign-in, but nobody can guess it.
- Remove: `DELETE /storage/v1/object/shelfmark-covers/<user id>/<file name>`.

Everybody can write below their own user id only. In a book, `coverPath` is the name of the
picture's file on the phone that took it (it means nothing anywhere else), and `coverUrl`
is what everybody shows. Whoever gives a book another cover, from a catalogue or by an
upload of its own, clears `coverPath`: otherwise the phone that still has the old photo
would go on showing it, and upload it again.

A picture is removed from the storage when nothing shows it any more: when its book is
deleted or gets another cover, and no other book of the library uses the same address.
Before an account is deleted the client lists the account's own folder
(`POST /storage/v1/object/list/shelfmark-covers` with `{"prefix": "<user id>"}`) and removes
everything in it, also the pictures of books that are long gone, while it is still allowed to.

## What friends get

After a save that changes it, the client also publishes the part of the library that
friends may see: an envelope `{app: "shelfmark", v: 1, type: "library", library: {...}}`
as built by `ShareCodec.buildLibrary` (same file as above). `library.ownerId` has to be
the caller's user id, a client ignores a library whose `ownerId` is not the friend it
came from. Reading status, lists, ratings and reviews are only included when
`prefs.shareStatus` and `prefs.shareRatings` say so.

The name friends see lives in two places, the profile on the server and
`prefs.profileName` in the vault. The vault is the one that counts: a client that sees them
differ calls `shelfmark_hello(p_name)` with the name from the vault.

A book is `available` to friends when it is owned, may be lent (`lendable`), is not lent
by hand (`lentTo` is empty), and no loan of it is `agreed`, `handed`, `on_loan` or
`given_back`. A client publishes again when a loan changes that.

## Books that are away

A book that is not in the reader's hands is drawn **away**: see-through (about 45 percent)
with a dashed outline, like the outline left where something used to stand. Both clients
decide it the same way, from the book alone:

- **Lent:** `lentTo` is not blank. That is a book lent by hand and a book whose loan is
  `on_loan` or `given_back` (the rules above write `lentTo`). It is solid again once it is
  back, that is once `lentTo` is empty.
- **Given back, not finished:** `ownership` is `NOT_OWNED`, `loanId` or `borrowedFrom` is
  not blank (it was borrowed, by a loan or by hand), and `status` is not `READ`. Marking it
  read makes it solid; any other status keeps it away.

Everything else is drawn as usual: a borrowed book while the reader has it (`BORROWED`), a
wish or a library copy that was never borrowed (`NOT_OWNED` with neither `loanId` nor
`borrowedFrom`), and a book given back that is `READ`.

Away is drawn wherever the library stands on a shelf: spines, covers and list, the shelves
of the reader's own lists, search and filters, the book that is being read on the shelf's
first card, and the cover on the book page. Statistics, calendar, recaps and milestones tell
what happened and draw every book as usual. The words are said as well, for a screen reader
and next to the book where there is room: `book_away_lent` ("Lent to Bo") and
`book_away_returned` ("Given back to Lena, not finished"). Text stays readable: in the list
the cover is see-through, the title and author are not.

## Friends who join

Whoever types in a friend code is connected at once, and the owner of the code is not
asked. So the owner is told: a friend in `friends` with `joined: true` whom this device has
not seen before is news ("Anna is now your friend", with the hint that she can be removed).
The one who typed the code is not told, they did it themselves. As with loans, the first
look after signing in tells no news: everybody who is there then is taken as seen.

## Notifications

There is no push service. The Android app looks for news every minute while it is open
and about every quarter of an hour in the background (Android decides when exactly), and
shows a notification for loan news, for a book that is due and for a friend who joined.
The website looks every minute while a tab is open, and, if the reader allowed it, shows
the same news as a notification of the browser while the tab is not the one in front.
With no tab open the website tells nothing until it is opened again.

## Loans

A loan is one record on the server that lender and borrower both read. Neither keeps a
copy that could differ: what a client shows is what the last `shelfmark_sync` said.
`shelfmark_ping` answers `schema: 3` on a server that has loans.

```json
{ "id": "uuid", "role": "lender | borrower", "peer": "uuid", "peerName": "Anna",
  "bookId": 1795439271489008,
  "book": { "title": "", "authors": "", "isbn": "", "coverUrl": "", "pageCount": 0, "format": "UNKNOWN" },
  "note": "", "state": "asked", "reason": "", "dueOn": null,
  "askedAt": 0, "agreedAt": null, "handedAt": null, "receivedAt": null, "givenBackAt": null,
  "closedAt": null, "updatedAt": 0, "byMe": true }
```

- `bookId` is the id of the book in the **lender's** library, `book` what the borrower saw
  of it when asking. `peer` and `peerName` are the other person.
- Moments are milliseconds since 1970. `dueOn` is a day, counted like `startedOn` in the
  vault (days since 1 January 1970), or `null` for "no fixed date".
- `byMe` says whether the last step was the caller's own.

**The life of a loan.** `shelfmark_loan_ask(p_friend, p_book, p_info, p_note)` starts one
in `asked` (asking again for the same book returns the open one; `taken` when the book is
reserved or out). Every further step is `shelfmark_loan_act(p_loan, p_action, ...)`:

| Who | `p_action` | From | To | |
| --- | --- | --- | --- | --- |
| lender | `agree` | `asked` | `agreed` | `p_due`: back by this day, `null` for no fixed date. Others who asked for the book are `declined` with reason `taken` |
| lender | `decline` | `asked` | `declined` | `p_reason`, optional |
| lender | `cancel` | `agreed`, `handed` | `cancelled` | the yes taken back, `p_reason` optional |
| lender | `hand` | `agreed` | `handed` | "I handed it over" |
| lender | `undo_hand` | `handed` | `agreed` | |
| borrower | `receive` | `handed` | `on_loan` | "I have it" |
| borrower | `not_received` | `handed` | `agreed` | "I did not get it" |
| borrower | `give_back` | `on_loan` | `given_back` | "I gave it back" |
| borrower | `undo_give_back` | `given_back` | `on_loan` | |
| lender | `take_back` | `given_back` | `returned` | "I have it back" |
| lender | `not_returned` | `given_back` | `on_loan` | "I did not get it back" |
| lender | `close` | `on_loan` | `returned` | the book is back and the borrower never said so |
| lender | `set_due` | `agreed`, `handed`, `on_loan`, `given_back` | same | `p_due`: another day, or `null` |
| borrower | `withdraw` | `asked`, `agreed` | `withdrawn` | |
| either | `hide` | a loan that is over | same | put away, for the caller only |

Handing over takes the lender first and then the borrower; giving back the borrower first
and then the lender. Everything else is refused with `not_allowed`: the loan has moved on,
and the client syncs to show where it stands. `returned`, `declined`, `withdrawn` and
`cancelled` are the end of a loan.

**The books follow the loans.** After every sync a client brings the library (the vault)
in line with the loans. Both clients do exactly this, and doing it twice changes nothing:

- *I am the lender* and the loan is `on_loan` or `given_back`: my book `bookId`, unless its
  `loanId` is this loan already, gets `lentTo = peerName`, `lentSince = the day of
  receivedAt`, `loanId = loan.id`.
- *I am the lender* and the loan is in any other state: my book whose `loanId` is this
  loan gets `lentTo = ""`, `lentSince = null`, `loanId = ""`.
- *I am the borrower* and the loan is `on_loan` or `given_back`: my copy of the book has
  `ownership = BORROWED`, `borrowedFrom = peerName`, `loanId = loan.id`. My copy is, in
  this order: the book whose `loanId` is this loan; the book with the id `loanBookId(loan.id)`;
  a book of mine that is the same book (same ISBN, or same title and first author) and
  `NOT_OWNED`, a wish for instance. If there is none, the client adds one with the id
  `loanBookId(loan.id)`, the fields of `loan.book` (and whatever more the friend's shared
  library says about `bookId`), `status = NONE`, `addedAt = receivedAt`.
- *I am the borrower* and the loan is `returned`: the book whose `loanId` is this loan and
  which is still `BORROWED` becomes `NOT_OWNED`. It keeps `loanId` and `borrowedFrom`,
  with everything the reader noted in it: read, not mine.
- `loanBookId(id)`: the first 13 hexadecimal digits of the loan's id, dashes left out,
  read as a number (0 becomes 1). Two devices of one account that both see the loan make
  the same book, and the vault knows it is one. For tests on both sides:
  `3f2a9c1e-7b4d-4e8a-9c0d-112233445566` gives `1111235846714580`,
  `0000000a-bcde-4f01-8234-56789abcdef0` gives `11259364`,
  `ffffffff-ffff-4fff-8fff-ffffffffffff` gives `4503599627370484`, and
  `9B1DEB4D-3B7D-4BAD-9BDD-2B0D7B3DCB6D` (capitals count the same) gives `2728844865026004`.

`loanId` is a field of a book in the vault, empty by default. A book with a `loanId`
whose loan the client knows shows that loan and its steps. With no such loan (the other
account is gone, or the loan was put away) it is a book lent or borrowed by hand again,
as for somebody without Shelfmark: `lentTo` and `borrowedFrom` are still typed freely.

Three things follow from that, in both clients:

- A friend who never gave themselves a name has an empty `peerName`. An empty `lentTo`
  means "at home", so the rules above write `?` in its place, for `lentTo` and
  `borrowedFrom` alike.
- Whatever ends a loan by hand on a book that has no known loan ("Got it back", another
  ownership) empties `loanId` too.
- A book that is part of a known loan which is not over cannot be deleted: as the
  borrower's copy the next sync would bring it back, and as the lender's book the loan
  would point at nothing. The client says to end the loan first.

A friendship that ends takes the open questions with it: those of the one who ended it
become `withdrawn`, those of the other `declined`. A book that is reserved or on loan
stays a loan.

**News and reminders.** A loan whose `updatedAt` is newer than what this device last saw
and whose `byMe` is `false` is news: the other side did something. Waiting for the reader's
own tap are, as lender, `asked` and `given_back`, and as borrower, `handed`. A loan that
is `on_loan` or `given_back` with a `dueOn` that is today or past is due: both clients
show it, and the phone says so once per loan and day it was due on.

**What is gone.** Borrow requests used to be envelopes of type `lend_request` and
`lend_answer`, passed through `shelfmark_send` and kept in the vault as `requests`. A
client no longer writes or reads any of it. A vault that still carries `requests` is
read without them, and a file of one of those two types is answered with "from an older
version". Showing a shelf as a file still works; borrowing needs both sides signed in.

## Trying it without Supabase

```sh
createdb shelfmark_dev
psql -d shelfmark_dev -v ON_ERROR_STOP=1 -f supabase/local.sql -f supabase/schema.sql
psql -d shelfmark_dev -v ON_ERROR_STOP=1 -f supabase/test.sql     # the whole story, in SQL
python3 supabase/dev_server.py --dsn "dbname=shelfmark_dev" --port 54330
```

`local.sql` is the small part of Supabase that `schema.sql` relies on (the two roles and
`auth.uid()`), and must never be run on a real project. `dev_server.py` answers the
sign-in calls and the function calls the way Supabase does, including a mode in which new
accounts have to confirm their e-mail address (`--confirm-email`).

No mail is sent by it. Two calls that Supabase does not have stand in for the links in the
mails: `POST /auth/v1/dev/confirm` and `POST /auth/v1/dev/recovery`, each with
`{"email", "redirect_to"}`, answer with the address such a link ends up at once Supabase
has checked it: the page named in `redirect_to`, with a sign-in of the kind `signup` or
`recovery` behind the `#`. A client has to take that sign-in and tell the person what
happened, on whatever page it arrives.
