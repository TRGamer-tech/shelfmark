"use client";

// The built-in lists and the reader's own (ui/lists/ListsScreen.kt). Picking a list
// shows its books on the shelf.

import Link from "next/link";
import { useState } from "react";
import { Icon } from "@/components/icons";
import { useI18n } from "@/components/i18n";
import { statusKey } from "@/components/labels";
import { useLibrary } from "@/components/library";
import { Button, Card, ConfirmDialog, EmptyHint, IconButton, NameDialog, PageHead } from "@/components/ui";
import { newId } from "@/lib/ids";
import { STATUS_ORDER } from "@/lib/libraryLogic";
import type { Shelf } from "@/lib/model";
import { createShelf, deleteShelf, renameShelf } from "@/lib/mutations";

function ListLink({ href, label, count, testId }: { href: string; label: string; count: number; testId?: string }) {
  const { plural } = useI18n();
  return (
    <Link href={href} className="card-link grow" style={{ padding: "10px 0" }} data-testid={testId}>
      <span>
        <span style={{ display: "block" }}>{label}</span>
        <span className="small muted" style={{ fontWeight: 400 }}>
          {plural("book_count", count)}
        </span>
      </span>
      <Icon name="right" className="muted" />
    </Link>
  );
}

export default function ListsPage() {
  const { t } = useI18n();
  const { vault, mutate } = useLibrary();
  const [creating, setCreating] = useState(false);
  const [renaming, setRenaming] = useState<Shelf | null>(null);
  const [deleting, setDeleting] = useState<Shelf | null>(null);

  const lent = vault.books.filter((b) => b.lentTo.trim() !== "").length;
  const borrowed = vault.books.filter((b) => b.ownership === "BORROWED").length;
  const shelves = vault.shelves.slice().sort((a, b) => a.position - b.position);

  return (
    <div className="page" data-testid="lists-page">
      <PageHead title={t("tab_lists")}>
        <Button icon="add" onClick={() => setCreating(true)} data-testid="new-list">
          {t("lists_new")}
        </Button>
      </PageHead>

      <Card title={t("lists_custom")}>
        {shelves.length === 0 ? <EmptyHint>{t("lists_custom_empty")}</EmptyHint> : null}
        {shelves.map((shelf) => (
          <div key={shelf.id} className="entry" style={{ alignItems: "center", padding: 0 }} data-testid="list-row">
            <ListLink href={`/?list=${shelf.id}`} label={shelf.name} count={vault.links.filter((l) => l.shelfId === shelf.id).length} testId="open-list" />
            <IconButton icon="edit" label={`${t("lists_rename")}: ${shelf.name}`} onClick={() => setRenaming(shelf)} data-testid="rename-list" />
            <IconButton icon="delete" label={`${t("action_delete")}: ${shelf.name}`} onClick={() => setDeleting(shelf)} data-testid="delete-list" />
          </div>
        ))}
      </Card>

      <Card title={t("lists_standard")}>
        {STATUS_ORDER.map((status) => (
          <div key={status} className="entry" style={{ padding: 0 }}>
            <ListLink href={`/?status=${status}`} label={t(statusKey(status))} count={vault.books.filter((b) => b.status === status).length} />
          </div>
        ))}
        {lent > 0 ? (
          <div className="entry" style={{ padding: 0 }}>
            <ListLink href="/?show=lent" label={t("filter_lent_out")} count={lent} />
          </div>
        ) : null}
        {borrowed > 0 ? (
          <div className="entry" style={{ padding: 0 }}>
            <ListLink href="/?show=borrowed" label={t("filter_borrowed")} count={borrowed} />
          </div>
        ) : null}
      </Card>

      {creating ? (
        <NameDialog
          title={t("lists_new")}
          label={t("lists_name")}
          initial=""
          onClose={() => setCreating(false)}
          onSave={(name) => {
            setCreating(false);
            void mutate(createShelf(newId(), name, Date.now()));
          }}
        />
      ) : null}
      {renaming ? (
        <NameDialog
          title={t("lists_rename")}
          label={t("lists_name")}
          initial={renaming.name}
          onClose={() => setRenaming(null)}
          onSave={(name) => {
            void mutate(renameShelf(renaming.id, name));
            setRenaming(null);
          }}
        />
      ) : null}
      {deleting ? (
        <ConfirmDialog
          title={t("lists_delete_title", deleting.name)}
          text={t("lists_delete_text")}
          confirm={t("action_delete")}
          danger
          onClose={() => setDeleting(null)}
          onConfirm={() => {
            void mutate(deleteShelf(deleting.id));
            setDeleting(null);
          }}
        />
      ) : null}
    </div>
  );
}
