"use client";

// The book cart (lib/cart.ts): the books that wait to be shelved, how they are to be
// shelved, for all of them and for each one, and shelving them all with one save.

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useRef, useState } from "react";
import { BookCover } from "@/components/BookCover";
import { ADD_STATUSES } from "@/components/BookForm";
import { useCart } from "@/components/cart";
import { useI18n } from "@/components/i18n";
import { Icon } from "@/components/icons";
import { ownershipKey, statusKey } from "@/components/labels";
import { useLibrary } from "@/components/library";
import { Button, Card, Chip, ConfirmDialog, IconButton, PageHead, Switch } from "@/components/ui";
import type { CartItem, CartSettings } from "@/lib/cart";
import { alreadyHere, settingsOf } from "@/lib/cart";
import type { Ownership } from "@/lib/model";
import { coverAddressOf } from "@/lib/shelf";

const OWNERSHIP_CHOICES: Ownership[] = ["OWNED", "BORROWED", "NOT_OWNED"];

/** The three things that are set for a book on the cart: its list, whose it is, and the reader's own lists. */
function SettingsPicker({ settings, onChange, testId }: { settings: CartSettings; onChange: (patch: Partial<CartSettings>) => void; testId: string }) {
  const { t } = useI18n();
  const { vault } = useLibrary();
  const statusLabel = useId();
  const ownershipLabel = useId();
  const listsLabel = useId();
  return (
    <div className="stack-tight" data-testid={testId}>
      <p className="label-small" id={statusLabel}>
        {t("edit_add_to")}
      </p>
      <div className="chips" role="group" aria-labelledby={statusLabel}>
        {ADD_STATUSES.map((status) => (
          <Chip key={status} selected={settings.status === status} onClick={() => onChange({ status })} data-testid={`${testId}-status-${status}`}>
            {t(statusKey(status))}
          </Chip>
        ))}
      </div>
      <p className="label-small" id={ownershipLabel}>
        {t("book_section_ownership")}
      </p>
      <div className="chips" role="group" aria-labelledby={ownershipLabel}>
        {OWNERSHIP_CHOICES.map((ownership) => (
          <Chip key={ownership} selected={settings.ownership === ownership} onClick={() => onChange({ ownership })} data-testid={`${testId}-own-${ownership}`}>
            {t(ownershipKey(ownership))}
          </Chip>
        ))}
      </div>
      {vault.shelves.length > 0 ? (
        <>
          <p className="label-small" id={listsLabel}>
            {t("web_add_lists")}
          </p>
          <div className="chips" role="group" aria-labelledby={listsLabel}>
            {vault.shelves.map((shelf) => {
              const on = settings.listIds.includes(shelf.id);
              return (
                <Chip key={shelf.id} selected={on} onClick={() => onChange({ listIds: on ? settings.listIds.filter((id) => id !== shelf.id) : [...settings.listIds, shelf.id] })} data-testid={`${testId}-list-${shelf.id}`}>
                  {shelf.name}
                </Chip>
              );
            })}
          </div>
        </>
      ) : null}
    </div>
  );
}

function CartRow({ item, open, onToggle }: { item: CartItem; open: boolean; onToggle: () => void }) {
  const { t } = useI18n();
  const { vault } = useLibrary();
  const { cart, takeOff, forOne, likeTheRest, anyway } = useCart();
  const panel = useId();
  const opener = useRef<HTMLButtonElement>(null);
  const settings = settingsOf(cart, item);
  const here = alreadyHere(item, vault.books);
  const lists = vault.shelves.filter((shelf) => settings.listIds.includes(shelf.id)).map((shelf) => shelf.name);
  // How this book will be shelved, in a line: "Read · I own it · Holiday".
  const summary = [t(statusKey(settings.status)), t(ownershipKey(settings.ownership)), ...lists].join(" · ");
  const leftOut = here && !item.anyway;
  return (
    <li className={`cart-row ${leftOut ? "cart-row-out" : ""}`} data-testid="cart-item" data-key={item.key}>
      <div className="cart-row-head">
        <button ref={opener} type="button" className="cart-row-button" aria-expanded={open} aria-controls={open ? panel : undefined} onClick={onToggle} data-testid="cart-item-open">
          <BookCover title={item.book.title} authors={item.book.authors} url={coverAddressOf(item.book)} tiny />
          <span className="grow">
            <span className="book-row-title" data-testid="cart-item-title">
              {item.book.title}
            </span>
            {item.book.authors.trim() !== "" ? <span className="book-row-authors">{item.book.authors}</span> : null}
            <span className="cart-row-settings" data-testid="cart-item-settings">
              {summary}
            </span>
            {item.own ? (
              <span className="status-word" data-testid="cart-item-own">
                {t("cart_own")}
              </span>
            ) : null}
            {here ? (
              <span className="cart-here" data-testid="cart-already-here">
                {t("cart_already_here")}
              </span>
            ) : null}
          </span>
          <Icon name="right" className="cart-row-chevron" />
        </button>
        <IconButton icon="close" label={`${t("cart_take_off")}: ${item.book.title}`} onClick={() => takeOff(item.key)} data-testid="cart-take-off" />
      </div>
      {open ? (
        <div id={panel} className="cart-row-panel" role="group" aria-label={item.book.title}>
          <SettingsPicker settings={settings} onChange={(patch) => forOne(item.key, patch)} testId="cart-one" />
          {item.own ? (
            <Button
              variant="text"
              icon="refresh"
              onClick={() => {
                likeTheRest(item.key);
                // The button goes with what it undid. The keyboard goes back to the book.
                opener.current?.focus();
              }}
              data-testid="cart-like-rest"
            >
              {t("cart_like_rest")}
            </Button>
          ) : null}
        </div>
      ) : null}
      {here ? (
        <div className="cart-row-anyway">
          <Switch checked={item.anyway} onChange={(wanted) => anyway(item.key, wanted)} label={t("cart_anyway")} hint={t("web_cart_anyway_hint")} testId="cart-anyway" />
        </div>
      ) : null}
    </li>
  );
}

export default function CartPage() {
  const { t, plural } = useI18n();
  const { notify } = useLibrary();
  const { cart, count, forAll, clear, shelving, shelve } = useCart();
  const router = useRouter();
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [clearing, setClearing] = useState(false);
  const leftOut = count - shelving;

  const shelveAll = () => {
    const shelved = shelve();
    notify(plural("cart_shelved", shelved));
    router.push("/");
  };

  return (
    <div className="page" data-testid="cart-page">
      <PageHead title={t("cart_title")} back="/add" subtitle={count > 0 ? plural("cart_count", count) : undefined} />

      {count === 0 ? (
        <div className="cart-empty" data-testid="cart-empty">
          <Icon name="cart" size={56} />
          <p>{t("cart_empty")}</p>
          <Link href="/add" className="btn btn-filled">
            <span>{t("add_search")}</span>
          </Link>
        </div>
      ) : (
        <>
          <Card title={t("cart_for_all")} testId="cart-for-all">
            <SettingsPicker settings={cart.forAll} onChange={forAll} testId="cart-all" />
          </Card>

          <p className="muted small cart-hint">{t("cart_each_hint")}</p>
          <ul className="cart-list" data-testid="cart-list">
            {cart.items.map((item) => (
              <CartRow key={item.key} item={item} open={openKey === item.key} onToggle={() => setOpenKey(openKey === item.key ? null : item.key)} />
            ))}
          </ul>

          <div className="cart-foot">
            {leftOut > 0 ? (
              <p className="muted small" data-testid="cart-left-out">
                {plural("web_cart_left_out", leftOut)}
              </p>
            ) : null}
            <Button icon="check" wide disabled={shelving === 0} onClick={shelveAll} data-testid="cart-shelve">
              {plural("cart_shelve", shelving)}
            </Button>
            {/* Below the shelving, not beside it: the one way to lose the cart is not where the hand goes first. */}
            <Button variant="text" icon="delete" onClick={() => setClearing(true)} data-testid="cart-clear">
              {t("cart_clear")}
            </Button>
          </div>
        </>
      )}

      {clearing ? (
        <ConfirmDialog
          title={t("cart_clear_title")}
          confirm={t("cart_clear")}
          danger
          onConfirm={() => {
            setClearing(false);
            clear();
          }}
          onClose={() => setClearing(false)}
          testId="cart-clear-dialog"
        />
      ) : null}
    </div>
  );
}
