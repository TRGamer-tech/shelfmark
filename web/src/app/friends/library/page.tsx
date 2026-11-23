"use client";

// A friend's shelf: what they own, what they have read, and what can be borrowed
// (ui/friends/FriendLibraryScreen.kt).

import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { BookCover } from "@/components/BookCover";
import { useI18n } from "@/components/i18n";
import { statusKey } from "@/components/labels";
import { useLibrary } from "@/components/library";
import { RatingBar, SpiceBar } from "@/components/Ratings";
import type { ShelfItem } from "@/components/Shelves";
import { CoverShelf } from "@/components/Shelves";
import { Button, Chip, Dialog, EmptyHint, PageHead, TextArea } from "@/components/ui";
import { formatDay, today } from "@/lib/dates";
import { newId, newRequestId } from "@/lib/ids";
import type { LendRequest, ReadingStatus, SharedBook, SharedLibrary } from "@/lib/model";
import { newBook, requestCodec } from "@/lib/model";
import { addBook } from "@/lib/mutations";
import { withDefaultsFor } from "@/lib/rules";
import { coverAddressOf } from "@/lib/shelf";

type FriendFilter = { kind: "all" } | { kind: "owned" } | { kind: "available" } | { kind: "status"; status: ReadingStatus } | { kind: "list"; name: string };

const same = (a: FriendFilter, b: FriendFilter) => JSON.stringify(a) === JSON.stringify(b);

function matches(book: SharedBook, filter: FriendFilter): boolean {
  switch (filter.kind) {
    case "owned":
      return book.ownership === "OWNED";
    case "available":
      return book.available;
    case "status":
      return book.status === filter.status;
    case "list":
      return book.shelves.includes(filter.name);
    default:
      return true;
  }
}

function FriendBookDialog({ friendId, friendName, library, book, request, onClose }: { friendId: string; friendName: string; library: SharedLibrary; book: SharedBook; request: LendRequest | undefined; onClose: () => void }) {
  const { t, locale } = useI18n();
  const { vault, mutate, askToBorrow } = useLibrary();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [wished, setWished] = useState(false);
  const ownership = book.ownership === "BORROWED" ? "friend_borrowed" : book.ownership === "NOT_OWNED" ? "friend_not_owned" : "friend_owns";
  const opinion = library.includesRatings && (book.rating > 0 || book.spice > 0 || book.review.trim() !== "");

  const ask = async () => {
    if (busy) return;
    setBusy(true);
    setProblem(null);
    const asked: LendRequest = {
      ...requestCodec.read({}),
      id: newRequestId(),
      incoming: false,
      bookRemoteId: book.id,
      bookTitle: book.title,
      bookAuthors: book.authors,
      isbn: book.isbn,
      peerId: friendId,
      peerName: friendName,
      note: note.trim(),
      status: "PENDING",
      createdAt: Date.now(),
      answeredAt: null,
    };
    const sent = await askToBorrow(asked);
    if (!sent) setProblem(t("web_request_send_failed"));
    setBusy(false);
  };

  const wish = () => {
    setWished(true);
    // A book that is in my library already is not added a second time.
    if (book.isbn.trim() !== "" && vault.books.some((b) => b.isbn === book.isbn)) return;
    const now = Date.now();
    const wanted = withDefaultsFor(
      newBook({ id: newId(now), title: book.title, authors: book.authors, isbn: book.isbn, coverUrl: book.coverUrl, pageCount: book.pages, format: book.format, description: book.description }),
      "WISHLIST",
      today(),
    );
    void mutate(addBook(wanted, [], now));
  };

  return (
    <Dialog title={book.title} onClose={onClose} wide testId="friend-book">
      <div className="preview-head">
        <BookCover title={book.title} authors={book.authors} url={coverAddressOf(book)} />
        <div>
          {book.authors.trim() !== "" ? <p className="book-author">{book.authors}</p> : null}
          <p style={{ marginTop: 6 }}>{t(ownership, friendName)}</p>
          {book.status ? <p className="status-word">{t(statusKey(book.status))}</p> : null}
        </div>
      </div>
      {opinion ? (
        <div data-testid="friend-opinion">
          <p className="card-title" style={{ marginBottom: 6 }}>
            {t("friend_opinion", friendName)}
          </p>
          <div className="row" style={{ gap: 16 }}>
            {book.rating > 0 ? <RatingBar rating={book.rating} size={22} /> : null}
            {book.spice > 0 ? <SpiceBar level={book.spice} size={20} /> : null}
          </div>
          {book.startedOn !== null || book.finishedOn !== null ? (
            <p className="small muted" style={{ marginTop: 4 }}>
              {[book.startedOn, book.finishedOn]
                .filter((day): day is number => day !== null)
                .map((day) => formatDay(day, locale))
                .join("  -  ")}
            </p>
          ) : null}
          {book.review.trim() !== "" ? (
            <p style={{ marginTop: 8, whiteSpace: "pre-line" }} data-testid="friend-review">
              {book.review}
            </p>
          ) : null}
        </div>
      ) : null}
      {book.description.trim() !== "" ? <p className="blurb blurb-clamped">{book.description}</p> : null}

      {request ? (
        <p className="strong accent" data-testid="request-state">
          {t(request.status === "ACCEPTED" ? "friend_request_accepted" : request.status === "DECLINED" ? "friend_request_declined" : "friend_request_sent", friendName)}
        </p>
      ) : book.available ? (
        <>
          <TextArea label={t("friend_request_note")} rows={2} value={note} onChange={(event) => setNote(event.target.value.slice(0, 200))} data-testid="request-note" />
          <Button wide onClick={() => void ask()} disabled={busy} data-testid="ask-to-borrow">
            {t("friend_ask_to_borrow")}
          </Button>
        </>
      ) : (
        <p className="muted" data-testid="not-available">
          {t("friend_not_available")}
        </p>
      )}
      {problem ? (
        <p className="problem" role="alert">
          {problem}
        </p>
      ) : null}
      <Button variant="outline" wide disabled={wished} onClick={wish} data-testid="add-to-wishlist">
        {t(wished ? "friend_wishlisted" : "friend_add_to_wishlist")}
      </Button>
    </Dialog>
  );
}

export default function FriendLibraryPage() {
  const { t, plural } = useI18n();
  const { vault, friends, libraries, syncFriends, lastSync } = useLibrary();
  const friendId = useSearchParams().get("id") ?? "";
  const [filter, setFilter] = useState<FriendFilter>({ kind: "all" });
  const [openId, setOpenId] = useState<number | null>(null);

  // Opened directly (a bookmark, a reload): the friends have to be fetched first.
  useEffect(() => {
    if (lastSync === 0) void syncFriends();
  }, [lastSync, syncFriends]);

  const friend = friends.find((f) => f.id === friendId);
  const entry = libraries.get(friendId);
  const name = (friend?.name ?? entry?.library.ownerName ?? "").trim() || t("friends_someone");
  const books = entry?.library.books ?? [];
  const visible = books.filter((book) => matches(book, filter));
  const open = books.find((book) => book.id === openId);
  const listNames = Array.from(new Set(books.flatMap((book) => book.shelves))).sort();

  const chips: { filter: FriendFilter; label: string; key: string }[] = [
    { filter: { kind: "all" }, label: t("filter_all"), key: "all" },
    { filter: { kind: "owned" }, label: t("friend_filter_owned"), key: "owned" },
    { filter: { kind: "available" }, label: t("friend_filter_available"), key: "available" },
  ];
  if (entry?.library.includesStatus) {
    for (const status of ["READ", "READING", "WISHLIST"] as ReadingStatus[]) chips.push({ filter: { kind: "status", status }, label: t(statusKey(status)), key: status });
    for (const list of listNames) chips.push({ filter: { kind: "list", name: list }, label: list, key: `list-${list}` });
  }

  const items: ShelfItem[] = visible.map((book) => ({
    key: book.id,
    title: book.title,
    authors: book.authors,
    cover: coverAddressOf(book),
    pageCount: book.pages,
    format: book.format,
    ribbon: book.available ? "var(--good)" : null,
  }));

  return (
    <div className="page page-wide" data-testid="friend-library">
      <PageHead title={t("web_friend_shelf", name)} subtitle={entry ? plural("book_count", books.length) : undefined} back="/friends" />
      {!entry ? (
        <EmptyHint>{friend ? t("web_friend_no_library", name) : lastSync === 0 ? t("server_syncing") : t("library_nothing_matches")}</EmptyHint>
      ) : (
        <>
          <div className="chips chips-scroll" role="group" aria-label={t("book_section_list")} style={{ paddingLeft: 0 }}>
            {chips.map((chip) => (
              <Chip key={chip.key} selected={same(filter, chip.filter)} count={books.filter((book) => matches(book, chip.filter)).length} onClick={() => setFilter(chip.filter)} data-testid={`friend-filter-${chip.key}`}>
                {chip.label}
              </Chip>
            ))}
          </div>
          {visible.length === 0 ? <EmptyHint>{t("library_nothing_matches")}</EmptyHint> : <CoverShelf sections={[{ key: "friend", items }]} onClick={(item) => setOpenId(item.key)} />}
        </>
      )}
      {open && entry ? (
        <FriendBookDialog
          key={open.id}
          friendId={friendId}
          friendName={name}
          library={entry.library}
          book={open}
          request={vault.requests.find((r) => !r.incoming && r.peerId === friendId && r.bookRemoteId === open.id)}
          onClose={() => setOpenId(null)}
        />
      ) : null}
    </div>
  );
}
