"use client";

// Every loan the reader is part of: what waits for their word first, then what is on
// its way, what is lent out, what is borrowed, and what is over
// (ui/friends/LoansScreen.kt in the app).

import { useEffect } from "react";
import { useI18n } from "@/components/i18n";
import { useLibrary } from "@/components/library";
import { LoanView } from "@/components/Loans";
import { NotifyCard } from "@/components/NotifyCard";
import { Card, EmptyHint, IconButton, PageHead } from "@/components/ui";
import type { Loan, LoanSection } from "@/lib/loans";
import { LOAN_SECTIONS, sectionOf } from "@/lib/loans";
import { serverProblemKey } from "@/lib/supabase/errors";

export default function LoansPage() {
  const { t } = useI18n();
  const { vault, loans, syncFriends, friendsBusy, friendsProblem, lastSync } = useLibrary();

  // Whoever opens this page wants to know now whether something came in.
  useEffect(() => {
    void syncFriends();
  }, [syncFriends]);

  // The book a loan is about, as far as it stands in my own library: mine that I lend, or my copy of one I borrowed.
  const hrefOf = (loan: Loan): string | undefined => {
    const mine = loan.role === "lender" ? vault.books.find((book) => book.id === loan.bookId) : vault.books.find((book) => book.loanId === loan.id);
    return mine ? `/book?id=${mine.id}` : undefined;
  };

  const sections = LOAN_SECTIONS.map((section: LoanSection) => ({ section, loans: loans.filter((loan) => sectionOf(loan) === section) })).filter((entry) => entry.loans.length > 0);

  return (
    <div className="page" data-testid="loans-page">
      <PageHead title={t("loans_title")} back="/friends">
        <IconButton icon="refresh" label={t("server_sync_now")} disabled={friendsBusy} onClick={() => void syncFriends()} data-testid="sync-now" />
      </PageHead>
      {friendsProblem ? (
        <p className="problem" role="alert" data-testid="server-problem">
          {t(serverProblemKey(friendsProblem), friendsProblem)}
        </p>
      ) : null}
      {loans.length === 0 && lastSync > 0 ? <EmptyHint>{t("loans_empty")}</EmptyHint> : null}
      {sections.map(({ section, loans: listed }) => (
        <section key={section} data-testid={`loans-${section}`}>
          <h2 className="section-title">{t(`loans_section_${section}`)}</h2>
          {listed.map((loan) => (
            <Card key={loan.id} testId="loan-card">
              <LoanView loan={loan} bookHref={hrefOf(loan)} headline />
            </Card>
          ))}
        </section>
      ))}
      <NotifyCard />
    </div>
  );
}
