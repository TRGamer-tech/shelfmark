"use client";

import { useEffect, useState } from "react";
import { bookColor, clothGradient, inkOn } from "@/lib/shelf";

interface Props {
  title: string;
  authors: string;
  /** Address of the cover picture, or null for a book without one. */
  url: string | null;
  /** For covers the size of a thumbnail: a drawn cover then shows one letter instead of small print. */
  tiny?: boolean;
  className?: string;
}

/**
 * A book's front. Shows the cover picture when there is one and it loads, otherwise a
 * drawn cloth cover with title and author, so every book looks like a book.
 */
export function BookCover({ title, authors, url, tiny = false, className }: Props) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [url]);
  const ink = inkOn(bookColor(title));
  return (
    <span className={`cover ${className ?? ""}`} style={{ background: clothGradient(title), color: ink }}>
      {tiny ? (
        <span className="cover-letter" aria-hidden="true">
          {title.trim().slice(0, 1).toUpperCase()}
        </span>
      ) : (
        <span className="cover-drawn" aria-hidden="true">
          <span className="cover-title">{title}</span>
          <span className="cover-rule" />
          {authors.trim() !== "" ? <span className="cover-author">{authors}</span> : null}
        </span>
      )}
      {url && !failed ? <img src={url} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} data-testid="cover-image" /> : null}
    </span>
  );
}
