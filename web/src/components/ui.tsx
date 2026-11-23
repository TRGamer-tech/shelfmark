"use client";

// The building blocks of the pages: buttons, chips, cards, fields and dialogs. They are
// plain HTML elements with the look of the app, so keyboard and screen reader work as
// they do everywhere on the web.

import Link from "next/link";
import { useId, useLayoutEffect, useRef, useState } from "react";
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, TextareaHTMLAttributes } from "react";
import { Icon } from "./icons";
import type { IconName } from "./icons";
import { useI18n } from "./i18n";

type Variant = "filled" | "tonal" | "outline" | "text" | "danger";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  icon?: IconName;
  wide?: boolean;
}

export function Button({ variant = "filled", icon, wide, className, children, type, ...rest }: ButtonProps) {
  const classes = ["btn", `btn-${variant}`, wide ? "btn-wide" : "", className ?? ""].filter(Boolean).join(" ");
  return (
    <button type={type ?? "button"} className={classes} {...rest}>
      {icon ? <Icon name={icon} size={18} /> : null}
      <span>{children}</span>
    </button>
  );
}

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: IconName;
  /** What the button does, for those who cannot see the icon. */
  label: string;
  size?: number;
}

export function IconButton({ icon, label, size = 24, className, type, ...rest }: IconButtonProps) {
  return (
    <button type={type ?? "button"} className={`icon-btn ${className ?? ""}`} aria-label={label} title={label} {...rest}>
      <Icon name={icon} size={size} />
    </button>
  );
}

export function IconLink({ href, icon, label }: { href: string; icon: IconName; label: string }) {
  return (
    <Link href={href} className="icon-btn" aria-label={label} title={label}>
      <Icon name={icon} />
    </Link>
  );
}

interface ChipProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  selected?: boolean;
  count?: number;
  icon?: IconName;
}

/** A filter chip: a toggle button that says whether it is on. */
export function Chip({ selected = false, count, icon, children, className, ...rest }: ChipProps) {
  return (
    <button type="button" className={`chip ${selected ? "chip-on" : ""} ${className ?? ""}`} aria-pressed={selected} {...rest}>
      {icon ? <Icon name={icon} size={18} /> : null}
      <span>{children}</span>
      {count !== undefined ? <span className="chip-count">{count}</span> : null}
    </button>
  );
}

/** A titled card, the building block of the detail pages. */
export function Card({ title, children, className, testId }: { title?: string | null; children: ReactNode; className?: string; testId?: string }) {
  return (
    <section className={`card ${className ?? ""}`} data-testid={testId}>
      {title ? <h2 className="card-title">{title}</h2> : null}
      {children}
    </section>
  );
}

export function EmptyHint({ children }: { children: ReactNode }) {
  return <p className="empty-hint">{children}</p>;
}

export function ProgressBar({ value, label, good }: { value: number; label?: string; good?: boolean }) {
  const percent = Math.round(Math.min(1, Math.max(0, value)) * 100);
  return (
    <div className={`progress ${good ? "progress-good" : ""}`} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} aria-label={label}>
      <div className="progress-fill" style={{ width: `${percent}%` }} />
    </div>
  );
}

interface FieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  hint?: string;
  error?: string | null;
}

export function Field({ label, hint, error, className, id, ...rest }: FieldProps) {
  const generated = useId();
  const fieldId = id ?? generated;
  const describedBy = error ? `${fieldId}-error` : hint ? `${fieldId}-hint` : undefined;
  return (
    <div className={`field ${className ?? ""}`}>
      <label htmlFor={fieldId}>{label}</label>
      <input id={fieldId} aria-describedby={describedBy} aria-invalid={error ? true : undefined} {...rest} />
      {error ? (
        <p className="field-error" id={`${fieldId}-error`} role="alert">
          {error}
        </p>
      ) : hint ? (
        <p className="field-hint" id={`${fieldId}-hint`}>
          {hint}
        </p>
      ) : null}
    </div>
  );
}

interface AreaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label: string;
}

export function TextArea({ label, className, id, ...rest }: AreaProps) {
  const generated = useId();
  const fieldId = id ?? generated;
  return (
    <div className={`field ${className ?? ""}`}>
      <label htmlFor={fieldId}>{label}</label>
      <textarea id={fieldId} {...rest} />
    </div>
  );
}

/** Digits only, as the number fields of the app. */
export function digits(text: string, max = 6): string {
  return text.replace(/\D/g, "").slice(0, max);
}

export function Switch({ checked, onChange, label, hint, testId }: { checked: boolean; onChange: (value: boolean) => void; label: string; hint?: string; testId?: string }) {
  const id = useId();
  return (
    <div className="switch-row">
      <label htmlFor={id} className="switch-text">
        <span>{label}</span>
        {hint ? <span className="switch-hint">{hint}</span> : null}
      </label>
      <input id={id} type="checkbox" role="switch" className="switch" checked={checked} onChange={(event) => onChange(event.target.checked)} data-testid={testId} />
    </div>
  );
}

interface DialogProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
  /** Buttons at the bottom, the one that confirms last. */
  actions?: ReactNode;
  wide?: boolean;
  testId?: string;
}

/**
 * A modal dialog. The browser's own dialog element keeps the keyboard inside it, closes
 * on Escape and gives the focus back to where it came from.
 */
export function Dialog({ title, onClose, children, actions, wide, testId }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const { t } = useI18n();

  // A layout effect, so that closing happens while the dialog is still part of the page.
  // Only then can the focus go back to the button that opened it.
  useLayoutEffect(() => {
    const dialog = ref.current;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (dialog && !dialog.open) dialog.showModal();
    return () => {
      if (dialog?.open) dialog.close();
      if (opener && opener.isConnected && !opener.closest("dialog:not([open])")) opener.focus();
    };
  }, []);

  return (
    <dialog
      ref={ref}
      className={`dialog ${wide ? "dialog-wide" : ""}`}
      aria-labelledby={titleId}
      data-testid={testId}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        // A click on the dimmed page around the dialog closes it.
        if (event.target === ref.current) onClose();
      }}
    >
      <div className="dialog-inner">
        <header className="dialog-head">
          <h2 id={titleId}>{title}</h2>
          <IconButton icon="close" label={t("action_close")} onClick={onClose} />
        </header>
        <div className="dialog-body">{children}</div>
        {actions ? <footer className="dialog-actions">{actions}</footer> : null}
      </div>
    </dialog>
  );
}

interface ConfirmProps {
  title: string;
  text?: string;
  confirm: string;
  danger?: boolean;
  onConfirm: () => void;
  onClose: () => void;
  testId?: string;
}

export function ConfirmDialog({ title, text, confirm, danger, onConfirm, onClose, testId }: ConfirmProps) {
  const { t } = useI18n();
  return (
    <Dialog
      title={title}
      onClose={onClose}
      testId={testId}
      actions={
        <>
          <Button variant="text" onClick={onClose}>
            {t("action_cancel")}
          </Button>
          <Button variant={danger ? "danger" : "filled"} onClick={onConfirm} data-testid="confirm">
            {confirm}
          </Button>
        </>
      }
    >
      {text ? <p>{text}</p> : null}
    </Dialog>
  );
}

/** Asks for one line of text: the name of a list, of a person, and so on. */
export function NameDialog({ title, label, initial, onSave, onClose, maxLength = 60 }: { title: string; label: string; initial: string; onSave: (name: string) => void; onClose: () => void; maxLength?: number }) {
  const { t } = useI18n();
  const [name, setName] = useState(initial);
  const valid = name.trim() !== "";
  return (
    <Dialog
      title={title}
      onClose={onClose}
      actions={
        <>
          <Button variant="text" onClick={onClose}>
            {t("action_cancel")}
          </Button>
          <Button type="submit" form="name-form" disabled={!valid} data-testid="name-save">
            {t("action_save")}
          </Button>
        </>
      }
    >
      <form
        id="name-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (valid) onSave(name.trim());
        }}
      >
        <Field label={label} value={name} onChange={(event) => setName(event.target.value.slice(0, maxLength))} autoFocus data-testid="name-field" />
      </form>
    </Dialog>
  );
}

export interface TabItem {
  key: string;
  label: string;
}

export function Tabs({ tabs, current, onChange, label }: { tabs: TabItem[]; current: string; onChange: (key: string) => void; label: string }) {
  return (
    <div className="tabs" role="tablist" aria-label={label}>
      {tabs.map((tab) => (
        <button key={tab.key} type="button" role="tab" aria-selected={tab.key === current} className={`tab ${tab.key === current ? "tab-on" : ""}`} onClick={() => onChange(tab.key)} data-testid={`tab-${tab.key}`}>
          {tab.label}
        </button>
      ))}
    </div>
  );
}

/** The head of a page: where one can go back to, what the page is, and what can be done on it. */
export function PageHead({ title, back, children, subtitle }: { title: string; back?: string; children?: ReactNode; subtitle?: string }) {
  const { t } = useI18n();
  return (
    <header className="page-head">
      {back ? <IconLink href={back} icon="back" label={t("action_back")} /> : null}
      <div className="page-head-text">
        <h1>{title}</h1>
        {subtitle ? <p className="page-sub">{subtitle}</p> : null}
      </div>
      {children ? <div className="page-actions">{children}</div> : null}
    </header>
  );
}

export function Stat({ value, label, footnote }: { value: string; label: string; footnote?: string | null }) {
  return (
    <div className="tile">
      <div className={`tile-value ${value.length > 7 ? "tile-value-long" : ""}`}>{value}</div>
      <div className="tile-label">{label}</div>
      {footnote ? <div className="tile-foot">{footnote}</div> : null}
    </div>
  );
}
