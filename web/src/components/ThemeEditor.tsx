"use client";

// Build a theme of one's own from four colours: background, cards, accent and text
// (ui/settings/ThemeEditor.kt).

import { useState } from "react";
import type { CustomTheme } from "@/lib/model";
import { argbOfRgb, hexOf, hsvOfRgb, parseHex, rgbOfArgb, rgbOfHsv } from "@/lib/theme";
import { useI18n } from "./i18n";
import { Button, Dialog, Field } from "./ui";

/** Hue, saturation and brightness sliders, plus a field for those who know their hex codes. */
function ColourPicker({ initial, onPick, onClose }: { initial: number; onPick: (argb: number) => void; onClose: () => void }) {
  const { t } = useI18n();
  const [hsv, setHsv] = useState(() => hsvOfRgb(rgbOfArgb(initial)));
  const [hex, setHex] = useState(hexOf(initial));
  const argb = argbOfRgb(rgbOfHsv(hsv[0], hsv[1], hsv[2]));

  const slide = (index: number, value: number) => {
    const next: [number, number, number] = [hsv[0], hsv[1], hsv[2]];
    next[index] = value;
    setHsv(next);
    setHex(hexOf(argbOfRgb(rgbOfHsv(next[0], next[1], next[2]))));
  };

  return (
    <Dialog
      title={t("theme_pick_colour")}
      onClose={onClose}
      testId="colour-picker"
      actions={
        <>
          <Button variant="text" onClick={onClose}>
            {t("action_cancel")}
          </Button>
          <Button onClick={() => onPick(argb)} data-testid="colour-ok">
            {t("action_ok")}
          </Button>
        </>
      }
    >
      <div className="colour-big" style={{ background: hexOf(argb) }} />
      <div className="field">
        <label htmlFor="slider-hue">{t("theme_hue")}</label>
        <input id="slider-hue" type="range" min={0} max={360} step={1} value={hsv[0]} onChange={(event) => slide(0, Number(event.target.value))} />
      </div>
      <div className="field">
        <label htmlFor="slider-saturation">{t("theme_saturation")}</label>
        <input id="slider-saturation" type="range" min={0} max={1} step={0.01} value={hsv[1]} onChange={(event) => slide(1, Number(event.target.value))} />
      </div>
      <div className="field">
        <label htmlFor="slider-brightness">{t("theme_brightness")}</label>
        <input id="slider-brightness" type="range" min={0} max={1} step={0.01} value={hsv[2]} onChange={(event) => slide(2, Number(event.target.value))} />
      </div>
      <Field
        label={t("theme_hex")}
        value={hex}
        onChange={(event) => {
          const typed = event.target.value.slice(0, 7);
          setHex(typed);
          const parsed = parseHex(typed);
          if (parsed !== null) setHsv(hsvOfRgb(rgbOfArgb(parsed)));
        }}
        spellCheck={false}
        autoCapitalize="characters"
        data-testid="colour-hex"
      />
    </Dialog>
  );
}

type Part = "background" | "card" | "accent" | "text";
const PARTS: [Part, string][] = [
  ["background", "theme_background"],
  ["card", "theme_card"],
  ["accent", "theme_accent"],
  ["text", "theme_text"],
];

interface Props {
  existing: CustomTheme | null;
  onSave: (theme: CustomTheme) => void;
  onDelete: (() => void) | null;
  onClose: () => void;
}

export function ThemeEditor({ existing, onSave, onDelete, onClose }: Props) {
  const { t } = useI18n();
  const [name, setName] = useState(existing?.name ?? "");
  // A new theme starts from the warm dark default, so there is something to change.
  const [colours, setColours] = useState<Record<Part, number>>({
    background: existing?.background ?? (0xff1f1a17 | 0),
    card: existing?.card ?? (0xff2c2622 | 0),
    accent: existing?.accent ?? (0xffe5873f | 0),
    text: existing?.text ?? (0xfff0eae4 | 0),
  });
  const [picking, setPicking] = useState<Part | null>(null);

  const save = () => {
    if (name.trim() === "") return;
    // What a newer app stored with the theme is carried along.
    onSave({ ...(existing ?? {}), id: existing?.id ?? crypto.randomUUID(), name: name.trim(), ...colours });
  };

  return (
    <Dialog
      title={t(existing ? "theme_edit" : "theme_new")}
      onClose={onClose}
      testId="theme-editor"
      actions={
        <>
          {onDelete ? (
            <Button variant="text" onClick={onDelete} data-testid="theme-delete">
              {t("action_delete")}
            </Button>
          ) : null}
          <Button variant="text" onClick={onClose}>
            {t("action_cancel")}
          </Button>
          <Button onClick={save} disabled={name.trim() === ""} data-testid="theme-save">
            {t("action_save")}
          </Button>
        </>
      }
    >
      <Field label={t("lists_name")} value={name} onChange={(event) => setName(event.target.value.slice(0, 24))} autoFocus data-testid="theme-name" />
      {/* A small preview of how the four colours work together. */}
      <div className="theme-sample" style={{ background: hexOf(colours.background) }} data-testid="theme-preview">
        <div className="theme-sample-card" style={{ background: hexOf(colours.card), color: hexOf(colours.text) }}>
          <p className="strong">{name.trim() !== "" ? name : t("theme_new")}</p>
          <p className="small" style={{ opacity: 0.75 }}>
            {t("theme_preview_text")}
          </p>
          <div style={{ width: 72, height: 8, borderRadius: 4, marginTop: 6, background: hexOf(colours.accent) }} />
        </div>
      </div>
      <div>
        {PARTS.map(([part, label]) => (
          <button key={part} type="button" className="colour-row" onClick={() => setPicking(part)} data-testid={`colour-${part}`}>
            <span className="colour-dot" style={{ background: hexOf(colours[part]) }} />
            <span className="grow">{t(label)}</span>
            <span className="small muted strong">{hexOf(colours[part])}</span>
          </button>
        ))}
      </div>
      {picking ? (
        <ColourPicker
          initial={colours[picking]}
          onClose={() => setPicking(null)}
          onPick={(argb) => {
            setColours({ ...colours, [picking]: argb });
            setPicking(null);
          }}
        />
      ) : null}
    </Dialog>
  );
}
