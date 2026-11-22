package ch.schmidtbit.shelfmark.data.importer

import ch.schmidtbit.shelfmark.data.model.Book
import ch.schmidtbit.shelfmark.data.model.BookFormat
import ch.schmidtbit.shelfmark.data.model.Ownership
import ch.schmidtbit.shelfmark.data.model.ReadingStatus
import ch.schmidtbit.shelfmark.data.remote.RemoteBook
import ch.schmidtbit.shelfmark.data.remote.extractYear
import ch.schmidtbit.shelfmark.data.remote.parseFormat
import ch.schmidtbit.shelfmark.data.remote.stripHtml
import ch.schmidtbit.shelfmark.util.Isbn
import java.time.LocalDate
import java.time.ZoneId
import java.time.format.DateTimeFormatter

/** Plain CSV reading: quoted fields, doubled quotes, line breaks inside quotes, any common separator. */
object Csv {
    fun parse(text: String): List<List<String>> {
        val content = text.removePrefix("﻿")
        val separator = separatorOf(content.lineSequence().firstOrNull().orEmpty())
        val rows = ArrayList<List<String>>()
        var row = ArrayList<String>()
        val field = StringBuilder()
        var quoted = false
        var i = 0
        while (i < content.length) {
            val c = content[i]
            when {
                quoted && c == '"' && content.getOrNull(i + 1) == '"' -> { field.append('"'); i++ }
                c == '"' -> quoted = !quoted
                !quoted && c == separator -> { row.add(field.toString()); field.setLength(0) }
                !quoted && (c == '\n' || c == '\r') -> {
                    if (c == '\r' && content.getOrNull(i + 1) == '\n') i++
                    row.add(field.toString()); field.setLength(0)
                    if (row.any { it.isNotBlank() }) rows.add(row)
                    row = ArrayList()
                }
                else -> field.append(c)
            }
            i++
        }
        row.add(field.toString())
        if (row.any { it.isNotBlank() }) rows.add(row)
        return rows
    }

    private fun separatorOf(header: String): Char = listOf(',', ';', '\t').maxByOrNull { sep -> header.count { it == sep } } ?: ','
}

/** A CSV file with a header row. Columns are found by name, whatever their case or order. */
class CsvTable(rows: List<List<String>>) {
    private val header: List<String> = rows.firstOrNull().orEmpty().map { it.trim().lowercase() }
    val rows: List<List<String>> = rows.drop(1)

    fun has(vararg names: String): Boolean = names.any { it in header }

    /** The value of the first of [names] that exists as a column and is not empty in this row. */
    fun get(row: List<String>, vararg names: String): String {
        for (name in names) {
            val index = header.indexOf(name)
            val value = row.getOrNull(index)?.trim().orEmpty()
            if (index >= 0 && value.isNotEmpty()) return value
        }
        return ""
    }
}

/** A book read from a foreign file, with the names of the custom lists it should go on. */
data class PlannedBook(val book: Book, val lists: List<String> = emptyList())

data class ImportPlan(val source: String, val books: List<PlannedBook>)

/**
 * Reads book lists exported by other apps. Goodreads and StoryGraph are recognised by
 * their columns. Anything else is matched by column name, so most CSV exports work.
 */
object CsvImporter {
    const val GOODREADS = "Goodreads"
    const val STORYGRAPH = "StoryGraph"
    const val GENERIC = "CSV"

    /** Returns null when the text is not a table of books (no title column). */
    fun parse(text: String, zone: ZoneId = ZoneId.systemDefault()): ImportPlan? {
        val table = CsvTable(Csv.parse(text))
        return when {
            table.has("exclusive shelf") && table.has("title") -> ImportPlan(GOODREADS, table.rows.mapNotNull { goodreads(table, it, zone) })
            table.has("read status") && table.has("title") -> ImportPlan(STORYGRAPH, table.rows.mapNotNull { storygraph(table, it, zone) })
            table.has("title", "book_title", "name", "titel", "buchtitel") -> ImportPlan(GENERIC, table.rows.mapNotNull { generic(table, it, zone) })
            else -> null
        }?.takeIf { it.books.isNotEmpty() }
    }

    private fun goodreads(t: CsvTable, row: List<String>, zone: ZoneId): PlannedBook? {
        val (title, series, position) = splitSeries(t.get(row, "title"))
        if (title.isBlank()) return null
        val shelf = t.get(row, "exclusive shelf")
        val owned = (t.get(row, "owned copies").toIntOrNull() ?: 0) > 0
        val status = status(shelf, owned)
        val finished = day(t.get(row, "date read"))
        return PlannedBook(
            book = Book(
                title = title,
                authors = (listOf(t.get(row, "author")) + people(t.get(row, "additional authors"))).filter { it.isNotBlank() }.joinToString(", "),
                isbn = isbn(t.get(row, "isbn13"), t.get(row, "isbn")),
                publisher = t.get(row, "publisher"),
                publishedYear = extractYear(t.get(row, "original publication year", "year published")),
                pageCount = t.get(row, "number of pages").toIntOrNull() ?: 0,
                format = parseFormat(t.get(row, "binding")),
                rating = rating(t.get(row, "my rating")),
                review = stripHtml(t.get(row, "my review")),
                finishedOn = finished.takeIf { status == ReadingStatus.READ },
                readCount = if (status == ReadingStatus.READ) (t.get(row, "read count").toIntOrNull() ?: 1).coerceAtLeast(1) else 0,
                series = series,
                seriesPosition = position,
                addedAt = millis(t.get(row, "date added"), zone),
            ).finish(status, owned),
            lists = t.get(row, "bookshelves").split(',').map { it.trim() }
                .filter { it.isNotEmpty() && it !in setOf("read", "currently-reading", "to-read") },
        )
    }

    private fun storygraph(t: CsvTable, row: List<String>, zone: ZoneId): PlannedBook? {
        val title = t.get(row, "title")
        if (title.isBlank()) return null
        val owned = t.get(row, "owned?", "owned").lowercase() in setOf("yes", "true", "1")
        val status = status(t.get(row, "read status"), owned)
        // "Dates Read" holds ranges like 2024/01/03-2024/01/20, several of them for re-reads.
        val lastRange = t.get(row, "dates read").split(',').lastOrNull().orEmpty().trim()
        val finished = day(t.get(row, "last date read")) ?: day(lastRange.substringAfterLast('-'))
        return PlannedBook(
            book = Book(
                title = title,
                authors = people(t.get(row, "authors")).joinToString(", "),
                isbn = isbn(t.get(row, "isbn/uid")),
                format = when (t.get(row, "format").lowercase()) {
                    "audio" -> BookFormat.AUDIOBOOK
                    "digital" -> BookFormat.EBOOK
                    else -> parseFormat(t.get(row, "format"))
                },
                rating = rating(t.get(row, "star rating")),
                review = stripHtml(t.get(row, "review")),
                startedOn = day(lastRange.substringBefore('-')).takeIf { '-' in lastRange },
                finishedOn = finished.takeIf { status == ReadingStatus.READ },
                readCount = if (status == ReadingStatus.READ) (t.get(row, "read count").toIntOrNull() ?: 1).coerceAtLeast(1) else 0,
                tags = t.get(row, "tags"),
                addedAt = millis(t.get(row, "date added"), zone),
            ).finish(status, owned),
        )
    }

    private fun generic(t: CsvTable, row: List<String>, zone: ZoneId): PlannedBook? {
        val title = t.get(row, "title", "book_title", "name", "titel", "buchtitel")
        if (title.isBlank()) return null
        val status = status(t.get(row, "status", "read status", "exclusive shelf", "shelf", "state", "lesestatus", "regal"), owned = true)
        val cover = t.get(row, "cover_url", "cover", "cover_link", "image", "thumbnail")
        return PlannedBook(
            book = Book(
                title = title,
                subtitle = t.get(row, "subtitle", "untertitel"),
                authors = people(t.get(row, "authors", "author(s)", "author", "author_names", "autor", "autoren", "autorin", "verfasser")).joinToString(", "),
                isbn = isbn(t.get(row, "isbn13", "isbn_13", "isbn", "isbn10", "isbn_10")),
                publisher = t.get(row, "publisher", "verlag"),
                publishedYear = extractYear(t.get(row, "published_date", "published", "publication_date", "published_at", "year", "jahr", "erscheinungsjahr")),
                language = t.get(row, "language", "sprache"),
                description = stripHtml(t.get(row, "description", "beschreibung", "klappentext")),
                format = parseFormat(t.get(row, "type", "format", "book_type", "reading_format", "binding", "einband")),
                pageCount = t.get(row, "pages", "page_count", "pages_count", "number of pages", "total_pages", "seiten", "seitenzahl").toIntOrNull() ?: 0,
                rating = rating(t.get(row, "rating", "my rating", "star_rating", "star rating", "bewertung", "sterne")),
                spice = t.get(row, "spice", "spice_level").toIntOrNull()?.coerceIn(0, 5) ?: 0,
                review = stripHtml(t.get(row, "latest_review", "review", "my review", "rezension")),
                series = t.get(row, "series", "series_name", "reihe", "serie"),
                seriesPosition = t.get(row, "series_position", "series_index", "series_number", "volume", "series_order", "band").replace(',', '.').toFloatOrNull() ?: 0f,
                genres = t.get(row, "genres", "genre"),
                tags = t.get(row, "tags"),
                favorite = t.get(row, "favorite", "favourite", "is_favorite").lowercase() in setOf("true", "yes", "1", "y"),
                coverUrl = cover.takeIf { it.startsWith("http") }.orEmpty(),
                startedOn = day(t.get(row, "start_date", "started", "date started")),
                finishedOn = day(t.get(row, "end_date", "finished", "date read", "date finished")),
                readCount = t.get(row, "read_count", "read count").toIntOrNull() ?: 0,
                addedAt = millis(t.get(row, "date_added", "added", "created_at", "dateadded", "date added"), zone),
            ).finish(status, owned = true),
        )
    }

    /** Settles the fields that depend on the list the book ends up on. */
    private fun Book.finish(status: ReadingStatus, owned: Boolean): Book = copy(
        status = status,
        ownership = if (status == ReadingStatus.WISHLIST && !owned) Ownership.NOT_OWNED else Ownership.OWNED,
        lendable = format != BookFormat.EBOOK && format != BookFormat.AUDIOBOOK && !(status == ReadingStatus.WISHLIST && !owned),
        readCount = if (status == ReadingStatus.READ) readCount.coerceAtLeast(1) else readCount,
        currentPage = if (status == ReadingStatus.READ) pageCount else 0,
    )

    /** Maps the many words apps use for a reading state. A book to read that is not owned is a wish. */
    internal fun status(word: String, owned: Boolean): ReadingStatus = when (word.trim().lowercase()) {
        "read", "finished", "completed", "done", "gelesen", "beendet" -> ReadingStatus.READ
        "currently-reading", "currently reading", "reading", "in progress", "in-progress", "paused", "on hold", "on-hold", "am lesen", "lese ich" -> ReadingStatus.READING
        "did-not-finish", "did not finish", "dnf", "gave up", "abandoned", "stopped", "abgebrochen" -> ReadingStatus.ABANDONED
        "to-read", "to read", "want to read", "want-to-read", "tbr", "planned", "wishlist", "wunschliste" ->
            if (owned) ReadingStatus.NONE else ReadingStatus.WISHLIST
        else -> ReadingStatus.NONE
    }

    private val seriesInTitle = Regex("""^(.+?)\s*\((.+?),?\s*#(\d+(?:[.,]\d+)?)\)$""")

    /** Splits "Dune (Dune, #1)" into the title, the series and the position in it. */
    internal fun splitSeries(raw: String): Triple<String, String, Float> {
        val match = seriesInTitle.matchEntire(raw.trim()) ?: return Triple(raw.trim(), "", 0f)
        val (title, series, position) = match.destructured
        return Triple(title.trim(), series.trim(), position.replace(',', '.').toFloatOrNull() ?: 0f)
    }

    private fun people(text: String): List<String> = text.split(',', ';', '&').map { it.trim() }.filter { it.isNotEmpty() }

    /** Goodreads wraps ISBNs as ="0441172717" so that spreadsheets keep the leading zero. */
    private fun isbn(vararg candidates: String): String =
        candidates.firstNotNullOfOrNull { Isbn.to13(it.removePrefix("=").trim('"')) }.orEmpty()

    private fun rating(text: String): Float = (text.replace(',', '.').toFloatOrNull() ?: 0f).coerceIn(0f, 5f)

    private val dateFormats = listOf("yyyy/MM/dd", "yyyy-MM-dd", "dd.MM.yyyy", "d.M.yyyy", "MM/dd/yyyy", "yyyy/M/d").map(DateTimeFormatter::ofPattern)

    internal fun day(text: String): Long? {
        val value = text.trim().take(10).trim()
        if (value.isEmpty()) return null
        return dateFormats.firstNotNullOfOrNull { runCatching { LocalDate.parse(value, it).toEpochDay() }.getOrNull() }
    }

    private fun millis(text: String, zone: ZoneId): Long =
        day(text)?.let { LocalDate.ofEpochDay(it).atTime(12, 0).atZone(zone).toInstant().toEpochMilli() } ?: System.currentTimeMillis()

    /** Two records describe the same book when the ISBN matches, or title and first author do. */
    fun sameBook(a: Book, b: Book): Boolean =
        (a.isbn.isNotBlank() && a.isbn == b.isbn) ||
            (RemoteBook.normalise(a.title) == RemoteBook.normalise(b.title) &&
                RemoteBook.normalise(a.authors.substringBefore(',')) == RemoteBook.normalise(b.authors.substringBefore(',')))

    /** Adds what [incoming] knows and [existing] lacks. Nothing the user already entered is overwritten. */
    fun fillGaps(existing: Book, incoming: Book): Book = existing.copy(
        isbn = existing.isbn.ifBlank { incoming.isbn },
        publisher = existing.publisher.ifBlank { incoming.publisher },
        publishedYear = existing.publishedYear.ifBlank { incoming.publishedYear },
        pageCount = if (existing.pageCount > 0) existing.pageCount else incoming.pageCount,
        format = if (existing.format != BookFormat.UNKNOWN) existing.format else incoming.format,
        description = existing.description.ifBlank { incoming.description },
        coverUrl = existing.coverUrl.ifBlank { incoming.coverUrl },
        rating = if (existing.rating > 0f) existing.rating else incoming.rating,
        review = existing.review.ifBlank { incoming.review },
        startedOn = existing.startedOn ?: incoming.startedOn,
        finishedOn = existing.finishedOn ?: incoming.finishedOn,
        genres = existing.genres.ifBlank { incoming.genres },
        tags = existing.tags.ifBlank { incoming.tags },
        series = existing.series.ifBlank { incoming.series },
    )
}
