package ch.schmidtbit.shelfmark.data.model

import kotlin.math.roundToInt

/** Pace and time estimates for a book, derived from its logged sessions. */
object ReadingMath {
    /**
     * Minutes per page for this book: measured from the timed sessions when there are any,
     * otherwise the reader's general speed.
     */
    fun pace(sessions: List<ReadingSession>, fallback: Float): Float {
        val timed = sessions.filter { it.minutes > 0f && it.pages > 0 }
        val pages = timed.sumOf { it.pages }
        if (pages < 5) return fallback
        return (timed.sumOf { it.minutes.toDouble() } / pages).toFloat().coerceIn(0.2f, 15f)
    }

    /** Estimated minutes left in the book, or null when the length is unknown or it is finished. */
    fun minutesLeft(book: Book, sessions: List<ReadingSession>, fallbackPace: Float): Int? {
        if (book.pageCount <= 0 || book.currentPage >= book.pageCount) return null
        val left = book.pageCount - book.currentPage
        // An audiobook's "pages" are minutes already.
        return if (book.isAudio) left else (left * pace(sessions, fallbackPace)).roundToInt()
    }

    fun totalMinutes(sessions: List<ReadingSession>): Int = sessions.sumOf { it.minutes.toDouble() }.roundToInt()

    fun totalPages(sessions: List<ReadingSession>): Int = sessions.sumOf { it.pages }
}
