"use client";

// Reading goals (ui/stats/GoalsScreen.kt).

import { useState } from "react";
import { useGoalTitle } from "@/components/Charts";
import { useI18n } from "@/components/i18n";
import { goalUnitKey, repeatKey } from "@/components/labels";
import { useLibrary } from "@/components/library";
import { Button, Card, Chip, ConfirmDialog, Dialog, EmptyHint, Field, IconButton, PageHead, digits } from "@/components/ui";
import { formatDay, fromEpochDay, fromIsoDate, toEpochDay, toIsoDate, today } from "@/lib/dates";
import { newId } from "@/lib/ids";
import type { Goal, GoalKind, GoalRepeat } from "@/lib/model";
import { GOAL_KINDS, GOAL_REPEATS, goalCodec } from "@/lib/model";
import { deleteGoal, saveGoal } from "@/lib/mutations";
import type { GoalProgress } from "@/lib/stats";
import { goalProgress } from "@/lib/stats";

function Ring({ fraction, good }: { fraction: number; good: boolean }) {
  const radius = 30;
  const around = 2 * Math.PI * radius;
  return (
    <div className="ring">
      <svg viewBox="0 0 68 68" aria-hidden="true">
        <circle cx="34" cy="34" r={radius} fill="none" stroke="var(--tile)" strokeWidth="7" />
        <circle cx="34" cy="34" r={radius} fill="none" stroke={good ? "var(--good)" : "var(--accent-text)"} strokeWidth="7" strokeLinecap="round" strokeDasharray={`${around * fraction} ${around}`} />
      </svg>
      <span>{Math.floor(fraction * 100)}%</span>
    </div>
  );
}

function GoalCard({ progress, onEdit, onDelete }: { progress: GoalProgress; onEdit: () => void; onDelete: () => void }) {
  const { t, plural, locale } = useI18n();
  const goalTitle = useGoalTitle();
  const goal = progress.goal;
  const unit = (count: number) => plural(goalUnitKey(goal.kind), count);
  const status = progress.reached ? t("goal_reached") : progress.daysLeft <= 0 ? t("goal_over") : t(progress.ahead ? "goal_ahead" : "goal_behind");
  let hint: string | null = null;
  if (progress.perDay !== null) {
    if (goal.kind === "BOOKS" && progress.perDay < 1) {
      // "A book every N days" reads better than "0.07 books a day".
      hint = t("goal_hint_book_every", Math.max(1, Math.floor(progress.daysLeft / Math.max(1, progress.remaining))));
    } else {
      const amount = Math.ceil(progress.perDay);
      hint = t("goal_hint_per_day", amount, unit(amount));
    }
  }
  return (
    <Card testId="goal-card">
      <div className="goal-card">
        <Ring fraction={progress.fraction} good={progress.reached} />
        <button type="button" className="entry-button grow" onClick={onEdit} aria-label={`${t("goal_edit")}: ${goalTitle(goal)}`}>
          <span className="strong" style={{ display: "block" }}>
            {goalTitle(goal)}
          </span>
          <span style={{ display: "block" }} data-testid="goal-done">
            {t("goal_done_of", progress.done, goal.target, unit(goal.target))}
          </span>
          <span className={progress.reached || progress.ahead ? "status-good" : "status-bad"} style={{ display: "block" }}>
            {status}
          </span>
          {hint ? <span className="small muted" style={{ display: "block" }}>{hint}</span> : null}
          <span className="small muted" style={{ display: "block" }}>
            {t("goal_period", formatDay(progress.start, locale), formatDay(progress.end, locale)) + " · " + plural("days_left", progress.daysLeft)}
          </span>
        </button>
        <IconButton icon="delete" label={`${t("action_delete")}: ${goalTitle(goal)}`} className="muted" onClick={onDelete} />
      </div>
    </Card>
  );
}

function GoalDialog({ goal, isNew, onClose }: { goal: Goal; isNew: boolean; onClose: () => void }) {
  const { t, plural } = useI18n();
  const { mutate } = useLibrary();
  const [name, setName] = useState(goal.name);
  const [kind, setKind] = useState<GoalKind>(goal.kind);
  const [target, setTarget] = useState(String(goal.target));
  const [repeat, setRepeat] = useState<GoalRepeat>(goal.repeat);
  const [start, setStart] = useState(toIsoDate(goal.startDay));
  const [end, setEnd] = useState(toIsoDate(goal.endDay));
  const amount = target === "" ? 0 : Number(target);
  const startDay = fromIsoDate(start);
  const endDay = fromIsoDate(end);
  const valid = amount > 0 && (repeat !== "ONCE" || (startDay !== null && endDay !== null && endDay >= startDay));
  const capital = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

  const save = () => {
    if (!valid) return;
    void mutate(saveGoal({ ...goal, name: name.trim(), kind, target: amount, repeat, startDay: startDay ?? goal.startDay, endDay: endDay ?? goal.endDay }));
    onClose();
  };

  return (
    <Dialog
      title={t(isNew ? "goal_new" : "goal_edit")}
      onClose={onClose}
      testId="goal-dialog"
      actions={
        <>
          <Button variant="text" onClick={onClose}>
            {t("action_cancel")}
          </Button>
          <Button onClick={save} disabled={!valid} data-testid="goal-save">
            {t("action_save")}
          </Button>
        </>
      }
    >
      <p className="label-small">{t("goal_what")}</p>
      <div className="chips">
        {GOAL_KINDS.map((k) => (
          <Chip key={k} selected={kind === k} onClick={() => setKind(k)} data-testid={`goal-kind-${k}`}>
            {capital(plural(goalUnitKey(k), 2))}
          </Chip>
        ))}
      </div>
      <Field label={t("goal_target")} inputMode="numeric" value={target} onChange={(event) => setTarget(digits(event.target.value))} data-testid="goal-target" />
      <p className="label-small">{t("goal_when")}</p>
      <div className="chips">
        {GOAL_REPEATS.map((r) => (
          <Chip key={r} selected={repeat === r} onClick={() => setRepeat(r)} data-testid={`goal-repeat-${r}`}>
            {t(repeatKey(r))}
          </Chip>
        ))}
      </div>
      {repeat === "ONCE" ? (
        <div className="field-row">
          <Field label={t("goal_from", "").trim()} type="date" value={start} onChange={(event) => setStart(event.target.value)} />
          <Field label={t("goal_until", "").trim()} type="date" value={end} onChange={(event) => setEnd(event.target.value)} />
        </div>
      ) : null}
      <Field label={t("goal_name")} value={name} onChange={(event) => setName(event.target.value.slice(0, 60))} />
    </Dialog>
  );
}

export default function GoalsPage() {
  const { t } = useI18n();
  const { vault, mutate } = useLibrary();
  const [editing, setEditing] = useState<{ goal: Goal; isNew: boolean } | null>(null);
  const [deleting, setDeleting] = useState<Goal | null>(null);
  const day = today();
  const progress = vault.goals.filter((g) => !g.archived).map((g) => goalProgress(g, vault.books, vault.sessions, day));

  const create = () => {
    const { year } = fromEpochDay(day);
    // A new goal starts as "twelve books this year", the one most people set.
    setEditing({
      isNew: true,
      goal: { ...goalCodec.read({}), id: newId(), kind: "BOOKS", target: 12, startDay: toEpochDay(year, 1, 1), endDay: toEpochDay(year, 12, 31), repeat: "YEARLY", createdAt: Date.now() },
    });
  };

  return (
    <div className="page" data-testid="goals-page">
      <PageHead title={t("goals_title")} back="/stats">
        <Button icon="add" onClick={create} data-testid="new-goal">
          {t("goal_new")}
        </Button>
      </PageHead>
      {progress.length === 0 ? <EmptyHint>{t("goals_empty")}</EmptyHint> : null}
      {progress.map((item) => (
        <GoalCard key={item.goal.id} progress={item} onEdit={() => setEditing({ goal: item.goal, isNew: false })} onDelete={() => setDeleting(item.goal)} />
      ))}
      {editing ? <GoalDialog goal={editing.goal} isNew={editing.isNew} onClose={() => setEditing(null)} /> : null}
      {deleting ? (
        <ConfirmDialog
          title={t("web_delete_goal_title")}
          confirm={t("action_delete")}
          danger
          onClose={() => setDeleting(null)}
          onConfirm={() => {
            void mutate(deleteGoal(deleting.id));
            setDeleting(null);
          }}
        />
      ) : null}
    </div>
  );
}
