"use client";

import { useRef } from "react";
import { formatRating, nextRating } from "@/lib/libraryLogic";
import { Icon } from "./icons";
import { useI18n } from "./i18n";

/** One to five stars with half steps. Read-only when [onChange] is missing. */
export function RatingBar({ rating, size = 20, onChange }: { rating: number; size?: number; onChange?: (rating: number) => void }) {
  const { t, locale } = useI18n();
  const description = t("rating_description", formatRating(rating, locale));
  const last = useRef(rating);
  const grown = rating > last.current;
  last.current = rating;
  const stars = [1, 2, 3, 4, 5].map((star) => {
    const icon = rating >= star ? "star" : rating >= star - 0.5 ? "starHalf" : "starOutline";
    const on = rating >= star - 0.5;
    return { star, icon, on } as const;
  });
  if (!onChange) {
    return (
      <span className="rating" role="img" aria-label={description}>
        {stars.map(({ star, icon, on }) => (
          <Icon key={star} name={icon} size={size} className={on ? "star-on" : "star-off"} />
        ))}
      </span>
    );
  }
  return (
    <span className="rating" role="group" aria-label={description}>
      {stars.map(({ star, icon, on }) => (
        <button
          key={star}
          type="button"
          // Tapping a star gives that many, tapping it again takes half a star off, a third time clears.
          aria-label={t("rating_description", formatRating(nextRating(rating, star), locale))}
          onClick={() => onChange(nextRating(rating, star))}
          data-testid={`star${star}`}
        >
          <Icon name={icon} size={size} className={`${on ? "star-on" : "star-off"} ${on && grown ? "pop" : ""}`} />
        </button>
      ))}
    </span>
  );
}

/** Spice level from one to five chillies. Tapping the current level clears it. */
export function SpiceBar({ level, size = 20, onChange }: { level: number; size?: number; onChange?: (level: number) => void }) {
  const { t } = useI18n();
  const description = t("spice_description", level);
  const chillies = [1, 2, 3, 4, 5];
  if (!onChange) {
    return (
      <span className="rating" role="img" aria-label={description}>
        {chillies.map((i) => (
          <Icon key={i} name="chilli" size={size} className={i <= level ? "chilli-on" : "chilli-off"} />
        ))}
      </span>
    );
  }
  return (
    <span className="rating" role="group" aria-label={description}>
      {chillies.map((i) => (
        <button key={i} type="button" aria-label={t("spice_description", level === i ? 0 : i)} onClick={() => onChange(level === i ? 0 : i)} data-testid={`spice${i}`}>
          <Icon name="chilli" size={size} className={i <= level ? "chilli-on" : "chilli-off"} />
        </button>
      ))}
    </span>
  );
}
