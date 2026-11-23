"use client";

// The form for typing in a book by hand or correcting one (ui/edit/EditScreen.kt).

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import type { RemoteBook } from "@/lib/catalogue/remoteBook";
import { today } from "@/lib/dates";
import { findCovers } from "@/lib/findCovers";
import { newId } from "@/lib/ids";
import * as Isbn from "@/lib/isbn";
import type { Book, BookFormat, ReadingStatus } from "@/lib/model";
import type { BookFields } from "@/lib/mutations";
import { addBook, editBook, fillCover, withCover } from "@/lib/mutations";
import { prepareCover } from "@/lib/picture";
import { isAudio, withDefaultsFor } from "@/lib/rules";
import { coverAddressOf } from "@/lib/shelf";
import { ownCoverFile, removeCover, uploadCover } from "@/lib/supabase/covers";
import { useAuth } from "./auth";
import { BookCover } from "./BookCover";
import { useI18n } from "./i18n";
import { formatKey, statusKey } from "./labels";
import { useLibrary } from "./library";
import { Button, Chip, Dialog, Field, IconLink, TextArea, digits } from "./ui";

const FORMATS: BookFormat[] = ["HARDCOVER", "PAPERBACK", "EBOOK", "AUDIOBOOK", "OTHER"];
export const ADD_STATUSES: ReadingStatus[] = ["NONE", "WISHLIST", "READING", "READ", "ABANDONED"];

/** The five built-in lists as a row of chips, and the reader's own lists below them. */
export function ListChoice({ status, onStatus, listIds, onLists }: { status: ReadingStatus; onStatus: (status: ReadingStatus) => void; listIds: number[]; onLists: (ids: number[]) => void }) {
  const { t } = useI18n();
  const { vault } = useLibrary();
  return (
    <>
      <p className="label-small">{t("edit_add_to")}</p>
      <div className="chips">
        {ADD_STATUSES.map((choice) => (
          <Chip key={choice} selected={status === choice} onClick={() => onStatus(choice)} data-testid={`pick-${choice}`}>
            {t(statusKey(choice))}
          </Chip>
        ))}
      </div>
      {vault.shelves.length > 0 ? (
        <>
          <p className="label-small">{t("web_add_lists")}</p>
          <div className="chips">
            {vault.shelves.map((shelf) => {
              const on = listIds.includes(shelf.id);
              return (
                <Chip key={shelf.id} selected={on} onClick={() => onLists(on ? listIds.filter((id) => id !== shelf.id) : [...listIds, shelf.id])} data-testid={`pick-list-${shelf.id}`}>
                  {shelf.name}
                </Chip>
              );
            })}
          </div>
        </>
      ) : null}
    </>
  );
}

function CoverPicker({ title, authors, isbn, onPick, onClose }: { title: string; authors: string; isbn: string; onPick: (url: string) => void; onClose: () => void }) {
  const { t, lang } = useI18n();
  const [covers, setCovers] = useState<string[] | null>(null);
  useEffect(() => {
    let alive = true;
    void findCovers(title, authors, isbn, lang).then((found) => {
      if (alive) setCovers(found);
    });
    return () => {
      alive = false;
    };
  }, [title, authors, isbn, lang]);
  return (
    <Dialog title={t("cover_search")} onClose={onClose} wide testId="cover-picker">
      {covers === null ? (
        <div className="busy-line" role="status" aria-label={t("cover_search")} />
      ) : covers.length === 0 ? (
        <p data-testid="no-covers">{t("web_cover_none")}</p>
      ) : (
        <>
          <p className="muted">{t("cover_pick")}</p>
          <div className="cover-choices">
            {covers.map((url, index) => (
              <button key={url} type="button" className="cover-choice" onClick={() => onPick(url)} aria-label={`${t("web_cover_title")} ${index + 1}`} data-testid="cover-choice">
                <img src={url} alt="" referrerPolicy="no-referrer" loading="lazy" />
              </button>
            ))}
          </div>
        </>
      )}
    </Dialog>
  );
}

/** What a catalogue record becomes in the form. */
export function draftOf(record: RemoteBook, base: Book): Book {
  return {
    ...base,
    title: record.title,
    subtitle: record.subtitle,
    authors: record.authors.join(", "),
    isbn: record.isbn,
    publisher: record.publisher,
    publishedYear: record.year,
    language: record.language,
    pageCount: record.pageCount,
    format: record.format,
    description: record.description,
    coverUrl: record.coverUrl,
  };
}

interface Props {
  initial: Book;
  isNew: boolean;
  backHref: string;
  onSaved: (id: number) => void;
}

export function BookForm({ initial, isNew, backHref, onSaved }: Props) {
  const { t, lang } = useI18n();
  const { config, client, user } = useAuth();
  const { mutate } = useLibrary();
  const [book, setBook] = useState<Book>(initial);
  const [seriesPosition, setSeriesPosition] = useState(initial.seriesPosition > 0 ? String(initial.seriesPosition) : "");
  const [status, setStatus] = useState<ReadingStatus>(isNew ? "NONE" : initial.status);
  const [listIds, setListIds] = useState<number[]>([]);
  const [picking, setPicking] = useState(false);
  const [address, setAddress] = useState("");
  const [uploading, setUploading] = useState(false);
  const [coverProblem, setCoverProblem] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const set = (patch: Partial<Book>) => setBook((current) => ({ ...current, ...patch }));
  // Every way of giving the book another cover goes through here, so none forgets the photo on the phone.
  // That it happened is remembered apart from the fields: the library may change under an open form.
  const [coverTouched, setCoverTouched] = useState(false);
  const setCover = (url: string) => {
    setBook((current) => withCover(current, url));
    setCoverTouched(true);
  };
  const cover = coverAddressOf(book);

  const upload = async (file: File | undefined) => {
    if (!file || !user) return;
    setCoverProblem(null);
    setUploading(true);
    try {
      const picture = await prepareCover(file);
      const { data } = await client.auth.getSession();
      const token = data.session?.access_token;
      if (!picture || !token) throw new Error("no picture");
      const url = await uploadCover(config, token, user.id, picture);
      // Only the cover changes. Everything else in the form stays.
      setCover(url);
    } catch {
      setCoverProblem(t("web_cover_upload_failed"));
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  };

  const save = (event: FormEvent) => {
    event.preventDefault();
    if (book.title.trim() === "") return;
    const position = Number(seriesPosition.replace(",", "."));
    const fields: BookFields = {
      title: book.title.trim(),
      subtitle: book.subtitle.trim(),
      authors: book.authors.trim(),
      isbn: Isbn.to13(book.isbn) ?? Isbn.clean(book.isbn),
      publisher: book.publisher.trim(),
      publishedYear: book.publishedYear.trim(),
      language: book.language.trim(),
      pageCount: book.pageCount,
      format: book.format,
      description: book.description,
      genres: book.genres.trim(),
      tags: book.tags.trim(),
      series: book.series.trim(),
      seriesPosition: Number.isFinite(position) && position > 0 ? position : 0,
    };
    const coverUrl = book.coverUrl.trim();
    const now = Date.now();
    if (isNew) {
      const id = newId(now);
      const added = withDefaultsFor(withCover({ ...book, ...fields, id }, coverUrl), status, today());
      void mutate(addBook(added, listIds, now));
      // A book that came without a cover gets one looked up in the background.
      if (coverUrl === "") {
        void findCovers(fields.title, fields.authors, fields.isbn, lang).then((found) => {
          if (found[0]) void mutate(fillCover(id, found[0], Date.now()));
        });
      }
      onSaved(id);
    } else {
      void mutate(editBook(book.id, fields, coverTouched ? coverUrl : null, now));
      // A picture this account uploaded and no longer uses is taken off the server again.
      const old = user ? ownCoverFile(config, user.id, initial.coverUrl) : null;
      if (coverTouched && old && user && coverUrl !== initial.coverUrl) {
        void client.auth.getSession().then(({ data }) => {
          if (data.session) void removeCover(config, data.session.access_token, user.id, old);
        });
      }
      onSaved(book.id);
    }
  };

  return (
    <form className="page" onSubmit={save} data-testid="book-form">
      <header className="page-head">
        <IconLink href={backHref} icon="back" label={t("action_back")} />
        <div className="page-head-text">
          <h1>{t(isNew ? "edit_title_new" : "edit_title")}</h1>
        </div>
        <Button type="submit" disabled={book.title.trim() === "" || uploading} data-testid="save-book">
          {t("action_save")}
        </Button>
      </header>

      <div className="card">
        <h2 className="card-title">{t("web_cover_title")}</h2>
        <div className="edit-cover">
          <BookCover title={book.title.trim() !== "" ? book.title : t("field_title")} authors={book.authors} url={cover} />
          <div className="stack-tight grow">
            <div className="row">
              <Button variant="outline" icon="search" onClick={() => setPicking(true)} disabled={book.title.trim() === "" && book.isbn.trim() === ""} data-testid="search-cover">
                {t("cover_search")}
              </Button>
              <Button variant="outline" icon="upload" onClick={() => fileInput.current?.click()} disabled={uploading} data-testid="upload-cover">
                {uploading ? t("web_cover_uploading") : t("web_cover_upload")}
              </Button>
              <input ref={fileInput} type="file" accept="image/*" hidden onChange={(event) => void upload(event.target.files?.[0])} data-testid="cover-file" />
              {book.coverUrl.trim() !== "" || book.coverPath.trim() !== "" ? (
                <Button variant="text" icon="delete" onClick={() => setCover("")} data-testid="remove-cover">
                  {t("edit_cover_remove")}
                </Button>
              ) : null}
            </div>
            {coverProblem ? (
              <p className="problem" role="alert" data-testid="cover-problem">
                {coverProblem}
              </p>
            ) : null}
            <div className="row" style={{ alignItems: "flex-end" }}>
              <Field className="grow" label={t("web_cover_address")} type="url" inputMode="url" value={address} onChange={(event) => setAddress(event.target.value)} data-testid="cover-address" />
              <Button
                variant="outline"
                disabled={!/^https?:\/\/\S+$/i.test(address.trim())}
                onClick={() => {
                  setCover(address);
                  setAddress("");
                }}
                data-testid="cover-address-use"
              >
                {t("web_cover_address_use")}
              </Button>
            </div>
          </div>
        </div>
      </div>

      <div className="card stack">
        <Field label={t("field_title")} value={book.title} onChange={(event) => set({ title: event.target.value })} required autoFocus={isNew} data-testid="field-title" />
        <Field label={t("field_subtitle")} value={book.subtitle} onChange={(event) => set({ subtitle: event.target.value })} data-testid="field-subtitle" />
        <Field label={t("field_authors")} value={book.authors} onChange={(event) => set({ authors: event.target.value })} hint={t("field_authors_hint")} data-testid="field-authors" />
        <div>
          <p className="label-small" style={{ marginBottom: 6 }}>
            {t("field_format")}
          </p>
          <div className="chips">
            {FORMATS.map((format) => (
              <Chip key={format} selected={book.format === format} onClick={() => set({ format: book.format === format ? "UNKNOWN" : format })} data-testid={`format-${format}`}>
                {t(formatKey(format))}
              </Chip>
            ))}
          </div>
        </div>
        <div className="field-row">
          <Field
            label={t(isAudio(book) ? "field_minutes" : "field_pages")}
            inputMode="numeric"
            value={book.pageCount > 0 ? String(book.pageCount) : ""}
            onChange={(event) => set({ pageCount: Number(digits(event.target.value, 5)) || 0 })}
            data-testid="field-pages"
          />
          <Field label={t("field_year")} inputMode="numeric" value={book.publishedYear} onChange={(event) => set({ publishedYear: event.target.value.slice(0, 10) })} data-testid="field-year" />
        </div>
        <Field label={t("field_isbn")} inputMode="numeric" value={book.isbn} onChange={(event) => set({ isbn: event.target.value.slice(0, 17) })} data-testid="field-isbn" />
        <Field label={t("field_publisher")} value={book.publisher} onChange={(event) => set({ publisher: event.target.value })} data-testid="field-publisher" />
        <Field label={t("field_language")} value={book.language} onChange={(event) => set({ language: event.target.value })} data-testid="field-language" />
        <div className="field-row field-row-3">
          <Field label={t("field_series")} value={book.series} onChange={(event) => set({ series: event.target.value })} data-testid="field-series" />
          <Field label={t("field_series_position")} inputMode="decimal" value={seriesPosition} onChange={(event) => setSeriesPosition(event.target.value.slice(0, 5))} data-testid="field-series-position" />
        </div>
        <Field label={t("field_genres")} value={book.genres} onChange={(event) => set({ genres: event.target.value })} hint={t("field_comma_hint")} data-testid="field-genres" />
        <Field label={t("field_tags")} value={book.tags} onChange={(event) => set({ tags: event.target.value })} hint={t("field_comma_hint")} data-testid="field-tags" />
        <TextArea label={t("field_description")} rows={5} value={book.description} onChange={(event) => set({ description: event.target.value })} data-testid="field-description" />
        {isNew ? <ListChoice status={status} onStatus={setStatus} listIds={listIds} onLists={setListIds} /> : null}
      </div>

      <div className="row" style={{ justifyContent: "flex-end" }}>
        <Link href={backHref} className="btn btn-text">
          {t("action_cancel")}
        </Link>
        <Button type="submit" disabled={book.title.trim() === "" || uploading}>
          {t("action_save")}
        </Button>
      </div>

      {picking ? (
        <CoverPicker
          title={book.title.trim()}
          authors={book.authors.trim()}
          isbn={Isbn.to13(book.isbn) ?? ""}
          onClose={() => setPicking(false)}
          onPick={(url) => {
            setPicking(false);
            setCover(url);
          }}
        />
      ) : null}
    </form>
  );
}
