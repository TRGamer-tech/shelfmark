// The names of the texts for the values a book can have (ui/Common.kt in the app).

import type { BookFormat, GoalKind, GoalRepeat, LendStatus, Ownership, ReadingStatus, SortOrder, ViewMode } from "@/lib/model";

export function statusKey(status: ReadingStatus | string): string {
  switch (status) {
    case "WISHLIST":
      return "status_wishlist";
    case "READING":
      return "status_reading";
    case "READ":
      return "status_read";
    case "ABANDONED":
      return "status_abandoned";
    default:
      return "status_unread";
  }
}

export function formatKey(format: BookFormat | string): string {
  switch (format) {
    case "HARDCOVER":
      return "format_hardcover";
    case "PAPERBACK":
      return "format_paperback";
    case "EBOOK":
      return "format_ebook";
    case "AUDIOBOOK":
      return "format_audiobook";
    case "OTHER":
      return "format_other";
    default:
      return "format_unknown";
  }
}

export function ownershipKey(ownership: Ownership | string): string {
  switch (ownership) {
    case "BORROWED":
      return "ownership_borrowed";
    case "NOT_OWNED":
      return "ownership_not_owned";
    default:
      return "ownership_owned";
  }
}

export function lendStatusKey(status: LendStatus | string): string {
  switch (status) {
    case "ACCEPTED":
      return "request_accepted";
    case "DECLINED":
      return "request_declined";
    default:
      return "request_pending";
  }
}

export function sortKeyOf(order: SortOrder | string): string {
  switch (order) {
    case "TITLE":
      return "sort_title";
    case "AUTHOR":
      return "sort_author";
    case "RATING":
      return "sort_rating";
    default:
      return "sort_added";
  }
}

export function viewKey(mode: ViewMode | string): string {
  switch (mode) {
    case "SPINES":
      return "view_spines";
    case "LIST":
      return "view_list";
    default:
      return "view_covers";
  }
}

export function repeatKey(repeat: GoalRepeat | string): string {
  switch (repeat) {
    case "DAILY":
      return "goal_repeat_daily";
    case "WEEKLY":
      return "goal_repeat_weekly";
    case "MONTHLY":
      return "goal_repeat_monthly";
    case "YEARLY":
      return "goal_repeat_yearly";
    default:
      return "goal_repeat_once";
  }
}

/** The plural that names what a goal counts: "book"/"books" and so on. */
export function goalUnitKey(kind: GoalKind | string): string {
  switch (kind) {
    case "PAGES":
      return "unit_pages_plural";
    case "MINUTES":
      return "unit_minutes_plural";
    default:
      return "unit_books";
  }
}
