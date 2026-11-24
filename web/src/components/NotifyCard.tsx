"use client";

// What the friends page and the loans page say about notifications of the browser: a
// card that asks, once and only by a click, a line for somebody who said no in the
// browser, or nothing (lib/browserNotices.ts, offerOf).

import { useState } from "react";
import { useI18n } from "./i18n";
import { useLibrary } from "./library";
import { Button, Card } from "./ui";

export function NotifyCard() {
  const { t } = useI18n();
  const { notifyOffer, allowNotifications, putNotifyOfferAway, notify } = useLibrary();
  const [busy, setBusy] = useState(false);

  if (notifyOffer === "none") return null;

  if (notifyOffer === "blocked") {
    return (
      <div className="notify-line" data-testid="notify-blocked">
        <p className="small muted">
          <span className="strong">{t("notify_off_title")}.</span> {t("web_notify_blocked")}
        </p>
        <Button variant="text" onClick={putNotifyOfferAway} data-testid="notify-put-away">
          {t("action_ok")}
        </Button>
      </div>
    );
  }

  const ask = async () => {
    if (busy) return;
    setBusy(true);
    try {
      // The browser asks the reader now. A no leads to the line above, and closing the question leaves the card.
      if ((await allowNotifications()) === "granted") notify(t("web_notify_on"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title={t("web_notify_title")} testId="notify-card">
      <p className="muted">{t("web_notify_text")}</p>
      <div className="row" style={{ marginTop: 10 }}>
        <Button onClick={() => void ask()} disabled={busy} data-testid="notify-allow">
          {t("notify_allow")}
        </Button>
        <Button variant="text" onClick={putNotifyOfferAway} data-testid="notify-later">
          {t("web_notify_later")}
        </Button>
      </div>
    </Card>
  );
}
