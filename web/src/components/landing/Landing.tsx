// The front page: what Shelfmark is, the app to download, and the way in. It is drawn
// by the server and reads without scripts. The two shelves on it are the shelves of the
// library itself and wake up once scripts run.

import type { Lang } from "@/i18n/index";
import { format, translate } from "@/i18n/index";
import { LANDING } from "@/i18n/landing";
import { catalogueCount } from "@/lib/catalogue/index";
import { ORNAMENT_KINDS, SORT_ORDERS, VIEW_MODES } from "@/lib/model";
import type { Release } from "@/lib/release";
import { MIN_ANDROID, RELEASES_PAGE, REPOSITORY, sizeLabel } from "@/lib/release";
import { THEME_PRESETS, isDark } from "@/lib/theme";
import { HeroShelf } from "./HeroShelf";
import { LangLink } from "./LangLink";
import { TwinShelves } from "./TwinShelves";

const sortKeyOf: Record<string, string> = { ADDED: "sort_added", TITLE: "sort_title", AUTHOR: "sort_author", RATING: "sort_rating" };
const viewKeyOf: Record<string, string> = { SPINES: "view_spines", COVERS: "view_covers", LIST: "view_list" };

function dayOf(release: Release, lang: Lang, style: "long" | "stamp"): string {
  const moment = Date.parse(release.publishedAt);
  if (!Number.isFinite(moment)) return "";
  // The day in UTC, so that the server says the same wherever it stands.
  const options: Intl.DateTimeFormatOptions = style === "long" ? { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" } : { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" };
  return new Intl.DateTimeFormat(lang === "de" ? "de-CH" : "en-GB", options).format(moment);
}

export function Landing({ lang, release }: { lang: Lang; release: Release | null }) {
  const texts = LANDING[lang];
  const dark = THEME_PRESETS.filter(isDark).length;
  // What the code says, put into the sentences that talk about it.
  const counts = [catalogueCount(), ORNAMENT_KINDS.length, THEME_PRESETS.length, dark, THEME_PRESETS.length - dark];
  const features = texts.features.map((feature) => ({ ...feature, title: format(feature.title, counts), text: format(feature.text, counts) }));

  const version = release?.version ?? "";
  const size = release ? sizeLabel(release.size) : "";
  const known = release !== null && version !== "";
  const facts = format(known && size !== "" ? texts.hero.downloadFacts : texts.hero.downloadFactsUnknown, [version, size, MIN_ANDROID]);
  const signInHref = `/login?lang=${lang}`;
  const day = release ? dayOf(release, lang, "long") : "";
  const stamp = release ? dayOf(release, lang, "stamp") : "";

  const labels = {
    views: Object.fromEntries(VIEW_MODES.map((mode) => [mode, translate(lang, viewKeyOf[mode])])),
    sorts: Object.fromEntries(SORT_ORDERS.map((order) => [order, translate(lang, sortKeyOf[order])])),
    reading: translate(lang, "status_reading"),
    read: translate(lang, "status_read"),
  };

  return (
    <div className="front landing" lang={lang} id="top" data-testid="landing">
      <a className="skip-link" href="#shelf">
        {texts.nav.skip}
      </a>
      <header className="front-head">
        <span className="wordmark">Shelfmark</span>
        <nav className="front-nav" aria-label="Shelfmark">
          <span className="front-langs" role="group" aria-label={texts.nav.language}>
            {/* The whole word where there is room, two letters on a narrow screen. Read out, it is always the word. */}
            <LangLink lang="en" current={lang === "en"}>
              <span className="lang-word">English</span>
              <span className="lang-code" aria-hidden="true">
                EN
              </span>
            </LangLink>
            <LangLink lang="de" current={lang === "de"}>
              <span className="lang-word">Deutsch</span>
              <span className="lang-code" aria-hidden="true">
                DE
              </span>
            </LangLink>
          </span>
          <a className="front-link" href={signInHref} data-testid="front-sign-in">
            {texts.nav.signIn}
          </a>
          <a className="front-button front-button-small" href="/download" data-testid="front-download">
            {texts.nav.download}
          </a>
        </nav>
      </header>

      <main>
        <section className="hero" aria-labelledby="hero-title">
          <div className="hero-lamp" aria-hidden="true" />
          <div className="hero-words">
            <h1 id="hero-title">
              {texts.hero.title.map((line) => (
                <span key={line}>{line} </span>
              ))}
            </h1>
            <div className="hero-side">
              <p className="hero-lead">{texts.hero.lead}</p>
              <div className="hero-actions">
                <a className="front-button" href="/download" data-testid="hero-download">
                  {texts.hero.download}
                </a>
                <a className="front-link" href={signInHref} data-testid="hero-sign-in">
                  {texts.hero.signIn}
                </a>
              </div>
              <p className="hero-facts" data-testid="hero-facts">
                {facts}
              </p>
            </div>
          </div>
          <div id="shelf" className="hero-case">
            <HeroShelf lang={lang} features={features} texts={texts.shelf} note={texts.hero.note} />
          </div>
        </section>

        <section className="twin" aria-labelledby="twin-title">
          <div className="twin-words">
            <h2 id="twin-title">{texts.twin.title}</h2>
            <p>{texts.twin.text}</p>
          </div>
          <p className="twin-sample">{texts.twin.sample}</p>
          <TwinShelves lang={lang} texts={texts.twin} labels={labels} />
          <noscript>
            <p className="twin-plain">{texts.twin.plain}</p>
          </noscript>
        </section>

        <section className="counter" id="download" aria-labelledby="download-title">
          <div className="counter-words">
            <h2 id="download-title">{texts.download.title}</h2>
            <p className="counter-lead">{texts.download.lead}</p>
            <a className="front-button" href="/download" data-testid="download-button">
              {known ? format(texts.download.button, [version]) : texts.download.buttonUnknown}
            </a>
            <ul className="counter-notes">
              {texts.download.notes.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          </div>
          <div className="slip paper" data-testid="download-slip">
            {known && stamp !== "" ? (
              <p className="slip-stamp" aria-hidden="true">
                <span>{texts.download.stamp}</span>
                {stamp}
              </p>
            ) : null}
            <dl>
              <div>
                <dt>{texts.download.rows.version}</dt>
                <dd data-testid="slip-version">{known ? format(texts.download.versionValue, [version, day]) : texts.download.versionUnknown}</dd>
              </div>
              <div>
                <dt>{texts.download.rows.file}</dt>
                <dd data-testid="slip-file">{release && size !== "" ? format(texts.download.fileValue, [release.file, size]) : texts.download.fileUnknown}</dd>
              </div>
              <div>
                <dt>{texts.download.rows.needs}</dt>
                <dd>{format(texts.download.needsValue, [MIN_ANDROID])}</dd>
              </div>
              <div>
                <dt>{texts.download.rows.price}</dt>
                <dd>{texts.download.priceValue}</dd>
              </div>
              <div>
                <dt>{texts.download.rows.licence}</dt>
                <dd>{texts.download.licenceValue}</dd>
              </div>
            </dl>
            <p className="slip-links">
              <a href={RELEASES_PAGE}>{texts.download.releases}</a>
              <a href={REPOSITORY}>{texts.download.source}</a>
            </p>
          </div>
        </section>

        <section className="asked paper" aria-labelledby="asked-title">
          <h2 id="asked-title">{texts.questions.title}</h2>
          <dl className="asked-list">
            {texts.questions.items.map((item) => (
              <div key={item.q}>
                <dt>{item.q}</dt>
                <dd>
                  {item.a}
                  {item.link ? (
                    <>
                      {" "}
                      <a href={item.link.href}>{item.link.label}</a>.
                    </>
                  ) : null}
                </dd>
              </div>
            ))}
          </dl>
        </section>
      </main>

      <footer className="front-foot">
        <p className="foot-line">{texts.footer.line}</p>
        <p className="foot-links">
          <a href={REPOSITORY}>{texts.footer.source}</a>
          <a href={RELEASES_PAGE}>{texts.footer.releases}</a>
          <a href={signInHref}>{texts.footer.signIn}</a>
          <a href="#top">{texts.footer.top}</a>
        </p>
      </footer>
    </div>
  );
}
