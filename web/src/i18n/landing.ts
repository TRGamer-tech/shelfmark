// The words of the front page, in English and German. They are kept apart from the
// texts of the library (app-*.ts, web-*.ts) because only the server reads them: the
// front page is drawn there and sent as plain HTML.
//
// Every number in here is a placeholder. The page fills in what the code says: how many
// themes there are, how many ornaments, how many catalogues are asked.

import type { Lang } from "./index.ts";

/** One book on the shelf of the front page: something Shelfmark does. */
export interface Feature {
  /** The label on the spine, and the corner of the catalogue card. The letter is the bay: A adding, B the shelf, C reading, D friends. */
  mark: string;
  /** What stands on the spine. Short, it has to fit there. */
  title: string;
  /** How thick the book is. Only for the look of the shelf, the number is shown nowhere. */
  pages: number;
  hardcover?: boolean;
  /** The body of the card. */
  text: string;
  /** Where it works: on the phone, in the browser, or both. */
  where: string;
}

export interface Question {
  q: string;
  a: string;
  /** A link that belongs to the answer. */
  link?: { label: string; href: string };
}

export interface LandingTexts {
  meta: { title: string; description: string; imageAlt: string };
  nav: { signIn: string; download: string; language: string; skip: string };
  hero: {
    /** The headline, line by line. */
    title: string[];
    lead: string;
    download: string;
    /** "%1$s" is the version, "%2$s" the size. */
    downloadFacts: string;
    downloadFactsUnknown: string;
    signIn: string;
    /** What a shelfmark is, as a note in the margin. */
    note: string;
  };
  shelf: {
    /** Name of the shelf for those who cannot see it. */
    label: string;
    hint: string;
    /** Shown where the shelf would be when the page runs without scripts. */
    plain: string;
    cardsLabel: string;
    mark: string;
    where: string;
    /** "%1$d" of "%2$d". */
    counter: string;
    previous: string;
    next: string;
  };
  features: Feature[];
  twin: {
    title: string;
    text: string;
    caption: string;
    sample: string;
    browser: string;
    phone: string;
    view: string;
    order: string;
    ornaments: string;
    candleLeft: string;
    candleRight: string;
    catOn: string;
    catOff: string;
    /** Said once a shelf has followed the other. */
    followedPhone: string;
    followedBrowser: string;
    /** Shown instead of the two shelves when the page runs without scripts. */
    plain: string;
  };
  download: {
    title: string;
    lead: string;
    /** "%1$s" is the version. */
    button: string;
    buttonUnknown: string;
    notes: string[];
    rows: { version: string; file: string; needs: string; price: string; licence: string };
    /** "%1$s" is the version, "%2$s" the day it came out. */
    versionValue: string;
    versionUnknown: string;
    /** "%1$s" is the name of the file, "%2$s" its size. */
    fileValue: string;
    fileUnknown: string;
    /** "%1$s" is the number of the oldest Android. */
    needsValue: string;
    priceValue: string;
    licenceValue: string;
    releases: string;
    source: string;
    /** On the stamp of the slip, above the day the version came out. */
    stamp: string;
  };
  questions: { title: string; items: Question[] };
  footer: { line: string; top: string; source: string; releases: string; signIn: string };
}

const REPOSITORY = "https://github.com/TRGamer-tech/shelfmark";

const en: LandingTexts = {
  meta: {
    title: "Shelfmark: a reading tracker that looks like a bookshelf",
    description: "Keep the books you have read, are reading and still want on wooden shelves, on your Android phone and in your browser. Free, open source, no ads.",
    imageAlt: "Book spines standing on a wooden shelf under lamplight",
  },
  nav: { signIn: "Sign in", download: "Download", language: "Language", skip: "Skip to the shelf" },
  hero: {
    title: ["Keep your reading", "on a shelf."],
    lead: "Shelfmark is a reading tracker that looks like a real bookshelf. Scan a book, stand it on a shelf, rate it, and find the same shelf on your Android phone and in your browser.",
    download: "Download for Android",
    downloadFacts: "Version %1$s, %2$s, Android %3$s or newer",
    downloadFactsUnknown: "Android %3$s or newer",
    signIn: "Sign in on the web",
    note: "A shelfmark is the label on the spine of a library book that says where it belongs.",
  },
  shelf: {
    label: "What Shelfmark does, as books on a shelf",
    hint: "Take a book off the shelf. Each one is something Shelfmark does.",
    plain: "Each card below is something Shelfmark does.",
    cardsLabel: "Catalogue cards",
    mark: "Shelfmark",
    where: "Where",
    counter: "Card %1$d of %2$d",
    previous: "Previous card",
    next: "Next card",
  },
  features: [
    {
      mark: "A 1",
      title: "Scan a barcode",
      pages: 280,
      text: "Point the phone's camera at the ISBN barcode on the back of a book, several books in a row if you like. In the browser you type or paste the ISBN, or search by title and author. A book no catalogue knows is entered by hand.",
      where: "Scanning on the phone. Search, ISBN and entry by hand on the phone and in the browser.",
    },
    {
      mark: "A 2",
      title: "%1$d catalogues",
      pages: 520,
      hardcover: true,
      text: "One search asks %1$d catalogues at once: Open Library, Google Books, Apple Books, lobid, the German National Library, K10plus and swisscovery. A book missing from one is usually in another, and what they know is put together into one record. Suggestions appear while you type.",
      where: "Phone and browser.",
    },
    {
      mark: "A 3",
      title: "Bring your lists",
      pages: 360,
      text: "Import your list from Goodreads, StoryGraph or any CSV file. A preview shows what was found before anything is saved. Books you already have are not added twice, they only gain what was missing.",
      where: "Phone and browser.",
    },
    {
      mark: "B 1",
      title: "Lists as shelves",
      pages: 520,
      text: "Five lists are built in: Wishlist, Unread, Reading, Read and Abandoned. Moving a book between them keeps its start and finish dates up to date. Every list of your own gets a shelf below them, also while it is still empty.",
      where: "Phone and browser.",
    },
    {
      mark: "B 2",
      title: "Three views",
      pages: 200,
      text: "Spines on wooden boards, covers facing out, or a plain list. A book without a cover picture gets a drawn cloth cover, so every book looks like a book. Sort by when a book was added, by title, by author or by rating.",
      where: "Phone and browser.",
    },
    {
      mark: "B 3",
      title: "Ornaments",
      pages: 420,
      hardcover: true,
      text: "%2$d things to stand between the books: a candle, a mug of tea, a clock that tells the time, a sleeping cat, a plant, a globe and more. The last book of a shelf that is not full leans on its neighbour.",
      where: "Phone and browser.",
    },
    {
      mark: "B 4",
      title: "Themes",
      pages: 150,
      text: "%3$d themes, %4$d of them dark and %5$d light, or one of your own built from four colours. If you would rather have nothing move, one switch turns all movement off.",
      where: "Phone and browser.",
    },
    {
      mark: "C 1",
      title: "Stars and spice",
      pages: 310,
      text: "Stars in half steps, a spice level from one to five chillies, and a review with the days you started and finished the book.",
      where: "Phone and browser.",
    },
    {
      mark: "C 2",
      title: "Sessions and timer",
      pages: 700,
      hardcover: true,
      text: "Log from which page to which you read, and for how long if you like. The book then shows your pace and an estimate of the time left. A stopwatch is there for those who want one.",
      where: "Phone and browser.",
    },
    {
      mark: "C 3",
      title: "Quotes and notes",
      pages: 460,
      hardcover: true,
      text: "Keep the passages you want to find again, with the page they are on. On the phone a quote can be photographed off the page, and the text recognition runs on the phone itself. In the browser a quote is typed or pasted.",
      where: "Quotes and notes on the phone and in the browser. Reading them off a page on the phone.",
    },
    {
      mark: "C 4",
      title: "Goals",
      pages: 120,
      text: "Books, pages or minutes, once or repeating every day, week, month or year. A goal says whether you are on track and what it takes to get there.",
      where: "Phone and browser.",
    },
    {
      mark: "C 5",
      title: "The reading year",
      pages: 480,
      text: "Statistics and reading streaks, a calendar with the covers of what you read each day, a recap of every month and year, and milestones for books, pages, sessions, hours, reviews, quotes, streaks and long books.",
      where: "Phone and browser.",
    },
    {
      mark: "C 6",
      title: "Purchases",
      pages: 240,
      text: "A purchase log per book: price, shop and date. The recaps add up what you spent.",
      where: "Phone and browser.",
    },
    {
      mark: "D 1",
      title: "Friends who borrow",
      pages: 700,
      hardcover: true,
      text: "Give a friend your code, or enter theirs, and you see each other's shelves. You choose what friends see: only what you own, or also your reading status, lists, ratings and reviews. A friend can ask to borrow a book. You say yes, with a day you would like it back by, or no. The two of you confirm when the book changes hands and when it is back, and while it is out it stands on your friend's shelf as borrowed.",
      where: "Phone and browser.",
    },
  ],
  twin: {
    title: "Move the candle in the browser. It has moved on the phone.",
    text: "These two shelves are one sample library, once as wide as a browser window and once as narrow as a phone. Change the view, the order or the ornaments on either one and the other follows. Your own library does the same once you are signed in: books, lists, ornaments, the theme, the view and the sort order belong to your account.",
    caption: "Here the other shelf follows at once. Between real devices a change arrives a few seconds later, or the next time the other device looks.",
    sample: "A sample library",
    browser: "In the browser",
    phone: "On the phone",
    view: "View",
    order: "Order",
    ornaments: "Ornaments",
    candleLeft: "Candle left",
    candleRight: "Candle right",
    catOn: "Add the cat",
    catOff: "Remove the cat",
    followedPhone: "Changed in the browser. The phone has followed.",
    followedBrowser: "Changed on the phone. The browser has followed.",
    plain: "With scripts switched on, two shelves stand here that follow each other.",
  },
  download: {
    title: "Shelfmark for Android",
    lead: "The app does everything on this page, and the camera work on top: scanning barcodes and reading quotes off a page.",
    button: "Download Shelfmark %1$s",
    buttonUnknown: "Download for Android",
    notes: [
      "This is a pre-release build, signed with the project's own key.",
      "It does not come from an app store. You open the downloaded file, and the phone asks once whether it may install from there.",
      "A newer version installs over the old one.",
    ],
    rows: { version: "Version", file: "File", needs: "Runs on", price: "Price", licence: "Licence" },
    versionValue: "%1$s, out since %2$s",
    versionUnknown: "The newest build is on the releases page.",
    fileValue: "%1$s, %2$s",
    fileUnknown: "An .apk file from the releases page",
    needsValue: "Android %1$s or newer",
    priceValue: "Free. No ads.",
    licenceValue: "MIT, open source",
    releases: "All versions and what changed in them",
    source: "Source code on GitHub",
    stamp: "Out since",
  },
  questions: {
    title: "Asked at the desk",
    items: [
      {
        q: "What does it cost?",
        a: "Nothing, and there are no ads. Shelfmark is open source under the MIT licence.",
        link: { label: "The code is on GitHub", href: REPOSITORY },
      },
      {
        q: "Do I need an account?",
        a: "On the phone, no. Without one your books simply stay on that phone, and you can sign in later, in the settings. One account is what puts the same shelf on every phone and in the browser, which is why the website asks you to sign in.",
      },
      {
        q: "Where is my library kept?",
        a: "With an account: on the server of this site, a Supabase project, where it is reached through your sign-in. Friends get what you choose to share with them. Without an account: on your phone and nowhere else.",
      },
      {
        q: "What happens when I delete my account?",
        a: "Everything of yours is removed from the server: your library, the cover photos you uploaded, what you shared with friends and your connections to them. A copy on a phone stays on that phone.",
      },
      {
        q: "Can the website do everything the app does?",
        a: "Nearly. It leaves to the phone what needs a phone: scanning a barcode and reading a quote off a page with the camera, zip backups with the cover photos in them, the library file of the desktop Shelfmark, and notifications when a friend writes.",
      },
      {
        q: "Is there an app for the iPhone?",
        a: "No. On an iPhone, as on any other device, the website does the job in the browser.",
      },
      {
        q: "Which languages does it speak?",
        a: "English and German, in the app and on the website.",
      },
    ],
  },
  footer: {
    line: "Shelfmark is free and open source.",
    top: "Back to the top shelf",
    source: "Source code",
    releases: "Releases",
    signIn: "Sign in",
  },
};

const de: LandingTexts = {
  meta: {
    title: "Shelfmark: ein Lesetagebuch, das wie ein Bücherregal aussieht",
    description: "Stell die Bücher, die du gelesen hast, gerade liest und noch lesen willst, auf Holzregale: auf dem Android-Handy und im Browser. Kostenlos, quelloffen, ohne Werbung.",
    imageAlt: "Buchrücken auf einem Holzregal im Lampenlicht",
  },
  nav: { signIn: "Anmelden", download: "Herunterladen", language: "Sprache", skip: "Zum Regal springen" },
  hero: {
    title: ["Was du liest,", "kommt ins Regal."],
    lead: "Shelfmark ist ein Lesetagebuch, das aussieht wie ein echtes Bücherregal. Scanne ein Buch, stell es ins Regal, bewerte es, und finde dasselbe Regal auf deinem Android-Handy und im Browser.",
    download: "Für Android herunterladen",
    downloadFacts: "Version %1$s, %2$s, ab Android %3$s",
    downloadFactsUnknown: "Ab Android %3$s",
    signIn: "Im Browser anmelden",
    note: "Eine Signatur, englisch «shelfmark», ist das Schild auf dem Rücken eines Bibliotheksbuchs, das sagt, wo es hingehört.",
  },
  shelf: {
    label: "Was Shelfmark kann, als Bücher im Regal",
    hint: "Nimm ein Buch aus dem Regal. Jedes steht für etwas, das Shelfmark kann.",
    plain: "Jede Karte unten steht für etwas, das Shelfmark kann.",
    cardsLabel: "Katalogkarten",
    mark: "Signatur",
    where: "Wo",
    counter: "Karte %1$d von %2$d",
    previous: "Vorherige Karte",
    next: "Nächste Karte",
  },
  features: [
    {
      mark: "A 1",
      title: "Barcode scannen",
      pages: 280,
      text: "Halte die Kamera des Handys auf den ISBN-Barcode hinten auf einem Buch, auch mehrere Bücher nacheinander. Im Browser tippst du die ISBN ein oder fügst sie ein, oder du suchst nach Titel und Autor. Ein Buch, das kein Katalog kennt, gibst du von Hand ein.",
      where: "Scannen auf dem Handy. Suche, ISBN und Eingabe von Hand auf dem Handy und im Browser.",
    },
    {
      mark: "A 2",
      title: "%1$d Kataloge",
      pages: 520,
      hardcover: true,
      text: "Eine Suche fragt %1$d Kataloge gleichzeitig: Open Library, Google Books, Apple Books, lobid, die Deutsche Nationalbibliothek, K10plus und swisscovery. Was in einem fehlt, steht meist in einem anderen, und was sie wissen, wird zu einem Eintrag zusammengefügt. Vorschläge erscheinen schon beim Tippen.",
      where: "Handy und Browser.",
    },
    {
      mark: "A 3",
      title: "Listen mitbringen",
      pages: 360,
      text: "Importiere deine Liste aus Goodreads, StoryGraph oder einer beliebigen CSV-Datei. Eine Vorschau zeigt, was gefunden wurde, bevor etwas gespeichert wird. Bücher, die du schon hast, kommen nicht doppelt hinein, sie bekommen nur, was ihnen fehlte.",
      where: "Handy und Browser.",
    },
    {
      mark: "B 1",
      title: "Listen als Regale",
      pages: 520,
      text: "Fünf Listen sind schon da: Wunschliste, Ungelesen, Am Lesen, Gelesen und Abgebrochen. Wandert ein Buch von einer zur anderen, stimmen Start- und Enddatum von selbst. Jede eigene Liste bekommt darunter ein Regal, auch solange sie noch leer ist.",
      where: "Handy und Browser.",
    },
    {
      mark: "B 2",
      title: "Drei Ansichten",
      pages: 200,
      text: "Buchrücken auf Holzbrettern, Cover nach vorn, oder eine schlichte Liste. Ein Buch ohne Coverbild bekommt einen gezeichneten Leineneinband, damit jedes Buch wie ein Buch aussieht. Sortiert wird danach, wann ein Buch dazukam, nach Titel, nach Autor oder nach Bewertung.",
      where: "Handy und Browser.",
    },
    {
      mark: "B 3",
      title: "Dekoration",
      pages: 420,
      hardcover: true,
      text: "%2$d Dinge, die zwischen den Büchern stehen können: eine Kerze, eine Tasse Tee, eine Uhr, die die Zeit zeigt, eine schlafende Katze, eine Pflanze, ein Globus und mehr. Das letzte Buch eines Regals, das nicht voll ist, lehnt sich an seinen Nachbarn.",
      where: "Handy und Browser.",
    },
    {
      mark: "B 4",
      title: "Designs",
      pages: 150,
      text: "%3$d Designs, %4$d davon dunkel und %5$d hell, oder ein eigenes aus vier Farben. Wer lieber nichts in Bewegung sieht, stellt mit einem Schalter alle Bewegung ab.",
      where: "Handy und Browser.",
    },
    {
      mark: "C 1",
      title: "Sterne und Spice",
      pages: 310,
      text: "Sterne in halben Schritten, ein Spice-Level von einer bis fünf Chilis, und eine Rezension mit den Tagen, an denen du das Buch begonnen und beendet hast.",
      where: "Handy und Browser.",
    },
    {
      mark: "C 2",
      title: "Sitzungen und Timer",
      pages: 700,
      hardcover: true,
      text: "Halte fest, von welcher Seite bis zu welcher du gelesen hast, und wie lange, wenn du magst. Das Buch zeigt dann dein Tempo und eine Schätzung der Zeit, die noch bleibt. Für alle, die eine wollen, gibt es eine Stoppuhr.",
      where: "Handy und Browser.",
    },
    {
      mark: "C 3",
      title: "Zitate und Notizen",
      pages: 460,
      hardcover: true,
      text: "Bewahre die Stellen auf, die du wiederfinden willst, mit der Seite, auf der sie stehen. Auf dem Handy lässt sich ein Zitat von der Seite abfotografieren, und die Texterkennung läuft auf dem Handy selbst. Im Browser wird ein Zitat getippt oder eingefügt.",
      where: "Zitate und Notizen auf dem Handy und im Browser. Von der Seite ablesen auf dem Handy.",
    },
    {
      mark: "C 4",
      title: "Ziele",
      pages: 120,
      text: "Bücher, Seiten oder Minuten, einmalig oder wiederkehrend jeden Tag, jede Woche, jeden Monat oder jedes Jahr. Ein Ziel sagt, ob du im Plan bist und was es braucht, um anzukommen.",
      where: "Handy und Browser.",
    },
    {
      mark: "C 5",
      title: "Das Lesejahr",
      pages: 480,
      text: "Statistik und Lesesträhnen, ein Kalender mit den Covern dessen, was du an jedem Tag gelesen hast, ein Rückblick auf jeden Monat und jedes Jahr, und Meilensteine für Bücher, Seiten, Sitzungen, Stunden, Rezensionen, Zitate, Strähnen und dicke Bücher.",
      where: "Handy und Browser.",
    },
    {
      mark: "C 6",
      title: "Käufe",
      pages: 240,
      text: "Ein Kaufprotokoll pro Buch: Preis, Laden und Datum. Die Rückblicke rechnen zusammen, was du ausgegeben hast.",
      where: "Handy und Browser.",
    },
    {
      mark: "D 1",
      title: "Freunde und Ausleihe",
      pages: 700,
      hardcover: true,
      text: "Gib jemandem deinen Code oder gib einen Code ein, den du bekommen hast, und ihr seht gegenseitig eure Regale. Du bestimmst, was Freunde sehen: nur, was du besitzt, oder auch Lesestatus, Listen, Bewertungen und Rezensionen. Wer mit dir befreundet ist, kann fragen, ob ein Buch auszuleihen ist. Du sagst Ja, mit einem Tag, bis zu dem du es zurückhaben möchtest, oder Nein. Übergabe und Rückgabe bestätigt ihr beide, und solange das Buch unterwegs ist, steht es im Regal der Person, die es hat, als ausgeliehen.",
      where: "Handy und Browser.",
    },
  ],
  twin: {
    title: "Verschieb die Kerze im Browser. Auf dem Handy steht sie schon dort.",
    text: "Diese zwei Regale sind eine Beispielbibliothek, einmal so breit wie ein Browserfenster und einmal so schmal wie ein Handy. Ändere auf einem die Ansicht, die Reihenfolge oder die Dekoration, und das andere zieht nach. Deine eigene Bibliothek macht dasselbe, sobald du angemeldet bist: Bücher, Listen, Dekoration, Design, Ansicht und Sortierung gehören zu deinem Konto.",
    caption: "Hier zieht das andere Regal sofort nach. Zwischen echten Geräten kommt eine Änderung ein paar Sekunden später an, oder wenn das andere Gerät das nächste Mal nachsieht.",
    sample: "Eine Beispielbibliothek",
    browser: "Im Browser",
    phone: "Auf dem Handy",
    view: "Ansicht",
    order: "Sortierung",
    ornaments: "Dekoration",
    candleLeft: "Kerze nach links",
    candleRight: "Kerze nach rechts",
    catOn: "Katze dazu",
    catOff: "Katze weg",
    followedPhone: "Im Browser geändert. Das Handy ist nachgezogen.",
    followedBrowser: "Auf dem Handy geändert. Der Browser ist nachgezogen.",
    plain: "Mit eingeschalteten Skripten stehen hier zwei Regale, die einander folgen.",
  },
  download: {
    title: "Shelfmark für Android",
    lead: "Die App kann alles auf dieser Seite, und dazu, was eine Kamera braucht: Barcodes scannen und Zitate von einer Seite ablesen.",
    button: "Shelfmark %1$s herunterladen",
    buttonUnknown: "Für Android herunterladen",
    notes: [
      "Das ist eine Vorabversion, signiert mit dem eigenen Schlüssel des Projekts.",
      "Sie kommt nicht aus einem App Store. Du öffnest die heruntergeladene Datei, und das Handy fragt einmal, ob es von dort installieren darf.",
      "Eine neuere Version wird über die alte installiert.",
    ],
    rows: { version: "Version", file: "Datei", needs: "Läuft auf", price: "Preis", licence: "Lizenz" },
    versionValue: "%1$s, erschienen am %2$s",
    versionUnknown: "Die neuste Version steht auf der Seite mit den Veröffentlichungen.",
    fileValue: "%1$s, %2$s",
    fileUnknown: "Eine .apk-Datei von der Seite mit den Veröffentlichungen",
    needsValue: "Android %1$s oder neuer",
    priceValue: "Kostenlos. Keine Werbung.",
    licenceValue: "MIT, quelloffen",
    releases: "Alle Versionen und was sich darin geändert hat",
    source: "Quellcode auf GitHub",
    stamp: "Erschienen",
  },
  questions: {
    title: "An der Theke gefragt",
    items: [
      {
        q: "Was kostet das?",
        a: "Nichts, und Werbung gibt es keine. Shelfmark ist quelloffen und steht unter der MIT-Lizenz.",
        link: { label: "Der Code liegt auf GitHub", href: REPOSITORY },
      },
      {
        q: "Brauche ich ein Konto?",
        a: "Auf dem Handy nicht. Ohne Konto bleiben deine Bücher einfach auf diesem Handy, und anmelden kannst du dich später, in den Einstellungen. Ein Konto ist das, was dasselbe Regal auf jedes Handy und in den Browser bringt. Darum fragt die Website nach einer Anmeldung.",
      },
      {
        q: "Wo liegt meine Bibliothek?",
        a: "Mit Konto: auf dem Server dieser Website, einem Supabase-Projekt, wo sie über deine Anmeldung erreicht wird. Freunde bekommen, was du mit ihnen teilen willst. Ohne Konto: auf deinem Handy und sonst nirgends.",
      },
      {
        q: "Was passiert, wenn ich mein Konto lösche?",
        a: "Alles von dir wird vom Server entfernt: deine Bibliothek, die Coverfotos, die du hochgeladen hast, was du mit Freunden geteilt hast und deine Verbindungen zu ihnen. Eine Kopie auf einem Handy bleibt auf diesem Handy.",
      },
      {
        q: "Kann die Website alles, was die App kann?",
        a: "Fast. Sie überlässt dem Handy, was ein Handy braucht: einen Barcode scannen und ein Zitat mit der Kamera von einer Seite ablesen, Zip-Backups mit den Coverfotos darin, die Bibliotheksdatei des Desktop-Shelfmark, und Benachrichtigungen, wenn Freunde schreiben.",
      },
      {
        q: "Gibt es eine App für das iPhone?",
        a: "Nein. Auf einem iPhone erledigt das, wie auf jedem anderen Gerät, die Website im Browser.",
      },
      {
        q: "Welche Sprachen spricht es?",
        a: "Deutsch und Englisch, in der App und auf der Website.",
      },
    ],
  },
  footer: {
    line: "Shelfmark ist kostenlos und quelloffen.",
    top: "Zurück zum obersten Regal",
    source: "Quellcode",
    releases: "Veröffentlichungen",
    signIn: "Anmelden",
  },
};

export const LANDING: Record<Lang, LandingTexts> = { en, de };
