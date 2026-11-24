"use client";

// Friends: my code, who my friends are, and what they may see of my library.

import Link from "next/link";
import { useState } from "react";
import type { FormEvent } from "react";
import { Icon } from "@/components/icons";
import { useI18n } from "@/components/i18n";
import { useLibrary } from "@/components/library";
import { Button, Card, ConfirmDialog, Dialog, EmptyHint, Field, IconButton, NameDialog, PageHead, Switch } from "@/components/ui";
import { formatMoment } from "@/lib/dates";
import { waitingCount } from "@/lib/loans";
import { setPrefs } from "@/lib/mutations";
import type { ServerFriend } from "@/lib/social";
import { displayCode } from "@/lib/social";
import { serverProblemKey } from "@/lib/supabase/errors";
import { reasonOf } from "@/lib/sync";

function AddFriendDialog({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const { addFriend, notify } = useLibrary();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const enough = code.replace(/[^A-Za-z0-9]/g, "").length >= 10;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy || !enough) return;
    setBusy(true);
    try {
      const name = await addFriend(code);
      notify(t("server_friend_added", name.trim() !== "" ? name : t("friends_someone")));
      onClose();
    } catch (error) {
      const reason = reasonOf(error);
      setProblem(t(serverProblemKey(reason), reason));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      title={t("server_add_friend")}
      onClose={onClose}
      testId="add-friend-dialog"
      actions={
        <>
          <Button variant="text" onClick={onClose}>
            {t("action_cancel")}
          </Button>
          <Button type="submit" form="friend-form" disabled={busy || !enough} data-testid="friend-code-add">
            {t("server_add_confirm")}
          </Button>
        </>
      }
    >
      <form id="friend-form" className="stack" onSubmit={submit}>
        <p>{t("server_add_friend_text")}</p>
        <Field
          label={t("server_code_label")}
          value={code}
          onChange={(event) => {
            setCode(event.target.value.toUpperCase().slice(0, 16));
            setProblem(null);
          }}
          error={problem}
          autoCapitalize="characters"
          autoComplete="off"
          spellCheck={false}
          autoFocus
          data-testid="friend-code-field"
        />
      </form>
    </Dialog>
  );
}

export default function FriendsPage() {
  const { t, plural, locale } = useI18n();
  const { prefs, mutate, profile, setName, newCode, friends, libraries, friendsBusy, friendsProblem, lastSync, syncFriends, removeFriend, loans, notify } = useLibrary();
  const [adding, setAdding] = useState(false);
  const [naming, setNaming] = useState<"name" | "before-adding" | null>(null);
  const [renewing, setRenewing] = useState(false);
  const [removing, setRemoving] = useState<ServerFriend | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const code = displayCode(profile?.code ?? "");
  const waiting = waitingCount(loans);
  const shown = problem ?? (friendsProblem ? t(serverProblemKey(friendsProblem), friendsProblem) : null);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      notify(t("server_code_copied"));
    } catch {
      // The code is on the page to be copied by hand.
    }
  };

  const fail = (error: unknown) => {
    const reason = reasonOf(error);
    setProblem(t(serverProblemKey(reason), reason));
  };

  return (
    <div className="page" data-testid="friends-page">
      <PageHead title={t("tab_friends")} />

      <Card testId="code-card">
        <p className="label-small">{t("server_your_code")}</p>
        <div className="row-between">
          <span className="friend-code" data-testid="friend-code">
            {code !== "" ? code : " "}
          </span>
          <span className="row" style={{ gap: 0 }}>
            <IconButton icon="copy" label={t("server_copy_code")} onClick={() => void copy()} disabled={code === ""} data-testid="copy-code" />
            <IconButton icon="refresh" label={t("web_new_code")} onClick={() => setRenewing(true)} disabled={code === ""} data-testid="new-code" />
          </span>
        </div>
        <p className="small muted">{t("server_code_hint")}</p>
        <div style={{ margin: "12px 0 4px" }}>
          <Button wide icon="personAdd" onClick={() => (prefs.profileName.trim() === "" ? setNaming("before-adding") : setAdding(true))} data-testid="add-friend">
            {t("server_add_friend")}
          </Button>
        </div>
        <div className="row-between">
          <span className="small muted" role="status" data-testid="sync-state">
            {friendsBusy ? t("server_syncing") : lastSync > 0 ? t("server_last_sync", formatMoment(lastSync, locale, true)) : t("server_never_synced")}
          </span>
          <IconButton
            icon="refresh"
            label={t("server_sync_now")}
            disabled={friendsBusy}
            onClick={() => {
              setProblem(null);
              void syncFriends();
            }}
            data-testid="sync-now"
          />
        </div>
        {shown ? (
          <p className="problem" role="alert" data-testid="server-problem">
            {shown}
          </p>
        ) : null}
      </Card>

      <Card title={t("friends_share_title")} testId="share-card">
        <div className="row-between">
          <span className="row">
            <Icon name="person" className="accent" />
            <span className="strong" data-testid="profile-name">
              {prefs.profileName.trim() !== "" ? prefs.profileName : t("friends_no_name")}
            </span>
          </span>
          <Button variant="text" onClick={() => setNaming("name")} data-testid="change-name">
            {t("friends_change_name")}
          </Button>
        </div>
        <Switch label={t("friends_share_status")} hint={t("friends_share_status_hint")} checked={prefs.shareStatus} onChange={(value) => void mutate(setPrefs({ shareStatus: value }))} testId="share-status" />
        <Switch label={t("friends_share_ratings")} hint={t("friends_share_ratings_hint")} checked={prefs.shareRatings} onChange={(value) => void mutate(setPrefs({ shareRatings: value }))} testId="share-ratings" />
      </Card>

      <Card>
        <Link href="/friends/loans" className="card-link" data-testid="open-loans">
          <span>
            <span style={{ display: "block" }}>{t("loans_title")}</span>
            {waiting > 0 ? (
              <span className="small accent" data-testid="loans-waiting">
                {plural("web_loans_waiting", waiting)}
              </span>
            ) : null}
          </span>
          <Icon name="forward" />
        </Link>
      </Card>

      <h2 className="section-title">{t("friends_libraries")}</h2>
      {friends.length === 0 ? <EmptyHint>{t("friends_empty")}</EmptyHint> : null}
      {friends.map((friend) => {
        const library = libraries.get(friend.id);
        const name = friend.name.trim() !== "" ? friend.name : t("friends_someone");
        return (
          <Card key={friend.id} testId="friend-card">
            <div className="friend-row">
              <Link href={`/friends/library?id=${friend.id}`} data-testid="open-friend">
                <Icon name="person" size={32} />
                <span>
                  <span className="strong" style={{ display: "block", fontSize: "1.1rem" }}>
                    {name}
                  </span>
                  <span className="small muted">{library ? plural("web_friend_books", library.library.books.length) : t("web_friend_no_library", name)}</span>
                </span>
              </Link>
              <IconButton icon="delete" label={`${t("friends_remove")}: ${name}`} className="muted" onClick={() => setRemoving(friend)} data-testid="remove-friend" />
            </div>
          </Card>
        );
      })}

      {adding ? <AddFriendDialog onClose={() => setAdding(false)} /> : null}
      {naming ? (
        <NameDialog
          title={t("friends_name_title")}
          label={t("settings_profile_name")}
          initial={prefs.profileName}
          onClose={() => setNaming(null)}
          onSave={(name) => {
            const next = naming === "before-adding";
            setNaming(null);
            void setName(name);
            if (next) setAdding(true);
          }}
        />
      ) : null}
      {renewing ? (
        <ConfirmDialog
          title={t("web_new_code_title")}
          text={t("web_new_code_text")}
          confirm={t("web_new_code")}
          onClose={() => setRenewing(false)}
          onConfirm={() => {
            setRenewing(false);
            setProblem(null);
            newCode().catch(fail);
          }}
        />
      ) : null}
      {removing ? (
        <ConfirmDialog
          title={t("web_friend_remove_title", removing.name.trim() !== "" ? removing.name : t("friends_someone"))}
          text={t("web_friend_remove_text")}
          confirm={t("friends_remove")}
          danger
          onClose={() => setRemoving(null)}
          onConfirm={() => {
            const id = removing.id;
            setRemoving(null);
            setProblem(null);
            removeFriend(id).catch(fail);
          }}
        />
      ) : null}
    </div>
  );
}
