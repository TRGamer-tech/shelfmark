package ch.schmidtbit.shelfmark.data.model

/**
 * Moves a book to another built-in list and keeps the reading dates in step:
 * starting a book stamps the start date, finishing it stamps the end date.
 * Dates the user already entered are never overwritten.
 */
fun Book.withStatus(newStatus: ReadingStatus, today: Long): Book {
    if (newStatus == status) return this
    val moved = copy(status = newStatus)
    return when (newStatus) {
        ReadingStatus.READING -> moved.copy(startedOn = startedOn ?: today, finishedOn = null)
        ReadingStatus.READ -> moved.copy(
            finishedOn = finishedOn ?: today,
            currentPage = if (pageCount > 0) pageCount else currentPage,
        )
        ReadingStatus.ABANDONED, ReadingStatus.WISHLIST, ReadingStatus.NONE -> moved
    }
}

/** Sensible defaults for a book that is being added to the given list. */
fun Book.withDefaultsFor(newStatus: ReadingStatus, today: Long): Book {
    val owned = if (newStatus == ReadingStatus.WISHLIST) Ownership.NOT_OWNED else ownership
    val physical = format != BookFormat.EBOOK && format != BookFormat.AUDIOBOOK
    return copy(ownership = owned, lendable = physical).withStatus(newStatus, today)
}

/** Reading progress from 0 to 1, or null when it cannot be computed. */
val Book.progress: Float?
    get() = if (pageCount > 0 && currentPage > 0) (currentPage.toFloat() / pageCount).coerceIn(0f, 1f) else null
