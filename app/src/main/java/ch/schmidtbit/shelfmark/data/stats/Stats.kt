package ch.schmidtbit.shelfmark.data.stats

import ch.schmidtbit.shelfmark.data.model.Book
import ch.schmidtbit.shelfmark.data.model.BookFormat
import ch.schmidtbit.shelfmark.data.model.Goal
import ch.schmidtbit.shelfmark.data.model.GoalKind
import ch.schmidtbit.shelfmark.data.model.GoalRepeat
import ch.schmidtbit.shelfmark.data.model.ReadingSession
import ch.schmidtbit.shelfmark.data.model.ReadingStatus
import ch.schmidtbit.shelfmark.data.model.genreList
import ch.schmidtbit.shelfmark.data.model.isAudio
import java.time.DayOfWeek
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.temporal.TemporalAdjusters
import kotlin.math.roundToInt

data class YearStats(
    val year: Int,
    val booksFinished: Int,
    val pagesRead: Int,
    val minutesRead: Int,
    val sessions: Int,
    /** Index 0 is January. */
    val booksPerMonth: List<Int>,
    val pagesPerMonth: List<Int>,
)

data class LibraryStats(
    val totalBooks: Int,
    val read: Int,
    val reading: Int,
    val unread: Int,
    val wishlist: Int,
    val abandoned: Int,
    val averageRating: Float,
    val averageSpice: Float,
    val quotes: Int,
    val currentStreak: Int,
    val bestStreak: Int,
    val byFormat: List<Pair<BookFormat, Int>>,
    /** Index 0 counts books rated up to one star, index 4 those above four. */
    val byRating: List<Int>,
    val topAuthors: List<Pair<String, Int>>,
    val topGenres: List<Pair<String, Int>>,
    /** Pages read per weekday, Monday first. */
    val pagesByWeekday: List<Int>,
    val thisYear: YearStats,
    val lastYear: YearStats,
)

/** One day's amount of reading, the common currency of statistics and goals. */
private data class DayAmount(val day: Long, val pages: Int, val minutes: Int)

object StatsCalculator {
    fun compute(books: List<Book>, sessions: List<ReadingSession>, quoteCount: Int, today: LocalDate, zone: ZoneId = ZoneId.systemDefault()): LibraryStats {
        val amounts = dayAmounts(books, sessions, zone)
        val finished = books.filter { it.readCount > 0 || it.status == ReadingStatus.READ }
        val rated = books.filter { it.rating > 0f }
        val spiced = books.filter { it.spice > 0 }
        val days = amounts.map { it.day }.toSet() + finished.mapNotNull { it.finishedOn }
        val (current, best) = streaks(days, today.toEpochDay())
        val weekday = IntArray(7)
        amounts.forEach { weekday[LocalDate.ofEpochDay(it.day).dayOfWeek.value - 1] += it.pages }
        return LibraryStats(
            totalBooks = books.size,
            read = books.count { it.status == ReadingStatus.READ },
            reading = books.count { it.status == ReadingStatus.READING },
            unread = books.count { it.status == ReadingStatus.NONE },
            wishlist = books.count { it.status == ReadingStatus.WISHLIST },
            abandoned = books.count { it.status == ReadingStatus.ABANDONED },
            averageRating = if (rated.isEmpty()) 0f else rated.map { it.rating }.average().toFloat(),
            averageSpice = if (spiced.isEmpty()) 0f else spiced.map { it.spice }.average().toFloat(),
            quotes = quoteCount,
            currentStreak = current,
            bestStreak = best,
            byFormat = books.filter { it.format != BookFormat.UNKNOWN }.groupingBy { it.format }.eachCount().toList().sortedByDescending { it.second },
            byRating = (1..5).map { star -> rated.count { it.rating > star - 1 && it.rating <= star } },
            topAuthors = finished.flatMap { it.authors.split(',').map(String::trim).filter(String::isNotEmpty) }
                .groupingBy { it }.eachCount().toList().sortedWith(compareByDescending<Pair<String, Int>> { it.second }.thenBy { it.first }).take(5),
            topGenres = books.flatMap { it.genreList() }.groupingBy { it }.eachCount().toList()
                .sortedWith(compareByDescending<Pair<String, Int>> { it.second }.thenBy { it.first }).take(6),
            pagesByWeekday = weekday.toList(),
            thisYear = yearStats(today.year, books, sessions, amounts, zone),
            lastYear = yearStats(today.year - 1, books, sessions, amounts, zone),
        )
    }

    private fun yearStats(year: Int, books: List<Book>, sessions: List<ReadingSession>, amounts: List<DayAmount>, zone: ZoneId): YearStats {
        val booksPerMonth = IntArray(12)
        val pagesPerMonth = IntArray(12)
        books.forEach { book ->
            val day = book.finishedOn?.let(LocalDate::ofEpochDay) ?: return@forEach
            if (day.year == year && (book.status == ReadingStatus.READ || book.readCount > 0)) booksPerMonth[day.monthValue - 1]++
        }
        var minutes = 0
        amounts.forEach { amount ->
            val day = LocalDate.ofEpochDay(amount.day)
            if (day.year == year) {
                pagesPerMonth[day.monthValue - 1] += amount.pages
                minutes += amount.minutes
            }
        }
        return YearStats(
            year = year,
            booksFinished = booksPerMonth.sum(),
            pagesRead = pagesPerMonth.sum(),
            minutesRead = minutes,
            sessions = sessions.count { dayOf(it.startedAt, zone).let(LocalDate::ofEpochDay).year == year },
            booksPerMonth = booksPerMonth.toList(),
            pagesPerMonth = pagesPerMonth.toList(),
        )
    }

    /**
     * Pages and minutes per day. Logged sessions count on their day. A finished book without
     * any session counts with all its pages on the day it was finished, so people who only
     * tick books off still get page totals.
     */
    private fun dayAmounts(books: List<Book>, sessions: List<ReadingSession>, zone: ZoneId): List<DayAmount> {
        val byId = books.associateBy { it.id }
        val withSessions = sessions.map { it.bookId }.toSet()
        val fromSessions = sessions.mapNotNull { session ->
            val book = byId[session.bookId] ?: return@mapNotNull null
            val audio = book.isAudio
            DayAmount(
                day = dayOf(session.startedAt, zone),
                pages = if (audio) 0 else session.pages,
                // An audiobook's positions are minutes, so listening time is the distance covered.
                minutes = if (audio && session.minutes <= 0f) session.pages else session.minutes.roundToInt(),
            )
        }
        val fromFinished = books.mapNotNull { book ->
            val day = book.finishedOn ?: return@mapNotNull null
            if (book.id in withSessions || book.pageCount <= 0 || book.status != ReadingStatus.READ) return@mapNotNull null
            if (book.isAudio) DayAmount(day, 0, book.pageCount) else DayAmount(day, book.pageCount, 0)
        }
        return fromSessions + fromFinished
    }

    fun dayOf(millis: Long, zone: ZoneId): Long = Instant.ofEpochMilli(millis).atZone(zone).toLocalDate().toEpochDay()

    /**
     * Current and best run of consecutive reading days. The current streak still counts
     * when today has no reading yet, it only breaks once a whole day was missed.
     */
    fun streaks(days: Set<Long>, today: Long): Pair<Int, Int> {
        if (days.isEmpty()) return 0 to 0
        val sorted = days.sorted()
        var best = 1
        var run = 1
        for (i in 1 until sorted.size) {
            run = if (sorted[i] == sorted[i - 1] + 1) run + 1 else 1
            best = maxOf(best, run)
        }
        var current = 0
        var day = if (today in days) today else today - 1
        while (day in days) {
            current++
            day--
        }
        return current to best
    }

    /** Amount done towards [goal] between two days (both included). */
    internal fun done(goal: Goal, books: List<Book>, sessions: List<ReadingSession>, start: Long, end: Long, zone: ZoneId): Int = when (goal.kind) {
        GoalKind.BOOKS -> books.count { book ->
            val day = book.finishedOn
            day != null && day in start..end && (book.status == ReadingStatus.READ || book.readCount > 0)
        }
        GoalKind.PAGES -> dayAmounts(books, sessions, zone).filter { it.day in start..end }.sumOf { it.pages }
        GoalKind.MINUTES -> dayAmounts(books, sessions, zone).filter { it.day in start..end }.sumOf { it.minutes }
    }
}

data class GoalProgress(
    val goal: Goal,
    /** The period that counts right now, as epoch days. */
    val start: Long,
    val end: Long,
    val done: Int,
    val daysLeft: Int,
    /** Share of the period that has passed, 0 to 1. */
    val timeFraction: Float,
) {
    val fraction: Float get() = if (goal.target <= 0) 0f else (done.toFloat() / goal.target).coerceIn(0f, 1f)
    val reached: Boolean get() = done >= goal.target
    val ahead: Boolean get() = fraction >= timeFraction
    val remaining: Int get() = (goal.target - done).coerceAtLeast(0)

    /** How much per remaining day is needed to get there, or null when the period is over. */
    val perDay: Float? get() = if (reached || daysLeft <= 0) null else remaining.toFloat() / daysLeft
}

object GoalMath {
    /** The current period of a goal: its own dates, or the running day, week, month or year. */
    fun window(goal: Goal, today: LocalDate): Pair<Long, Long> = when (goal.repeat) {
        GoalRepeat.ONCE -> goal.startDay to goal.endDay
        GoalRepeat.DAILY -> today.toEpochDay() to today.toEpochDay()
        GoalRepeat.WEEKLY -> today.with(TemporalAdjusters.previousOrSame(DayOfWeek.MONDAY)).toEpochDay() to
            today.with(TemporalAdjusters.nextOrSame(DayOfWeek.SUNDAY)).toEpochDay()
        GoalRepeat.MONTHLY -> today.withDayOfMonth(1).toEpochDay() to today.with(TemporalAdjusters.lastDayOfMonth()).toEpochDay()
        GoalRepeat.YEARLY -> today.withDayOfYear(1).toEpochDay() to today.with(TemporalAdjusters.lastDayOfYear()).toEpochDay()
    }

    fun progress(goal: Goal, books: List<Book>, sessions: List<ReadingSession>, today: LocalDate, zone: ZoneId = ZoneId.systemDefault()): GoalProgress {
        val (start, end) = window(goal, today)
        val now = today.toEpochDay()
        val total = (end - start + 1).coerceAtLeast(1)
        val elapsed = (now - start + 1).coerceIn(0, total)
        return GoalProgress(
            goal = goal,
            start = start,
            end = end,
            done = StatsCalculator.done(goal, books, sessions, start, end, zone),
            // Today still counts as a day to read on.
            daysLeft = (end - now + 1).coerceAtLeast(0).toInt(),
            timeFraction = elapsed.toFloat() / total,
        )
    }
}
