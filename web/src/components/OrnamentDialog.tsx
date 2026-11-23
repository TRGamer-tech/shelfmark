"use client";

import { newId } from "@/lib/ids";
import { ORNAMENT_KINDS } from "@/lib/model";
import { addOrnament, deleteOrnament, moveOrnament } from "@/lib/mutations";
import { useI18n } from "./i18n";
import { useLibrary } from "./library";
import { OrnamentView, ornamentLabelKey } from "./Ornaments";
import { Button, Dialog, IconButton } from "./ui";

/** Choose what stands between the books of one shelf, and where. */
export function OrnamentDialog({ shelfKey, shelfName, bookCount, onClose }: { shelfKey: string; shelfName: string; bookCount: number; onClose: () => void }) {
  const { t, plural } = useI18n();
  const { vault, mutate } = useLibrary();
  const mine = vault.ornaments.filter((o) => o.shelfKey === shelfKey).sort((a, b) => a.position - b.position);
  return (
    <Dialog
      title={t("ornament_dialog_title", shelfName)}
      onClose={onClose}
      testId="ornament-dialog"
      actions={
        <Button variant="text" onClick={onClose} data-testid="ornament-done">
          {t("action_ok")}
        </Button>
      }
    >
      <p className="label-small">{t("ornament_add")}</p>
      <div className="chips">
        {ORNAMENT_KINDS.map((kind) => (
          <button
            key={kind}
            type="button"
            className="icon-btn"
            style={{ width: 56, height: 56, borderRadius: 12, alignItems: "end", paddingBottom: 4 }}
            aria-label={`${t("ornament_add")}: ${t(ornamentLabelKey(kind))}`}
            title={t(ornamentLabelKey(kind))}
            // New ornaments go to the end of the shelf and can be moved from there.
            onClick={() => void mutate(addOrnament(newId(), shelfKey, kind, bookCount))}
            data-testid={`add-ornament-${kind}`}
          >
            <OrnamentView kind={kind} scale={0.6} decorative lively={false} />
          </button>
        ))}
      </div>
      {mine.length > 0 ? <p className="label-small">{t("ornament_on_shelf")}</p> : null}
      <div>
        {mine.map((ornament) => {
          const position = Math.min(ornament.position, bookCount);
          const name = t(ornamentLabelKey(ornament.kind));
          return (
            <div key={ornament.id} className="entry" data-testid="ornament-row" style={{ alignItems: "center" }}>
              <span style={{ width: 40, display: "grid", placeItems: "center" }}>
                <OrnamentView kind={ornament.kind} scale={0.45} decorative lively={false} />
              </span>
              <div className="entry-main">
                <div>{name}</div>
                <div className="small muted">{ornament.position <= 0 ? t("ornament_at_start") : plural("ornament_after", position)}</div>
              </div>
              <IconButton icon="left" label={`${t("ornament_move_left")}: ${name}`} disabled={ornament.position <= 0} onClick={() => void mutate(moveOrnament(ornament.id, position - 1))} />
              <IconButton icon="right" label={`${t("ornament_move_right")}: ${name}`} disabled={ornament.position >= bookCount} onClick={() => void mutate(moveOrnament(ornament.id, ornament.position + 1))} />
              <IconButton icon="delete" label={`${t("action_delete")}: ${name}`} onClick={() => void mutate(deleteOrnament(ornament.id))} />
            </div>
          );
        })}
      </div>
    </Dialog>
  );
}
