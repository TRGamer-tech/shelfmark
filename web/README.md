# Shelfmark on the web

The website of Shelfmark. A visitor finds a front page that says what Shelfmark is, hands
over the Android app and leads to the sign-in. Signed in, the library you keep on your
phone is in your browser: same shelves, same lists, same themes and ornaments, because
both show the same document, kept in a Supabase project (see `../supabase/README.md`,
which is the contract this site is written against).

It is a Next.js app (App Router, React, TypeScript, plain CSS). Runtime dependencies are
`next`, `react`, `react-dom` and `@supabase/supabase-js`, nothing else.

## How it is built

- The front page (`/`, and `/de` in German), the imprint and the privacy notice are
  drawn by the server and read without scripts. Everything of the library is drawn in
  the browser after signing in. Those pages are static, and the server only answers the
  book search (`/api/books/...`), the download link (`/download`) and the daily check
  (`/api/keepalive`).
- The address of the site itself serves two pages: the front page for a visitor and the
  shelf for somebody who is signed in. A small script in the head decides which, before
  the first paint, from whether this browser remembers a sign-in (`src/lib/visitor.ts`),
  so that nobody sees the front page flash by on the way to their shelf.
  `src/components/Providers.tsx` then keeps the two apart.
- The pages before the sign-in (`src/components/landing/`, `FrontDesk.tsx`,
  `Confirmed.tsx`, `src/components/legal/`, `src/app/front.css`) look the same for
  everybody: the app's Cocoa theme as the room and its Paper theme for what is read or
  filled in. The two shelves on the front page are the shelves of the library
  (`Shelves.tsx`), not pictures of them.
- The link of a mail is understood wherever it lands (`src/lib/supabase/links.ts`,
  `src/components/auth.tsx`). The site reads what stands behind the `#` itself, wipes it
  from the address by replacing the entry in the history, and only then takes the
  sign-in, so that neither a reload nor the Back button plays a link again. The link of a
  confirmation mail, and any link that does not work any more, ends on `/confirmed`.
- The imprint (`/imprint`, `/de/impressum`) and the privacy notice (`/privacy`,
  `/de/datenschutz`) take their words from `src/i18n/legal.ts`. Whoever runs the site is
  named in one file, `src/lib/operator.ts`: an e-mail address, and a name and a postal
  address that are shown once they are filled in. The privacy notice says only what the
  code does, and tests hold some of it against the code (which entries the site keeps in
  the browser, that no cookie is set, which catalogues are asked). Whoever changes what
  is stored or sent changes the sentence about it, in both languages, and the date in
  `src/lib/legal.ts`.
- `src/lib` holds the logic, free of React and tested by itself: the library document and
  its defaults (`model.ts`), every change a reader can make (`mutations.ts`), saving by
  revision with the conflict path (`sync.ts`), what friends get (`share.ts`, `social.ts`),
  loans between friends (`loans.ts`), statistics (`stats.ts`, `insights.ts`), the shelf (`shelf.ts`), themes (`theme.ts`),
  the seven book catalogues (`catalogue/`), lists of books from other apps
  (`csvImport.ts`) and the reading timer (`timer.ts`). Most of it is a port of the Kotlin
  code of the app, file by file, and says so at the top.
- `src/components/library.tsx` keeps the library in memory. Every change goes through
  its `mutate`: shown at once, saved right after, applied again to the fresh document
  when another device saved in between.
- A library the website cannot read is never replaced (`../supabase/README.md`, the
  paragraph of that name). `inspectVault` in `model.ts` reads strictly what the server
  holds: a document that is no object, misses a field the app has no default for, holds
  a value of the wrong kind, or names a `format` higher than `VAULT_FORMAT` is not
  opened. The store (`sync.ts`) then stops, on the first fetch, on a later look and in
  the middle of a save alike: the page says that the website needs an update or that
  the library is damaged, and nothing is written until the document can be read again.
  An account that never saved anything (revision 0) is the one case in which the
  website writes without having read. A word the website does not know where the app
  has a fixed set (a status, an ownership, a format, an ornament, the kind or the
  rhythm of a goal, a view, an order, a theme) does not stop anything: it is kept as
  the text it is and written back unchanged, like a field the website does not know.
  Where such a word is shown, the page falls back to the usual picture without
  touching the word. A backup file is read by the same rules.
- A loan between friends is one record on the server that lender and borrower both read
  (`../supabase/README.md`, "Loans"). The website keeps no copy of it: what it shows is
  what the last look at the server said. After every such look `followLoans` brings the
  books in line with the loans, through `mutate` like any edit: a book that is out
  carries who has it, and a book that came in stands on the borrower's shelf. The Android
  app does exactly the same, and tests on both sides use the same values. Which books
  can be asked for is published again whenever a loan changes it. The one piece
  (`src/components/Loans.tsx`) that shows how a loan stands, with exactly the steps the
  server allows from there, is used on the page of the loans, on the page of a book and
  on a friend's shelf. Three edges, as the contract has them: a friend without a name
  stands on a book as `?` (an empty name would mean that the book is at home), whatever
  ends a loan by hand on a book whose loan the server no longer tells of empties
  `loanId` too, and a book that is part of a loan which is not over cannot be deleted.
- `src/i18n/app-en.ts` and `app-de.ts` are the texts of the Android app, converted once
  with `node scripts/convert-strings.mjs`. `web-en.ts` and `web-de.ts` add what only the
  website needs. Run the script again when the app's `strings.xml` changed.
- Fonts (Playfair Display, Lato) are in `public/fonts` with their licence texts.

## Environment variables

| Variable | What it is |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Address of the Supabase project on which `supabase/schema.sql` has been run |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | The publishable key of that project |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Other names for the same key. The first of the three that is set is used |
| `GOOGLE_BOOKS_API_KEY` | Optional, server side only. Google Books often refuses searches without a key |
| `NEXT_PUBLIC_SITE_URL` | Optional. The address of the site, for the addresses in link previews. On Vercel it is known without this |
| `SHELFMARK_GITHUB_API` | Optional, server side only. Asked instead of `https://api.github.com` for the releases of the app. The tests point it at a recording |

Only the publishable key is used. It is meant to be public: what a caller may do is
decided by the server for the signed-in account. The values are read when the site is
built. Built without them, the site shows a plain page that says the server is not
configured. `.env.example` lists them.

## Running it locally

Node 22 and npm. Then, against the stand-in for Supabase that comes with the repository
(it needs Python with psycopg2 and a local PostgreSQL):

```sh
createdb shelfmark_web
psql -d shelfmark_web -v ON_ERROR_STOP=1 -f ../supabase/local.sql -f ../supabase/schema.sql
python3 ../supabase/dev_server.py --dsn "dbname=shelfmark_web" --port 54340 &

npm install
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54340 \
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_local_development \
npm run dev
```

Open http://localhost:3000, create an account, add a book. Against a real project, put
its address and key into `.env.local` instead.

## Testing

```sh
npm test         # unit tests of everything in src/lib (Node's own test runner, no extra packages)
npm run lint     # the writing rules of the project, and the type check
npm run build    # must also pass with no variable set
npm run e2e      # the built site in a real browser
```

`npm test` covers the defaults and the round trip of the contract samples
(`test/fixtures/samples`, copies of `../supabase/samples` that are compared with the
originals when those are there), `buildLibrary` against the two library samples to the
byte, the status rules, statistics, calendar, recap and milestones (the cases of the
app's Kotlin tests), ISBNs, the catalogue parsers against recorded answers, saving with
conflicts against a server in memory, a library that cannot be read (what stops the
sync, what passes through untouched, and that nothing is written over it), what another
cover does to a book, which pictures a save leaves without a book and the requests for
uploaded pictures, loans between friends (who may take which step, what is news and
that it is told once, what waits and what is due, how the books follow the loans, with
the values the app is tested with as well), the notices at the foot of the page, what
the address says after every kind of mail link and where
each kind leads, the script that decides between front page and shelf, picking the newest
release of the app, the words, numbers and colours of the front page, the imprint and the
privacy notice (who is named on them, and what they say about the code), the reading
timer, and the texts. The
importer of lists from other apps is tested with the cases of
the app's Kotlin test on the same two files (`test/fixtures/goodreads_export.csv` and
`storygraph_export.csv`, copies of the app's test fixtures that are compared with the
originals when those are there), so that the phone and the website read a list alike.
`test/fixtures/old` holds files as they were written before loans were kept on the
server (a borrow request, its answer, a library that carries requests): the contract
no longer has samples of them, and the website still has to read them for what they are.

`npm run e2e` needs Playwright with Chromium installed once for the machine (not as a
dependency of this project: `npm install -g playwright`, with `NODE_PATH` pointing at the
global modules) and a PostgreSQL with the schema loaded as above. It then does the rest
by itself: starts the stand-in server twice (port 54340, and 54341 in the mode where new
accounts confirm their e-mail address), builds the site twice (with a server into
`.next-e2e`, without one into `.next-plain`), starts both (ports 3210 and 3211) and a
small server that answers for the seven catalogues and for GitHub's list of releases
from recorded answers (port 3212). The second site cannot reach GitHub at all, which is
how the download link and the front page are tested without it.
Set `SHELFMARK_E2E_DSN` if the database is not
`host=127.0.0.1 port=54329 user=postgres dbname=shelfmark_web`. `npm run e2e -- --no-build`
reuses the last build, and `npm run e2e -- --only=timer` runs only the tests whose name
holds that word (for tests that stand on their own: most build on the ones before them).
A stand-in server that already answers on one of the two ports is
used as it is, so stop an old one after `supabase/dev_server.py` changed. The links of
mails are played with the helpers of the stand-in (`/auth/v1/dev/confirm`,
`/auth/v1/dev/recovery`), which hand out what the link in a real mail would lead to.

The run leaves pictures in `e2e/screenshots` and the library of its test account, as the
server holds it, in `e2e/fixtures/vault-from-web.json`. A test of the Android app reads
that file to prove that the app understands what the website writes.

## Deploying on Vercel

- Root directory: `web`. Framework: Next.js. Build and install commands: the defaults.
- Environment variables: the ones above. The Supabase integration of Vercel sets them
  by itself.
- `vercel.json` asks for a cron job that calls `/api/keepalive` once a day. A free
  Supabase project is put to sleep when its database sees no activity for a week, and
  this is that activity. Every browser that opens the site says hello once a day as well.
- In the Supabase project: run `supabase/schema.sql`, and under Authentication, URL
  configuration, set the site URL to the address of the website and allow
  `https://<your site>/**` as a redirect. The site names two pages for the links in its
  mails to lead to: `/confirmed` for a confirmation mail and `/reset` for a "forgot
  password" mail. The site URL must be an address anybody can open, not one that Vercel
  protects with a login of its own.
- `/confirmed` says what the link of a confirmation mail did: the address is confirmed
  and this device is signed in, or it is confirmed and the way on is to sign in. The same
  words serve somebody who made the account in the Android app. A link that is too old
  or was used before lands there as well and is told what that usually means. A mail that
  names no page, as older versions of the app send them, leads to the site URL itself,
  and the site takes the reader on to `/confirmed` or `/reset` from there.
- `src/lib/operator.ts` says who runs the site. The imprint and the privacy notice show
  the e-mail address alone until a name and a postal address are filled in there.
- `/download` redirects to the newest `.apk` among the releases of the project on
  GitHub, pre-releases included, and to the list of releases when GitHub cannot be
  asked. The front page names the version and size from the same answer, which is kept
  for five minutes in one place for both, and speaks without them when it knows nothing.
  The build needs no network.

## What the website leaves to the phone

The website does what the app does, with these exceptions:

- Scanning a barcode with the camera. On the website an ISBN is typed or pasted.
- Reading a quote off a page with the camera (text recognition). On the website a quote
  is typed or pasted.
- Zip files. The backup the phone saves is a zip that also holds the photos of covers,
  and some apps export their lists as a zip of tables. The website saves and restores a
  backup as one `.json` file, which the phone reads as well, and imports a list as one
  `.csv` file. It says so when it is given a zip.
- The library file of the desktop Shelfmark, which the phone accepts as a backup.
- Telling the reader what happened in a loan while the site is closed, and reminding
  them on the day a book is due back. The phone shows a notification for both. The
  website says what is new the next time it is open, in a line that passes, and shows
  what is due on the page of the loans and on the book.

## Notes

- The reading timer (`/book/timer`, reached from the "Reading" tab of a book) is kept in
  the storage of the browser, one per account: which book, when it was started, and what
  was counted before the last pause. It goes on through other pages, a reload and a
  closed tab, and a line in the frame of the site leads back to it. It is not part of
  the library, a stopwatch on one screen means nothing on another. "Stop and log" opens
  the form for a reading session with the minutes filled in.
- Lists from other apps are imported in the settings ("Import from other apps"): a
  Goodreads or StoryGraph export, or any CSV with a title column. The file is read in
  the browser. A preview says how many books were found, which are new, which are here
  already and only get their gaps filled, which lists will be created and which columns
  were understood. The import is one change to the library and so one save. "Find
  missing covers" then asks the catalogues for every book without a cover and saves what
  it finds ten books at a time.
- Loans (`/friends/loans`; the old address `/friends/requests` leads there): what waits
  for the reader's word, what is on its way, what is lent out, what is borrowed, and
  what is over. The Friends item of the navigation counts what waits. A yes comes with
  the day the book is wanted back by, or with no fixed date. A page that asks for a step
  the loan has moved past says so and shows where the loan stands. What a browser last
  saw of each loan is kept in its storage (`shelfmark.loans.<user id>`), with the
  server's time of the answer that said so, and goes when the reader signs out. From
  that the page tells what is new (`takeLoanAnswer` in `src/lib/loans.ts`): a step of
  the other side is announced once per browser, in the window that sees it first, and
  never by the first look after signing in. An answer that is older than what the
  browser has seen already (two looks that crossed, in one window or in two) changes
  nothing, or the news told in between would be new again. There is one notice per
  loan (`src/lib/notices.ts`): the next step takes the place of the one before, and
  the notice goes when the reader answers it, here or on another device, as the
  notifications of the app do. Borrow requests as they were
  before, kept in the library and sent as messages or files, are gone: a library that
  still carries them is read and written without them, and such a file is told that it
  comes from an older version.
- The book search routes need no sign-in. They can only ask the seven catalogues the
  questions the app asks, so they are of little use to anybody else, but they are open.
- Pictures of covers are loaded by the browser straight from wherever the catalogue
  keeps them, without a referrer.
- A cover that is uploaded goes to the storage of the Supabase project, below a folder
  named after the account (`src/lib/supabase/covers.ts`). Giving a book another cover
  clears the name of the photo a phone may have taken of it (`coverPath`). A picture
  goes with its book: after every save the pictures of this account that some book
  showed before and no book shows now are removed from the storage, which is what
  happens when a book is deleted or gets another cover. A picture another book still
  shows stays. A picture uploaded in the form of a book and then not saved is removed
  when the form is left. Before an account is deleted its folder is listed, page by
  page, and everything in it is removed, also what no book names any more. A removal
  that fails is never a reason not to delete the book or the account.
