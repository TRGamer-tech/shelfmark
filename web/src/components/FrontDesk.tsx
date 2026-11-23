"use client";

// The frame of the pages a visitor meets before they are signed in, other than the
// front page itself: signing in, a new password, "there is no such page" and a site
// without a server. They share the look of the front page: the reading room at closing
// time, dark wood under a lamp, and paper where something is read or filled in.

import type { ReactNode } from "react";

export function FrontDesk({ children, testId, aside }: { children: ReactNode; testId?: string; aside?: ReactNode }) {
  return (
    <div className="front desk" data-testid={testId}>
      <header className="front-head">
        {/* A plain link: the front page is a page of its own, drawn by the server. */}
        <a className="wordmark" href="/">
          Shelfmark
        </a>
        {aside ? <div className="front-nav">{aside}</div> : null}
      </header>
      <main className="desk-main">{children}</main>
    </div>
  );
}
