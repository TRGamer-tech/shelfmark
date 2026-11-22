package ch.schmidtbit.shelfmark.data.stats

import ch.schmidtbit.shelfmark.data.model.Book
import ch.schmidtbit.shelfmark.data.model.Purchase
import ch.schmidtbit.shelfmark.data.model.ReadingSession
import ch.schmidtbit.shelfmark.data.model.ReadingStatus
import ch.schmidtbit.shelfmark.data.model.genreList
import ch.schmidtbit.shelfmark.data.model.isAudio
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import kotlin.math.roundToInt

/** Everything that happened on one day. */
data class DaySummary(
    val day: Long,
    val pages: Int = 0,
    val minutes: Int = 0,
    val sessions: Int = 0,
    /** Books read in on this day. */
    val bookIds: Set<Long> = emptySet(),
    /** Books finished on this day. */
    val finishedIds: Set<Long> = emptySet(),
) {
    /** What the calendar colours by: pages, or minutes for a day of only listening. */
    val amount: Int get() = if (pages > 0) pages else minutes
}

enum class TimeOfDay { MORNING, AFTERNOON, EVENING, NIGHT }

/** A light-hearted label for when someone reads most. */
enum class ReaderType { QUIET_SHELF, WEEKEND_READER, EARLY_BIRD, AFTERNOON_ESCAPIST, EVENING_UNWINDER, NIGHT_OWL }

/** The story of a month or a year. */
data class Recap(
    val from: Long,
    val to: Long,
    val finished: List<Book>,
    val pages: Int,
    val minutes: Int,
    val sessions: Int,
    val readingDays: Int,
    val bestStreak: Int,
    val bestDay: DaySummary?,
    val averageRating: Float,
    val bestRated: Book?,
    val longest: Book?,
    val topAuthors: List<Pair<String, Int>>,
    val topGenres: List<Pair<String, Int>>,
    val favouriteWeekday: Int?,
    val favouriteTime: TimeOfDay?,
    val readerType: ReaderType,
    /** Money spent on books in the period, per currency. */
    val spent: Map<String, Double>,
)

object Insights {
    fun timeOfDay(hour: Int): TimeOfDay = when (hour) {
        in 5..11 -> TimeOfDay.MORNING
        in 12..16 -> TimeOfDay.AFTERNOON
        in 17..21 -> TimeOfDay.EVENING
        else -> TimeOfDay.NIGHT
    }

    /**
     * One entry per day on which something was read or finished. A finished book without
     * any session counts with all its pages on the day it was finished.
     */
    fun days(books: List<Book>, sessions: List<ReadingSession>, zone: ZoneId = ZoneId.systemDefault()): Map<Long, DaySummary> {
        val byId = books.associateBy { it.id }
        val out = HashMap<Long, DaySummary>()
        val withSessions = HashSet<Long>()
        sessions.forEach { session ->
            val book = byId[session.bookId] ?: return@forEach
            withSessions += book.id
            val day = StatsCalculator.dayOf(session.startedAt, zone)
            val audio = book.isAudio
            val current = out[day] ?: DaySummary(day)
            out[day] = current.copy(
                pages = current.pages + if (audio) 0 else session.pages,
                minutes = current.minutes + if (audio && session.minutes <= 0f) session.pages else session.minutes.roundToInt(),
                sessions = current.sessions + 1,
                bookIds = current.bookIds + book.id,
            )
        }
        books.forEach { book ->
            val day = book.finishedOn ?: return@forEach
            if (book.status != ReadingStatus.READ && book.readCount == 0) return@forEach
            val current = out[day] ?: DaySummary(day)
            val counted = book.id !in withSessions && book.pageCount > 0
            out[day] = current.copy(
                pages = current.pages + if (counted && !book.isAudio) book.pageCount else 0,
                minutes = current.minutes + if (counted && book.isAudio) book.pageCount else 0,
                bookIds = current.bookIds + book.id,
                finishedIds = current.finishedIds + book.id,
            )
        }
        return out
    }

    fun recap(
        books: List<Book>,
        sessions: List<ReadingSession>,
        purchases: List<Purchase>,
        from: LocalDate,
        to: LocalDate,
        zone: ZoneId = ZoneId.systemDefault(),
    ): Recap {
        val start = from.toEpochDay()
        val end = to.toEpochDay()
        val days = days(books, sessions, zone).filterKeys { it in start..end }
        val finished = books.filter { it.finishedOn != null && it.finishedOn in start..end && (it.status == ReadingStatus.READ || it.readCount > 0) }
            .sortedBy { it.finishedOn }
        val inRange = sessions.filter { StatsCalculator.dayOf(it.startedAt, zone) in start..end }
        val byTime = inRange.groupingBy { timeOfDay(Instant.ofEpochMilli(it.startedAt).atZone(zone).hour) }.eachCount()
        val byWeekday = inRange.groupingBy { Instant.ofEpochMilli(it.startedAt).atZone(zone).dayOfWeek.value }.eachCount()
        val favouriteTime = byTime.maxByOrNull { it.value }?.key
        val weekend = (byWeekday[6] ?: 0) + (byWeekday[7] ?: 0)
        val rated = finished.filter { it.rating > 0f }
        return Recap(
            from = start,
            to = end,
            finished = finished,
            pages = days.values.sumOf { it.pages },
            minutes = days.values.sumOf { it.minutes },
            sessions = inRange.size,
            readingDays = days.size,
            bestStreak = StatsCalculator.streaks(days.keys, end).second,
            bestDay = days.values.filter { it.amount > 0 }.maxByOrNull { it.amount },
            averageRating = if (rated.isEmpty()) 0f else rated.map { it.rating }.average().toFloat(),
            bestRated = rated.maxWithOrNull(compareBy<Book> { it.rating }.thenBy { it.finishedOn }),
            longest = finished.filter { it.pageCount > 0 && !it.isAudio }.maxByOrNull { it.pageCount },
            topAuthors = ranking(finished.flatMap { it.authors.split(',').map(String::trim).filter(String::isNotEmpty) }, 5),
            topGenres = ranking(finished.flatMap { it.genreList() }, 5),
            favouriteWeekday = byWeekday.maxByOrNull { it.value }?.key,
            favouriteTime = favouriteTime,
            readerType = when {
                inRange.isEmpty() -> ReaderType.QUIET_SHELF
                weekend * 7 > inRange.size * 4 -> ReaderType.WEEKEND_READER
                favouriteTime == TimeOfDay.MORNING -> ReaderType.EARLY_BIRD
                favouriteTime == TimeOfDay.AFTERNOON -> ReaderType.AFTERNOON_ESCAPIST
                favouriteTime == TimeOfDay.EVENING -> ReaderType.EVENING_UNWINDER
                else -> ReaderType.NIGHT_OWL
            },
            spent = purchases.filter { it.day in start..end && it.price > 0 }.groupBy { it.currency.trim().uppercase() }
                .mapValues { (_, list) -> list.sumOf { it.price } },
        )
    }

    private fun ranking(names: List<String>, take: Int): List<Pair<String, Int>> =
        names.groupingBy { it }.eachCount().toList().sortedWith(compareByDescending<Pair<String, Int>> { it.second }.thenBy { it.first }).take(take)
}

enum class MilestoneCategory { BOOKS, PAGES, SESSIONS, HOURS, REVIEWS, QUOTES, STREAK, LONG_BOOKS }

data class Milestone(val category: MilestoneCategory, val value: Int, val tiers: List<Int>) {
    /** How many tiers have been passed. */
    val reached: Int get() = tiers.count { value >= it }
    /** The next tier to aim for, or null when all are done. */
    val next: Int? get() = tiers.firstOrNull { value < it }
    /** Progress from the last tier passed towards the next one, 0 to 1. */
    val progress: Float
        get() {
            val target = next ?: return 1f
            val base = tiers.lastOrNull { value >= it } ?: 0
            return ((value - base).toFloat() / (target - base)).coerceIn(0f, 1f)
        }
}

/** A dated moment worth remembering, e.g. the day the tenth book was finished. */
data class MilestoneEvent(val day: Long, val category: MilestoneCategory, val tier: Int, val book: Book?)

object Milestones {
    /** A book counts as long from this many pages. */
    const val LONG_BOOK_PAGES = 500

    val tiers: Map<MilestoneCategory, List<Int>> = mapOf(
        MilestoneCategory.BOOKS to listOf(1, 10, 25, 50, 100, 250, 500),
        MilestoneCategory.PAGES to listOf(1_000, 5_000, 10_000, 25_000, 50_000, 100_000),
        MilestoneCategory.SESSIONS to listOf(10, 50, 100, 500, 1_000),
        MilestoneCategory.HOURS to listOf(10, 50, 100, 250, 500, 1_000),
        MilestoneCategory.REVIEWS to listOf(1, 10, 25, 50, 100),
        MilestoneCategory.QUOTES to listOf(1, 10, 25, 50, 100, 250),
        MilestoneCategory.STREAK to listOf(3, 7, 14, 30, 100, 365),
        MilestoneCategory.LONG_BOOKS to listOf(1, 5, 10, 25, 50),
    )

    fun compute(books: List<Book>, sessions: List<ReadingSession>, quoteCount: Int, today: LocalDate, zone: ZoneId = ZoneId.systemDefault()): List<Milestone> {
        val days = Insights.days(books, sessions, zone)
        val finished = books.filter { it.status == ReadingStatus.READ || it.readCount > 0 }
        val values = mapOf(
            MilestoneCategory.BOOKS to finished.size,
            MilestoneCategory.PAGES to days.values.sumOf { it.pages },
            MilestoneCategory.SESSIONS to sessions.size,
            MilestoneCategory.HOURS to days.values.sumOf { it.minutes } / 60,
            MilestoneCategory.REVIEWS to books.count { it.review.isNotBlank() },
            MilestoneCategory.QUOTES to quoteCount,
            MilestoneCategory.STREAK to StatsCalculator.streaks(days.keys, today.toEpochDay()).second,
            MilestoneCategory.LONG_BOOKS to finished.count { !it.isAudio && it.pageCount >= LONG_BOOK_PAGES },
        )
        return MilestoneCategory.entries.map { Milestone(it, values.getValue(it), tiers.getValue(it)) }
    }

    /** When each book-count tier was reached, newest first. */
    fun timeline(books: List<Book>): List<MilestoneEvent> {
        val finished = books.filter { it.finishedOn != null && (it.status == ReadingStatus.READ || it.readCount > 0) }.sortedBy { it.finishedOn }
        val events = ArrayList<MilestoneEvent>()
        tiers.getValue(MilestoneCategory.BOOKS).forEach { tier ->
            finished.getOrNull(tier - 1)?.let { events += MilestoneEvent(it.finishedOn!!, MilestoneCategory.BOOKS, tier, it) }
        }
        val long = finished.filter { !it.isAudio && it.pageCount >= LONG_BOOK_PAGES }
        tiers.getValue(MilestoneCategory.LONG_BOOKS).forEach { tier ->
            long.getOrNull(tier - 1)?.let { events += MilestoneEvent(it.finishedOn!!, MilestoneCategory.LONG_BOOKS, tier, it) }
        }
        return events.sortedByDescending { it.day }
    }
}
