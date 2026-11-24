// The imprint and the privacy notice, in English and German. Like the front page they
// are drawn by the server and read without scripts.
//
// The privacy notice says only what the code does. Whoever changes what is stored, sent
// or kept in the browser changes the sentence about it here, in both languages, and the
// date in lib/legal.ts.
//
// A text can carry marks in curly brackets, which the page turns into links or numbers:
// {email} the address of whoever runs the site, {repository} the address of the code,
// {count} the number of catalogues a search asks, and {privacy|words} or
// {imprint|words} a link to the other page with those words on it.

import type { Lang } from "./index.ts";

export type Block =
  /** A paragraph. */
  | { p: string }
  /** Points, one after the other. */
  | { list: string[] }
  /** Name, postal address and e-mail address of whoever runs the site, as far as they are filled in. */
  | { operator: true };

export interface Section {
  /** Stays the same in every language, so that a link to a section survives the language switch. */
  id: string;
  /** The question the section answers. */
  title: string;
  blocks: Block[];
}

export interface LegalPage {
  title: string;
  /** The title as the headline sets it: a long word may carry a place where it can break. */
  heading: string;
  /** For search engines and link previews. */
  description: string;
  lead: string;
  sections: Section[];
}

export interface LegalTexts {
  nav: { language: string; skip: string; home: string; contents: string; top: string };
  /** "%1$s" is the day. */
  asOf: string;
  /** What stands before the e-mail address. */
  email: string;
  imprint: LegalPage;
  privacy: LegalPage;
}

// A place where a word may break when the line is too short for it. Nothing is shown unless it breaks there.
const BREAK = String.fromCharCode(0xad);

const en: LegalTexts = {
  nav: { language: "Language", skip: "Skip to the text", home: "To the front page", contents: "On this page", top: "Back to the top" },
  asOf: "As of %1$s",
  email: "E-mail",
  imprint: {
    title: "Imprint",
    heading: "Imprint",
    description: "Who is behind Shelfmark, how to reach them, and where the book data comes from.",
    lead: "Who is behind Shelfmark, and how to reach them.",
    sections: [
      {
        id: "what",
        title: "What Shelfmark is",
        blocks: [
          {
            p: "Shelfmark is a reading tracker: an Android app and this website, for keeping a personal library on a shelf. It is a private, non-commercial project and open source under the MIT licence. The code is public: {repository}.",
          },
        ],
      },
      {
        id: "contact",
        title: "Contact",
        blocks: [{ operator: true }, { p: "Questions, corrections and complaints go to this address." }],
      },
      {
        id: "content",
        title: "Who answers for the content",
        blocks: [{ p: "Whoever is named under Contact answers for what this website says." }],
      },
      {
        id: "books",
        title: "Book data and covers",
        blocks: [
          {
            p: "Titles, authors, descriptions and cover pictures are not Shelfmark's own. They come from the catalogues it asks: Open Library, Google Books, Apple Books, lobid, the German National Library, K10plus and swisscovery. What they say can be incomplete or wrong, and Shelfmark passes it on as it comes.",
          },
        ],
      },
      {
        id: "data",
        title: "Your data",
        blocks: [{ p: "What happens to your data is in the {privacy|privacy notice}." }],
      },
    ],
  },
  privacy: {
    title: "Privacy notice",
    heading: "Privacy notice",
    description: "What the Shelfmark app and website store, where it goes, who can see it, and how to delete it. In plain words.",
    lead: "What Shelfmark does with data, in plain words. This page follows the questions people usually have, and says only what the app and the website really do.",
    sections: [
      {
        id: "who",
        title: "Who answers for my data?",
        blocks: [
          { p: "Shelfmark is a private, non-commercial project. Whoever runs this website and the server behind it answers for the data, and this is how to reach them:" },
          { operator: true },
          { p: "Write there with any question about your data." },
        ],
      },
      {
        id: "visit",
        title: "What happens when I just look at this website?",
        blocks: [
          {
            p: "The website is hosted by Vercel (Vercel Inc., USA). Like any web server, Vercel's servers see what your browser sends with every request: your IP address, the time, the address you asked for, and what the browser says about itself.",
          },
          {
            p: "Shelfmark itself sets no cookies. It has no analytics, no advertising and no trackers, and its pages keep no record of who visited. The fonts come from the website itself, not from another company's server.",
          },
          {
            p: "As long as you are not signed in, your browser talks to nobody but this website. The one exception is the download of the app: that button passes you on to GitHub, as described further down.",
          },
        ],
      },
      {
        id: "browser",
        title: "What does the website keep in my browser?",
        blocks: [
          { p: "No cookies, but a few entries in the storage your browser keeps for this website (local storage). They stay there until you clear the website's data in your browser:" },
          {
            list: [
              "the language you chose;",
              "once you are signed in: the sign-in itself, which holds your e-mail address and the keys that prove to the server who you are. Signing out removes it;",
              "the day of the last sign of life. Once a day the browser of a signed-in reader sends one to Shelfmark's database: a free database is put to sleep when nothing happens for a week. It writes down the time, adds one to a counter and says nothing about you;",
              "your theme and its colours, so that the page does not open in other colours first;",
              "a reading timer that is running, so that it survives a closed window. Signing out removes it;",
              "how each of your loans stood when this browser last looked, and when that was, so that it can tell you what is new. Signing out removes it, and so does deleting the account;",
              "a copy of what you last shared with friends, so that the same shelf is not sent twice. Signing out removes it, and so does deleting the account;",
              "the name you typed in when creating an account, kept under your e-mail address until your first sign-in puts it into your library.",
            ],
          },
          { p: "For the length of one visit the website may also note a single word for the next page, for example that an account was just deleted. It is gone once that page has read it." },
        ],
      },
      {
        id: "account",
        title: "What is stored when I have an account?",
        blocks: [
          { p: "An account is optional in the app and needed for the website. With one, the following is kept on the server:" },
          {
            list: [
              "Your e-mail address and your password. Signing in is done by the sign-in service of Supabase. According to Supabase the password is kept there in hashed form only. Shelfmark's own code passes it on when you type it and never stores it.",
              "A name, if you give one, and a friend code that is made for you. Also the time the account was set up, and the time it was last in touch with the server.",
              "Your whole library, as one document that only you get: books with your ratings, reviews and reading dates, lists, notes, quotes, reading sessions, goals, purchases with price and shop, the ornaments on your shelf, your themes and your settings.",
              "Cover photos you upload. They are kept as files, and a picture can be loaded by anybody who has its full address, without signing in. That is how friends get to see the covers on a shared shelf. The address is long and random, so it cannot be guessed. A picture is removed when its book is deleted or gets another cover, unless another book of yours still shows it.",
            ],
          },
          {
            p: "Database, sign-in and file storage are one project at Supabase (Supabase Inc., USA). The tables cannot be reached from outside. The app and the website can only call a fixed set of functions, and each of them acts for the signed-in account and for nobody else.",
          },
        ],
      },
      {
        id: "friends",
        title: "What do friends see?",
        blocks: [
          {
            p: "Whoever enters your friend code is connected with you at once, in both directions. There is no step in which you accept. So give the code only to people you want as friends. You can get a new code at any time, which makes the old one useless, and you can remove a friend.",
          },
          {
            p: "Friends see your name and the part of your library you share: your books with title, author, ISBN, cover, description, format and number of pages, whether you own them and whether they can be borrowed. Reading status and lists are included only if you switch that on, and so are ratings, reviews and reading dates. Books you do not own are shared only together with the reading status. Notes, quotes, reading sessions, goals and purchases are never shared.",
          },
        ],
      },
      {
        id: "loans",
        title: "What is kept when I lend or borrow a book?",
        blocks: [
          {
            p: "A loan between you and a friend is one record on the server that the two of you read, and nobody else: who lends and who borrows, the title, author, ISBN, cover address, number of pages and format of the book as the borrower saw them when asking, the note that came with the question, the day the book is wanted back by, the moment of each step (asked, yes, handed over, received, given back, closed), and the reason given with a no.",
          },
          {
            p: "While a book is out, it also stands in the borrower's own library, as borrowed from the lender by name, and the lender's copy carries the borrower's name. After the return the lender's copy is at home again. The borrower's copy stays in their library as read and not theirs, still with the lender's name on it, until they delete it.",
          },
          {
            p: "A loan that is over can be put away by each of you. Once both have done so, the record is deleted the next time the daily sign of life arrives. It is deleted as well when one of the two accounts is deleted. A loan that is still running stays until it has ended. Removing a friend deletes no loan: questions nobody answered yet end with it, and a book that is reserved or out stays a loan until it is back.",
          },
        ],
      },
      {
        id: "mail",
        title: "Which mails will I get?",
        blocks: [
          {
            p: "Two kinds, and only when you cause them: one to confirm your e-mail address when you create an account, and one with a link for a new password when you ask for it. Both are sent by the sign-in service of Supabase. Shelfmark sends no newsletter and no other mail.",
          },
        ],
      },
      {
        id: "lookup",
        title: "What happens when I look up a book?",
        blocks: [
          {
            p: "On the website, a search or an ISBN goes to the website's own server first and from there to {count} catalogues: Open Library, Google Books, Apple Books, lobid, the German National Library, K10plus and swisscovery. They get what you searched for, the language, and in the case of Apple Books the country your browser names. They do not get your IP address: the question reaches them from the website's server.",
          },
          {
            p: "Cover pictures are a different matter. Your browser loads them straight from wherever the catalogue keeps them, so those servers see your IP address, and they could set cookies of their own. The website tells the browser not to say which page the picture is for.",
          },
          {
            p: "The download of the app comes from GitHub (GitHub Inc., USA). The button on this website passes you on to the file there, and from then on you are dealing with GitHub's servers.",
          },
        ],
      },
      {
        id: "app",
        title: "What about the Android app?",
        blocks: [
          { p: "Without an account, your library stays on the phone. With an account, the app keeps it in step with the server, and everything under “What is stored when I have an account?” applies." },
          {
            list: [
              "The app asks the same catalogues, but directly from the phone, and loads cover pictures from them. So they see the phone's IP address and what you searched for.",
              "The camera is used to read a barcode, to read a quote off a page, and to photograph a cover. Barcodes and text are read on the phone, and those pictures are not sent anywhere. Reading text uses Google's ML Kit, which is built into the app. According to Google, ML Kit sends usage and diagnostic figures about itself to Google. A photographed cover is uploaded if you have an account, as described above.",
              "About once a day the app sends a short sign of life to the server, with or without an account, so that the free database is not put to sleep. It carries nothing about you.",
              "Notifications are made on the phone itself. No push service is involved.",
            ],
          },
        ],
      },
      {
        id: "abroad",
        title: "Does my data leave Switzerland or the EU?",
        blocks: [
          { p: "Yes, it can. Vercel, Supabase and GitHub are companies based in the USA, and what they handle for Shelfmark can be processed there." },
          { p: "This notice promises no particular safeguard for that. If it matters to you: the app works without an account, and then your library does not leave the phone." },
        ],
      },
      {
        id: "delete",
        title: "How long is it kept, and how do I delete it?",
        blocks: [
          { p: "Your account and your library are kept until you delete the account. There is no time limit after which they go by themselves." },
          {
            p: "Deleting the account, in the app or in the settings of the website, removes your library, every cover photo you uploaded, what you shared with friends, your loans, your connections to friends, and the sign-in itself. Should the server not let the sign-in be removed along with the rest, the website tells you so. Should a cover photo not let itself be removed, with its book or with the account, nothing tells you: it stays on the server, and nothing points at it any more. Whoever runs the server can remove both by hand: write to the address above.",
          },
          { p: "A copy of your library on a phone stays on that phone until you remove it there. So does what a friend's own library says about a book they lent to you or borrowed from you: your name on that book stays with them." },
          { p: "The backup in the settings is the export of your own data: one file with all of it." },
        ],
      },
      {
        id: "rights",
        title: "What are my rights?",
        blocks: [
          {
            p: "You can ask what is stored about you, have it corrected or deleted, and get it as a file. Much of that you can do yourself: you can change everything in your library, the backup is the file, and deleting the account deletes it. For anything else, write to {email}.",
          },
          {
            p: "You can also complain to a data protection authority: in Switzerland the Federal Data Protection and Information Commissioner (FDPIC), in the EU the authority of your country. The laws behind these rights are the Swiss Federal Act on Data Protection and the General Data Protection Regulation of the EU (GDPR).",
          },
        ],
      },
    ],
  },
};

const de: LegalTexts = {
  nav: { language: "Sprache", skip: "Zum Text springen", home: "Zur Startseite", contents: "Auf dieser Seite", top: "Zurück nach oben" },
  asOf: "Stand: %1$s",
  email: "E-Mail",
  imprint: {
    title: "Impressum",
    heading: "Impressum",
    description: "Wer hinter Shelfmark steht, wie diese Person zu erreichen ist und woher die Buchdaten kommen.",
    lead: "Wer hinter Shelfmark steht, und wie diese Person zu erreichen ist.",
    sections: [
      {
        id: "what",
        title: "Was Shelfmark ist",
        blocks: [
          {
            p: "Shelfmark ist ein Lesetagebuch: eine Android-App und diese Website, mit denen man die eigene Bibliothek auf ein Regal stellt. Es ist ein privates, nicht kommerzielles Projekt und Open Source unter der MIT-Lizenz. Der Code ist öffentlich: {repository}.",
          },
        ],
      },
      {
        id: "contact",
        title: "Kontakt",
        blocks: [{ operator: true }, { p: "Fragen, Korrekturen und Beschwerden gehen an diese Adresse." }],
      },
      {
        id: "content",
        title: "Verantwortlich für den Inhalt",
        blocks: [{ p: "Für das, was auf dieser Website steht, ist verantwortlich, wer unter Kontakt genannt ist." }],
      },
      {
        id: "books",
        title: "Buchdaten und Cover",
        blocks: [
          {
            p: "Titel, Autoren, Beschreibungen und Cover-Bilder stammen nicht von Shelfmark, sondern aus den Katalogen, die es befragt: Open Library, Google Books, Apple Books, lobid, Deutsche Nationalbibliothek, K10plus und swisscovery. Was sie liefern, kann unvollständig oder falsch sein, und Shelfmark gibt es so weiter, wie es kommt.",
          },
        ],
      },
      {
        id: "data",
        title: "Deine Daten",
        blocks: [{ p: "Was mit deinen Daten geschieht, steht in der {privacy|Datenschutzerklärung}." }],
      },
    ],
  },
  privacy: {
    title: "Datenschutzerklärung",
    heading: `Datenschutz${BREAK}erklärung`,
    description: "Was die App und die Website von Shelfmark speichern, wohin es geht, wer es sehen kann und wie man es löscht. In einfachen Worten.",
    lead: "Was Shelfmark mit Daten macht, in einfachen Worten. Diese Seite folgt den Fragen, die man sich dazu meistens stellt, und sagt nur, was App und Website wirklich tun.",
    sections: [
      {
        id: "who",
        title: "Wer ist für meine Daten verantwortlich?",
        blocks: [
          { p: "Shelfmark ist ein privates, nicht kommerzielles Projekt. Verantwortlich für die Daten ist, wer diese Website und den Server dahinter betreibt. So ist diese Person zu erreichen:" },
          { operator: true },
          { p: "Schreib dorthin, wenn du eine Frage zu deinen Daten hast." },
        ],
      },
      {
        id: "visit",
        title: "Was passiert, wenn ich mir die Website nur ansehe?",
        blocks: [
          {
            p: "Die Website liegt bei Vercel (Vercel Inc., USA). Wie jeder Webserver sehen die Server von Vercel, was dein Browser bei jeder Anfrage mitschickt: deine IP-Adresse, die Uhrzeit, die aufgerufene Adresse und was der Browser über sich sagt.",
          },
          {
            p: "Shelfmark selbst setzt keine Cookies. Es gibt keine Analyse, keine Werbung und keine Tracker, und die Seiten führen nicht Buch darüber, wer sie besucht hat. Die Schriften kommen von der Website selbst, nicht vom Server einer anderen Firma.",
          },
          {
            p: "Solange du nicht angemeldet bist, spricht dein Browser mit niemandem ausser dieser Website. Die eine Ausnahme ist der Download der App: Dieser Knopf reicht dich an GitHub weiter, wie weiter unten beschrieben.",
          },
        ],
      },
      {
        id: "browser",
        title: "Was legt die Website in meinem Browser ab?",
        blocks: [
          { p: "Keine Cookies, aber ein paar Einträge im Speicher, den dein Browser für diese Website führt (Local Storage). Sie bleiben dort, bis du die Daten der Website im Browser löschst:" },
          {
            list: [
              "die Sprache, die du gewählt hast;",
              "sobald du angemeldet bist: die Anmeldung selbst, mit deiner E-Mail-Adresse und den Schlüsseln, die dem Server beweisen, wer du bist. Beim Abmelden wird sie entfernt;",
              "den Tag des letzten Lebenszeichens. Einmal am Tag schickt der Browser einer angemeldeten Person eines an die Datenbank von Shelfmark: Eine kostenlose Datenbank wird schlafen gelegt, wenn eine Woche lang nichts passiert. Es schreibt die Uhrzeit auf, zählt einen Zähler um eins hoch und sagt nichts über dich;",
              "dein Design und seine Farben, damit die Seite nicht zuerst in anderen Farben aufgeht;",
              "einen laufenden Lese-Timer, damit er ein geschlossenes Fenster übersteht. Beim Abmelden wird er entfernt;",
              "wie jede deiner Ausleihen stand, als dieser Browser zuletzt nachgesehen hat, und wann das war, damit er dir sagen kann, was neu ist. Beim Abmelden wird das entfernt, beim Löschen des Kontos ebenso;",
              "eine Kopie dessen, was du zuletzt mit Freunden geteilt hast, damit dasselbe Regal nicht zweimal gesendet wird. Beim Abmelden wird sie entfernt, beim Löschen des Kontos ebenso;",
              "den Namen, den du beim Erstellen des Kontos eingetippt hast, abgelegt unter deiner E-Mail-Adresse, bis ihn die erste Anmeldung in deine Bibliothek schreibt.",
            ],
          },
          { p: "Für die Dauer eines Besuchs merkt sich die Website manchmal ein einzelnes Wort für die nächste Seite, zum Beispiel dass gerade ein Konto gelöscht wurde. Es ist weg, sobald diese Seite es gelesen hat." },
        ],
      },
      {
        id: "account",
        title: "Was wird gespeichert, wenn ich ein Konto habe?",
        blocks: [
          { p: "In der App ist ein Konto freiwillig, für die Website braucht es eines. Mit Konto liegt Folgendes auf dem Server:" },
          {
            list: [
              "Deine E-Mail-Adresse und dein Passwort. Die Anmeldung läuft über den Anmeldedienst von Supabase. Laut Supabase liegt das Passwort dort nur als Hash vor. Der Code von Shelfmark reicht es beim Eintippen weiter und speichert es nie.",
              "Ein Name, wenn du einen angibst, und ein Freundescode, der für dich erzeugt wird. Dazu der Zeitpunkt, an dem das Konto eingerichtet wurde, und der Zeitpunkt des letzten Kontakts mit dem Server.",
              "Deine ganze Bibliothek als ein Dokument, das nur du bekommst: Bücher mit deinen Bewertungen, Rezensionen und Lesedaten, Listen, Notizen, Zitate, Lesesitzungen, Ziele, Käufe mit Preis und Laden, die Deko auf deinem Regal, deine Designs und deine Einstellungen.",
              "Cover-Fotos, die du hochlädst. Sie liegen als Dateien vor, und ein Bild kann laden, wer seine vollständige Adresse hat, ohne Anmeldung. So sehen Freunde die Cover eines geteilten Regals. Die Adresse ist lang und zufällig, erraten lässt sie sich nicht. Ein Bild wird entfernt, wenn sein Buch gelöscht wird oder ein anderes Cover bekommt, es sei denn, ein anderes deiner Bücher zeigt es noch.",
            ],
          },
          {
            p: "Datenbank, Anmeldung und Dateiablage sind ein Projekt bei Supabase (Supabase Inc., USA). Die Tabellen sind von aussen nicht erreichbar. App und Website können nur eine feste Reihe von Funktionen aufrufen, und jede davon handelt für das angemeldete Konto und für niemanden sonst.",
          },
        ],
      },
      {
        id: "friends",
        title: "Was sehen Freunde?",
        blocks: [
          {
            p: "Wer deinen Freundescode eingibt, ist sofort mit dir verbunden, in beide Richtungen. Einen Schritt, in dem du zustimmst, gibt es nicht. Gib den Code also nur Leuten, die du als Freunde haben willst. Du kannst jederzeit einen neuen Code holen, der alte gilt dann nicht mehr, und du kannst Freunde entfernen.",
          },
          {
            p: "Freunde sehen deinen Namen und den Teil deiner Bibliothek, den du teilst: deine Bücher mit Titel, Autor, ISBN, Cover, Beschreibung, Format und Seitenzahl, ob sie dir gehören und ob man sie ausleihen kann. Lesestatus und Listen sind nur dabei, wenn du das einschaltest, ebenso Bewertungen, Rezensionen und Lesedaten. Bücher, die dir nicht gehören, werden nur zusammen mit dem Lesestatus geteilt. Notizen, Zitate, Lesesitzungen, Ziele und Käufe werden nie geteilt.",
          },
        ],
      },
      {
        id: "loans",
        title: "Was wird gespeichert, wenn ich ein Buch verleihe oder ausleihe?",
        blocks: [
          {
            p: "Eine Ausleihe zwischen dir und jemandem, mit dem du befreundet bist, ist ein Eintrag auf dem Server, den ihr beide lest und sonst niemand: wer verleiht und wer ausleiht, Titel, Autor, ISBN, Cover-Adresse, Seitenzahl und Format des Buchs, so wie sie beim Fragen zu sehen waren, die Nachricht, die mit der Frage kam, der Tag, bis zu dem das Buch zurück sein soll, der Zeitpunkt jedes Schritts (gefragt, zugesagt, übergeben, erhalten, zurückgegeben, abgeschlossen) und der Grund, der mit einem Nein genannt wurde.",
          },
          {
            p: "Solange ein Buch unterwegs ist, steht es auch in der eigenen Bibliothek der Person, die es ausleiht: als ausgeliehen, mit dem Namen der Person, die es verleiht. Deren Exemplar trägt so lange den Namen der Person, die es hat. Nach der Rückgabe steht das verliehene Exemplar wieder zu Hause. Das ausgeliehene bleibt in der anderen Bibliothek stehen, als gelesen und nicht das eigene, weiterhin mit dem Namen darauf, bis es dort gelöscht wird.",
          },
          {
            p: "Eine beendete Ausleihe kann jede der beiden Seiten weglegen. Haben das beide getan, wird der Eintrag gelöscht, sobald das nächste tägliche Lebenszeichen eintrifft. Gelöscht wird er auch, wenn eines der beiden Konten gelöscht wird. Eine laufende Ausleihe bleibt, bis sie beendet ist. Wer eine Freundschaft beendet, löscht damit keine Ausleihe: Fragen, auf die noch niemand geantwortet hat, enden damit, und ein Buch, das reserviert oder unterwegs ist, bleibt eine Ausleihe, bis es zurück ist.",
          },
        ],
      },
      {
        id: "mail",
        title: "Welche Mails bekomme ich?",
        blocks: [
          {
            p: "Zwei Arten, und nur, wenn du sie auslöst: eine zur Bestätigung deiner E-Mail-Adresse, wenn du ein Konto erstellst, und eine mit einem Link für ein neues Passwort, wenn du danach fragst. Beide verschickt der Anmeldedienst von Supabase. Einen Newsletter oder andere Mails gibt es von Shelfmark nicht.",
          },
        ],
      },
      {
        id: "lookup",
        title: "Was passiert, wenn ich ein Buch nachschlage?",
        blocks: [
          {
            p: "Auf der Website geht eine Suche oder eine ISBN zuerst an den eigenen Server der Website und von dort an {count} Kataloge: Open Library, Google Books, Apple Books, lobid, Deutsche Nationalbibliothek, K10plus und swisscovery. Sie erfahren, wonach du gesucht hast, die Sprache und bei Apple Books das Land, das dein Browser nennt. Deine IP-Adresse erfahren sie nicht: Die Frage kommt bei ihnen vom Server der Website an.",
          },
          {
            p: "Bei Cover-Bildern ist es anders. Dein Browser lädt sie direkt von dort, wo der Katalog sie bereithält. Diese Server sehen deine IP-Adresse und könnten eigene Cookies setzen. Die Website weist den Browser an, nicht mitzuteilen, für welche Seite das Bild ist.",
          },
          {
            p: "Der Download der App kommt von GitHub (GitHub Inc., USA). Der Knopf auf dieser Website leitet dich zur Datei dort weiter, und ab dann hast du es mit den Servern von GitHub zu tun.",
          },
        ],
      },
      {
        id: "app",
        title: "Und die Android-App?",
        blocks: [
          { p: "Ohne Konto bleibt deine Bibliothek auf dem Handy. Mit Konto hält die App sie mit dem Server im Gleichschritt, und es gilt alles unter «Was wird gespeichert, wenn ich ein Konto habe?»." },
          {
            list: [
              "Die App fragt dieselben Kataloge, aber direkt vom Handy aus, und lädt Cover-Bilder von ihnen. Sie sehen also die IP-Adresse des Handys und wonach du gesucht hast.",
              "Die Kamera wird gebraucht, um einen Strichcode zu lesen, ein Zitat von einer Buchseite abzulesen und ein Cover zu fotografieren. Strichcodes und Text werden auf dem Handy gelesen, und diese Bilder werden nirgendwohin gesendet. Für das Lesen von Text nutzt die App das ML Kit von Google, das in die App eingebaut ist. Laut Google sendet das ML Kit Nutzungs- und Diagnosezahlen über sich selbst an Google. Ein fotografiertes Cover wird hochgeladen, wenn du ein Konto hast, wie oben beschrieben.",
              "Etwa einmal am Tag schickt die App ein kurzes Lebenszeichen an den Server, mit oder ohne Konto, damit die kostenlose Datenbank nicht schlafen gelegt wird. Es enthält nichts über dich.",
              "Benachrichtigungen entstehen auf dem Handy selbst. Ein Push-Dienst ist nicht beteiligt.",
            ],
          },
        ],
      },
      {
        id: "abroad",
        title: "Verlassen meine Daten die Schweiz oder die EU?",
        blocks: [
          { p: "Ja, das kann sein. Vercel, Supabase und GitHub sind Firmen mit Sitz in den USA, und was sie für Shelfmark verarbeiten, kann dort verarbeitet werden." },
          { p: "Diese Erklärung verspricht dafür keine besondere Absicherung. Wenn dir das wichtig ist: Die App funktioniert ohne Konto, und dann verlässt deine Bibliothek das Handy nicht." },
        ],
      },
      {
        id: "delete",
        title: "Wie lange bleibt es gespeichert, und wie lösche ich es?",
        blocks: [
          { p: "Dein Konto und deine Bibliothek bleiben, bis du das Konto löschst. Eine Frist, nach der sie von selbst verschwinden, gibt es nicht." },
          {
            p: "Das Löschen des Kontos, in der App oder in den Einstellungen der Website, entfernt deine Bibliothek, alle Cover-Fotos, die du hochgeladen hast, was du mit Freunden geteilt hast, deine Ausleihen, deine Verbindungen zu Freunden und die Anmeldung selbst. Sollte der Server die Anmeldung nicht zusammen mit dem Rest entfernen lassen, sagt dir die Website das. Lässt sich ein Cover-Foto einmal nicht entfernen, mit seinem Buch oder mit dem Konto, sagt dir das niemand: Es bleibt auf dem Server liegen, und nichts verweist mehr darauf. Wer den Server betreibt, kann beides von Hand entfernen: Schreib an die Adresse oben.",
          },
          { p: "Eine Kopie deiner Bibliothek auf einem Handy bleibt auf diesem Handy, bis du sie dort entfernst. Ebenso bleibt, was die Bibliothek von jemand anderem über ein Buch sagt, das ihr einander geliehen habt: Dein Name auf diesem Buch bleibt dort stehen." },
          { p: "Das Backup in den Einstellungen ist der Export deiner eigenen Daten: eine Datei mit allem." },
        ],
      },
      {
        id: "rights",
        title: "Welche Rechte habe ich?",
        blocks: [
          {
            p: "Du kannst fragen, was über dich gespeichert ist, es berichtigen oder löschen lassen und es als Datei bekommen. Vieles davon kannst du selbst: Alles in deiner Bibliothek kannst du ändern, das Backup ist die Datei, und das Löschen des Kontos löscht sie. Für alles andere schreib an {email}.",
          },
          {
            p: "Du kannst dich auch bei einer Datenschutzbehörde beschweren: in der Schweiz beim Eidgenössischen Datenschutz- und Öffentlichkeitsbeauftragten (EDÖB), in der EU bei der Behörde deines Landes. Die Gesetze hinter diesen Rechten sind das Schweizer Datenschutzgesetz (DSG) und die Datenschutz-Grundverordnung der EU (DSGVO).",
          },
        ],
      },
    ],
  },
};

export const LEGAL: Record<Lang, LegalTexts> = { en, de };
