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
        // Picking up a finished book again is a re-read: it starts from the first page.
        ReadingStatus.READING ->
            if (status == ReadingStatus.READ) moved.copy(startedOn = today, finishedOn = null, currentPage = 0)
            else moved.copy(startedOn = startedOn ?: today, finishedOn = null)
        ReadingStatus.READ -> moved.copy(
            finishedOn = finishedOn ?: today,
            currentPage = if (pageCount > 0) pageCount else currentPage,
            readCount = readCount + 1,
        )
        ReadingStatus.ABANDONED, ReadingStatus.WISHLIST, ReadingStatus.NONE -> moved
    }
}

/**
 * Takes back a move to another list. [before] is the book as it was when it was moved:
 * the list, the reading dates, the bookmark and the number of reads are what a move
 * changes, and they are put back. Whatever else happened to the book since stays.
 */
fun Book.withStatusOf(before: Book): Book =
    copy(status = before.status, startedOn = before.startedOn, finishedOn = before.finishedOn, currentPage = before.currentPage, readCount = before.readCount)

/**
 * What saving the edit form does to a book. [opened] is the book as the form found it,
 * [form] what the reader made of it, and this is the book as it is stored at the moment
 * of saving, which a sync or another screen may have changed while the form stood open.
 * Only what the form shows is taken from it, and of that only what the reader changed:
 * the stars, the list, the review and everything else the form never showed stay as they
 * are stored, and so does a field the reader left alone.
 */
fun Book.withFormOf(opened: Book, form: Book): Book {
    fun <T> pick(of: (Book) -> T): T = if (of(form) != of(opened)) of(form) else of(this)
    return copy(
        title = pick { it.title },
        subtitle = pick { it.subtitle },
        authors = pick { it.authors },
        isbn = pick { it.isbn },
        publisher = pick { it.publisher },
        publishedYear = pick { it.publishedYear },
        language = pick { it.language },
        pageCount = pick { it.pageCount },
        format = pick { it.format },
        description = pick { it.description },
        coverUrl = pick { it.coverUrl },
        coverPath = pick { it.coverPath },
        genres = pick { it.genres },
        tags = pick { it.tags },
        series = pick { it.series },
        seriesPosition = pick { it.seriesPosition },
    )
}

/** Sensible defaults for a book that is being added to the given list. */
fun Book.withDefaultsFor(newStatus: ReadingStatus, today: Long): Book {
    val owned = if (newStatus == ReadingStatus.WISHLIST) Ownership.NOT_OWNED else ownership
    val physical = format != BookFormat.EBOOK && format != BookFormat.AUDIOBOOK
    return copy(ownership = owned, lendable = physical).withStatus(newStatus, today)
}

val Book.isAudio: Boolean get() = format == BookFormat.AUDIOBOOK

fun Book.genreList(): List<String> = genres.split(',').map { it.trim() }.filter { it.isNotEmpty() }

fun Book.tagList(): List<String> = tags.split(',').map { it.trim() }.filter { it.isNotEmpty() }

/** Reading progress from 0 to 1, or null when it cannot be computed. */
val Book.progress: Float?
    get() = if (pageCount > 0 && currentPage > 0) (currentPage.toFloat() / pageCount).coerceIn(0f, 1f) else null
