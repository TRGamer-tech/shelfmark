"use client";

// Every borrow request: the ones friends sent me and the ones I sent
// (ui/friends/RequestsScreen.kt).

import { useEffect, useState } from "react";
import { useI18n } from "@/components/i18n";
import { lendStatusKey } from "@/components/labels";
import { useLibrary } from "@/components/library";
import { Button, Card, ConfirmDialog, EmptyHint, IconButton, PageHead } from "@/components/ui";
import { formatMoment } from "@/lib/dates";
import type { LendRequest } from "@/lib/model";
import { deleteRequest } from "@/lib/mutations";

function RequestCard({ request, headline, actionLabel, onAction, onDelete }: { request: LendRequest; headline: string; actionLabel: string | null; onAction: () => void; onDelete: () => void }) {
  const { t, locale } = useI18n();
  const tone = request.status === "ACCEPTED" ? "status-good" : request.status === "DECLINED" ? "status-bad" : "muted strong";
  return (
    <Card testId="request-card">
      <div className="row-between" style={{ alignItems: "flex-start" }}>
        <div className="grow">
          <p className="strong">{headline}</p>
          <p className={tone} data-testid="request-status" data-status={request.status}>
            {t(lendStatusKey(request.status))}
          </p>
          <p className="small muted">{formatMoment(request.createdAt, locale)}</p>
          {request.note.trim() !== "" ? <p style={{ marginTop: 4 }}>{"„" + request.note + "“"}</p> : null}
          {actionLabel ? (
            <Button variant="text" onClick={onAction} style={{ paddingLeft: 0 }}>
              {actionLabel}
            </Button>
          ) : null}
        </div>
        <IconButton icon="delete" label={t("action_delete")} className="muted" onClick={onDelete} />
      </div>
    </Card>
  );
}

export default function RequestsPage() {
  const { t } = useI18n();
  const { vault, mutate, answer, resendRequest, syncFriends, notify } = useLibrary();
  const [deleting, setDeleting] = useState<LendRequest | null>(null);

  // Whoever opens this page wants to know now whether something came in.
  useEffect(() => {
    void syncFriends();
  }, [syncFriends]);

  const newestFirst = (a: LendRequest, b: LendRequest) => b.createdAt - a.createdAt;
  const incoming = vault.requests.filter((r) => r.incoming).sort(newestFirst);
  const outgoing = vault.requests.filter((r) => !r.incoming).sort(newestFirst);
  const who = (request: LendRequest) => (request.peerName.trim() !== "" ? request.peerName : t("friends_someone"));
  const told = (sent: boolean) => notify(t(sent ? "server_sent" : "web_request_send_failed"));

  return (
    <div className="page" data-testid="requests-page">
      <PageHead title={t("requests_title")} back="/friends" />
      {vault.requests.length === 0 ? <EmptyHint>{t("requests_empty")}</EmptyHint> : null}

      {incoming.length > 0 ? <h2 className="section-title">{t("requests_incoming")}</h2> : null}
      {incoming.map((request) =>
        request.status === "PENDING" ? (
          <Card key={request.id} testId="incoming-request">
            <p className="strong">{t("request_question", who(request), request.bookTitle)}</p>
            {request.note.trim() !== "" ? <p style={{ marginTop: 4 }}>{"„" + request.note + "“"}</p> : null}
            <div className="row" style={{ marginTop: 10 }}>
              <Button onClick={() => void answer(request, true).then(told)} data-testid="answer-yes">
                {t("action_yes")}
              </Button>
              <Button variant="outline" onClick={() => void answer(request, false).then(told)} data-testid="answer-no">
                {t("action_no")}
              </Button>
            </div>
          </Card>
        ) : (
          <RequestCard
            key={request.id}
            request={request}
            headline={t("request_incoming_line", who(request), request.bookTitle)}
            // The answer can be sent again in case it got lost on the way.
            actionLabel={t("request_resend_answer")}
            onAction={() => void answer(request, request.status === "ACCEPTED").then(told)}
            onDelete={() => setDeleting(request)}
          />
        ),
      )}

      {outgoing.length > 0 ? <h2 className="section-title">{t("requests_outgoing")}</h2> : null}
      {outgoing.map((request) => (
        <RequestCard
          key={request.id}
          request={request}
          headline={t("request_outgoing_line", request.bookTitle, who(request))}
          actionLabel={request.status === "PENDING" ? t("request_resend") : null}
          onAction={() => void resendRequest(request).then(told)}
          onDelete={() => setDeleting(request)}
        />
      ))}

      {deleting ? (
        <ConfirmDialog
          title={t("web_delete_request_title")}
          confirm={t("action_delete")}
          danger
          onClose={() => setDeleting(null)}
          onConfirm={() => {
            void mutate(deleteRequest(deleting.id));
            setDeleting(null);
          }}
        />
      ) : null}
    </div>
  );
}
