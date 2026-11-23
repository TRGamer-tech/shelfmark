// The imprint and the privacy notice. Both are drawn by the server from the texts in
// i18n/legal.ts and read without scripts. They wear the look of the front page: the
// title stands on the dark wood of the room, the text lies on it as a sheet of paper.

import type { Metadata } from "next";
import type { ReactNode } from "react";
import type { Lang } from "@/i18n/index";
import { format, translate } from "@/i18n/index";
import type { Block } from "@/i18n/legal";
import { LEGAL } from "@/i18n/legal";
import { catalogueCount } from "@/lib/catalogue/index";
import type { LegalKind } from "@/lib/legal";
import { LEGAL_PATHS, PRIVACY_AS_OF } from "@/lib/legal";
import { operatorBlock } from "@/lib/operator";
import { REPOSITORY } from "@/lib/release";
import { LangLink } from "../landing/LangLink";

export function legalMetadata(lang: Lang, kind: LegalKind): Metadata {
  const page = LEGAL[lang][kind];
  return {
    title: `${page.title} - Shelfmark`,
    description: page.description,
    alternates: { canonical: LEGAL_PATHS[lang][kind], languages: { en: LEGAL_PATHS.en[kind], de: LEGAL_PATHS.de[kind], "x-default": LEGAL_PATHS.en[kind] } },
  };
}

/** "23 November 2026", or "23. November 2026" in German. */
function dayOf(iso: string, lang: Lang): string {
  // The day in UTC, so that the server says the same wherever it stands.
  return new Intl.DateTimeFormat(lang === "de" ? "de-CH" : "en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(Date.parse(`${iso}T00:00:00Z`));
}

/** Turns the marks in a text into what they stand for, see i18n/legal.ts. */
function rich(text: string, lang: Lang): ReactNode[] {
  const { email } = operatorBlock();
  const parts: ReactNode[] = [];
  // Words next to words become one piece, so that a sentence is one run of text in the page the server sends.
  const add = (part: ReactNode) => {
    const before = parts[parts.length - 1];
    if (typeof part === "string" && typeof before === "string") parts[parts.length - 1] = before + part;
    else parts.push(part);
  };
  let last = 0;
  for (const match of text.matchAll(/\{(\w+)(?:\|([^}]*))?\}/g)) {
    const [whole, name, words] = match;
    add(text.slice(last, match.index));
    last = match.index + whole.length;
    const key = `${name}-${match.index}`;
    if (name === "email") add(<a key={key} href={`mailto:${email}`}>{email}</a>);
    else if (name === "repository") add(<a key={key} href={REPOSITORY}>{REPOSITORY.replace("https://", "")}</a>);
    else if (name === "count") add(String(catalogueCount()));
    else if (name === "privacy" || name === "imprint") add(<a key={key} href={LEGAL_PATHS[lang][name]}>{words ?? LEGAL[lang][name].title}</a>);
    // A mark nobody knows stays as it was written, which is ugly enough to be noticed.
    else add(whole);
  }
  add(text.slice(last));
  return parts;
}

function Operator({ lang }: { lang: Lang }) {
  const { lines, email } = operatorBlock();
  return (
    <address className="sheet-operator" data-testid="operator">
      {lines.map((line) => (
        <span key={line} data-testid="operator-line">
          {line}
        </span>
      ))}
      <span>
        {LEGAL[lang].email}: <a href={`mailto:${email}`}>{email}</a>
      </span>
    </address>
  );
}

function BlockView({ block, lang }: { block: Block; lang: Lang }) {
  if ("operator" in block) return <Operator lang={lang} />;
  if ("list" in block) {
    return (
      <ul>
        {block.list.map((item) => (
          <li key={item}>{rich(item, lang)}</li>
        ))}
      </ul>
    );
  }
  return <p>{rich(block.p, lang)}</p>;
}

export function LegalPage({ lang, kind }: { lang: Lang; kind: LegalKind }) {
  const texts = LEGAL[lang];
  const page = texts[kind];
  const other: LegalKind = kind === "imprint" ? "privacy" : "imprint";
  const home = lang === "de" ? "/de" : "/";
  return (
    <div className="front legal" lang={lang} id="top" data-testid={`legal-${kind}`}>
      <a className="skip-link" href="#text">
        {texts.nav.skip}
      </a>
      <header className="front-head">
        <a className="wordmark" href={home}>
          Shelfmark
        </a>
        <nav className="front-nav" aria-label="Shelfmark">
          <span className="front-langs" role="group" aria-label={texts.nav.language}>
            {/* Each language has this page at an address of its own, so the switch is a plain link to the same page. */}
            <LangLink lang="en" current={lang === "en"} href={LEGAL_PATHS.en[kind]}>
              English
            </LangLink>
            <LangLink lang="de" current={lang === "de"} href={LEGAL_PATHS.de[kind]}>
              Deutsch
            </LangLink>
          </span>
        </nav>
      </header>

      <main className="legal-main">
        <div className="legal-title">
          <h1>{page.heading}</h1>
          {kind === "privacy" ? (
            <p className="legal-date" data-testid="as-of">
              {format(texts.asOf, [dayOf(PRIVACY_AS_OF, lang)])}
            </p>
          ) : null}
          <p className="legal-lead">{page.lead}</p>
          {page.sections.length > 5 ? (
            <nav className="legal-contents" aria-label={texts.nav.contents}>
              <ol>
                {page.sections.map((section) => (
                  <li key={section.id}>
                    <a href={`#${section.id}`}>{section.title}</a>
                  </li>
                ))}
              </ol>
            </nav>
          ) : null}
        </div>

        <article className="sheet paper" id="text">
          {page.sections.map((section) => (
            <section key={section.id} id={section.id} aria-labelledby={`${section.id}-title`}>
              <h2 id={`${section.id}-title`}>{section.title}</h2>
              {section.blocks.map((block, index) => (
                <BlockView key={index} block={block} lang={lang} />
              ))}
            </section>
          ))}
        </article>
      </main>

      <footer className="front-foot">
        <p className="foot-line">Shelfmark</p>
        <p className="foot-links">
          <a href={home}>{texts.nav.home}</a>
          <a href={LEGAL_PATHS[lang][other]} data-testid={`link-${other}`}>
            {translate(lang, other === "imprint" ? "web_imprint" : "web_privacy")}
          </a>
          <a href="#top">{texts.nav.top}</a>
        </p>
      </footer>
    </div>
  );
}
