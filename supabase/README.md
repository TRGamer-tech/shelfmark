# The Shelfmark server

A Supabase project, used for three things: signing in, keeping a library in step between
phone and website, and friends. `schema.sql` is all of it. This page is the contract that
the Android app (`app/`) and the website (`web/`) are written against.

## Signing in

Supabase Auth with e-mail and password. Every request carries the project's publishable
key in the header `apikey`. A signed-in caller adds `Authorization: Bearer <access token>`.
The user id of the account (`auth.uid()`) is the person's id everywhere: in the library
shared with friends, in borrow requests, in the list of friends.

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
| `shelfmark_send` | `p_to`, `p_payload` | `{id}` | `not_friends`, `too_large`, `full` |
| `shelfmark_sync` | `p_known?`, `p_ack?` | `{id, code, name, time, friends, libraries, messages}` | |
| `shelfmark_vault_pull` | `p_known?` | `{revision, at, payload}` | |
| `shelfmark_vault_push` | `p_payload`, `p_expected?` | `{revision, at}` | `conflict`, `bad_request`, `too_large` |
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
- `messages`: `[{id, from, at, payload}]`, borrow requests and answers waiting for the
  caller. They stay until their ids are passed as `p_ack` in a later call.

## The vault: one library on every device

`payload` of the vault is the whole library of an account as one JSON document. It is the
same document as a backup of the app, the class `BackupPayload` in
`app/src/main/java/ch/schmidtbit/shelfmark/data/share/SharePayloads.kt`, whose parts are
the classes in `data/model/Models.kt`: `books`, `shelves`, `links`, `quotes`, `sessions`,
`notes`, `goals`, `purchases`, `ornaments`, `requests`, and `prefs`. Fields that have their
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
is what everybody shows.

## What friends get

After a save that changes it, the client also publishes the part of the library that
friends may see: an envelope `{app: "shelfmark", v: 1, type: "library", library: {...}}`
as built by `ShareCodec.buildLibrary` (same file as above). `library.ownerId` has to be
the caller's user id, a client ignores a library whose `ownerId` is not the friend it
came from. Reading status, lists, ratings and reviews are only included when
`prefs.shareStatus` and `prefs.shareRatings` say so.

Borrow requests and answers are envelopes of type `lend_request` and `lend_answer`
(`LendRequestMsg`, `LendAnswerMsg`), sent with `shelfmark_send`. A client ignores a message
whose `fromId` is not the friend the server says it came from. The requests themselves
are kept in the vault (`requests`), so that every device of an account shows them.

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
