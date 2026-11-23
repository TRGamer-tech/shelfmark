"use client";

import { useEffect, useId, useRef, useState } from "react";

interface Props {
  value: string;
  label: string;
  rows?: number;
  onSave: (text: string) => void;
  testId?: string;
}

/**
 * A text field that saves itself shortly after the reader stops typing, when it loses
 * the focus, and once more when the page is left, so nothing typed into a review gets
 * lost. What arrives from another device is shown too, unless the reader is in the
 * middle of typing: then their words win.
 */
export function AutoSaveField({ value, label, rows = 1, onSave, testId }: Props) {
  const id = useId();
  const [text, setText] = useState(value);
  const latest = useRef(text);
  latest.current = text;
  /** The text the library holds, as far as this field knows. */
  const saved = useRef(value);
  const save = useRef(onSave);
  save.current = onSave;

  useEffect(() => {
    if (value === saved.current) return;
    if (latest.current === saved.current) setText(value);
    saved.current = value;
  }, [value]);

  const flush = () => {
    if (latest.current === saved.current) return;
    saved.current = latest.current;
    save.current(latest.current);
  };

  useEffect(() => {
    if (text === saved.current) return;
    const timer = window.setTimeout(flush, 700);
    return () => window.clearTimeout(timer);
  }, [text]);

  // Leaving the page must not lose the last few words.
  useEffect(() => flush, []);

  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {rows > 1 ? (
        <textarea id={id} rows={rows} value={text} onChange={(event) => setText(event.target.value)} onBlur={flush} data-testid={testId} />
      ) : (
        <input id={id} value={text} onChange={(event) => setText(event.target.value)} onBlur={flush} data-testid={testId} />
      )}
    </div>
  );
}
