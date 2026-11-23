# Shelfmark on the web

The website of Shelfmark. A visitor finds a front page that says what Shelfmark is, hands
over the Android app and leads to the sign-in. Signed in, the library you keep on your
phone is in your browser: same shelves, same lists, same themes and ornaments, because
both show the same document, kept in a Supabase project (see `../supabase/README.md`,
which is the contract this site is written against).

It is a Next.js app (App Router, React, TypeScript, plain CSS). Runtime dependencies are
`next`, `react`, `react-dom` and `@supabase/supabase-js`, nothing else.

## How it is built

- The front page (`/`, and `/de` in German) is drawn by the server and reads without
  scripts. Everything of the library is drawn in the browser after signing in. Those
  pages are static, and the server only answers the book search (`/api/books/...`), the
  download link (`/download`) and the daily check (`/api/keepalive`).
- The address of the site itself serves two pages: the front page for a visitor and the
  shelf for somebody who is signed in. A small script in the head decides which, before
  the first paint, from whether this browser remembers a sign-in (`src/lib/visitor.ts`),
  so that nobody sees the front page flash by on the way to their shelf.
  `src/components/Providers.tsx` then keeps the two apart.
- The pages before the sign-in (`src/components/landing/`, `FrontDesk.tsx`,
  `src/app/front.css`) look the same for everybody: the app's Cocoa theme as the room
  and its Paper theme for what is read or filled in. The two shelves on the front page
  are the shelves of the library (`Shelves.tsx`), not pictures of them.
- `src/lib` holds the logic, free of React and tested by itself: the library document and
  its defaults (`model.ts`), every change a reader can make (`mutations.ts`), saving by
  revision with the conflict path (`sync.ts`), what friends get (`share.ts`, `social.ts`),
  statistics (`stats.ts`, `insights.ts`), the shelf (`shelf.ts`), themes (`theme.ts`),
  the seven book catalogues (`catalogue/`), lists of books from other apps
  (`csvImport.ts`) and the reading timer (`timer.ts`). Most of it is a port of the Kotlin
  code of the app, file by file, and says so at the top.
- `src/components/library.tsx` keeps the library in memory. Every change goes through
  its `mutate`: shown at once, saved right after, applied again to the fresh document
  when another device saved in between.
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
conflicts against a server in memory, what another cover does to a book and the requests
for uploaded pictures, what the address says after every kind of mail link, the script
that decides between front page and shelf, picking the newest release of the app, the
words, numbers and colours of the front page, the reading timer, and the texts. The
importer of lists from other apps is tested with the cases of
the app's Kotlin test on the same two files (`test/fixtures/goodreads_export.csv` and
`storygraph_export.csv`, copies of the app's test fixtures that are compared with the
originals when those are there), so that the phone and the website read a list alike.

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
  `https://<your site>/reset` as a redirect, so that the link in a "forgot password" mail
  leads to the page that sets the new password. A mail asked for in the Android app names
  no page and leads to the site URL itself, which takes the reader to that page as well.
- The link in a confirmation mail leads to the site URL too. The site takes the sign-in
  that comes with it: the reader lands on their shelf with a notice that the address is
  confirmed, worded also for somebody who signed up in the Android app. A link that is
  too old or was used before leads to the sign-in page, which says what to do.
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
- Telling the reader that a friend wrote while the site is closed. The phone shows a
  notification, the website shows the news the next time it is open.

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
- The book search routes need no sign-in. They can only ask the seven catalogues the
  questions the app asks, so they are of little use to anybody else, but they are open.
- Pictures of covers are loaded by the browser straight from wherever the catalogue
  keeps them, without a referrer.
- A cover that is uploaded goes to the storage of the Supabase project, below a folder
  named after the account (`src/lib/supabase/covers.ts`). Giving a book another cover
  clears the name of the photo a phone may have taken of it (`coverPath`), and deleting
  the account removes the uploaded pictures of its books first.
