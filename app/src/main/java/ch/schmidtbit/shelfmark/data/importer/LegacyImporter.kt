package ch.schmidtbit.shelfmark.data.importer

import ch.schmidtbit.shelfmark.data.model.Book
import ch.schmidtbit.shelfmark.data.model.BookFormat
import ch.schmidtbit.shelfmark.data.model.BookShelf
import ch.schmidtbit.shelfmark.data.model.Goal
import ch.schmidtbit.shelfmark.data.model.GoalKind
import ch.schmidtbit.shelfmark.data.model.GoalRepeat
import ch.schmidtbit.shelfmark.data.model.Note
import ch.schmidtbit.shelfmark.data.model.Quote
import ch.schmidtbit.shelfmark.data.model.ReadingSession
import ch.schmidtbit.shelfmark.data.model.ReadingStatus
import ch.schmidtbit.shelfmark.data.model.Shelf
import ch.schmidtbit.shelfmark.data.share.BackupPayload
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.longOrNull
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.ZoneId

/**
 * Reads the library file of the desktop Shelfmark (library.json, also found as
 * shelfmark-backup.json inside its export zip) and converts it to this app's data.
 *
 * The desktop app keeps each book on exactly one shelf. Its three built-in shelves become
 * the reading status here, its custom shelves become custom lists.
 */
object LegacyImporter {
    private val json = Json { ignoreUnknownKeys = true; isLenient = true }

    /** Returns null when [text] is not a desktop Shelfmark library. */
    fun parse(text: String, zone: ZoneId = ZoneId.systemDefault()): BackupPayload? {
        val root = runCatching { json.parseToJsonElement(text.trim().removePrefix("﻿")) as JsonObject }.getOrNull() ?: return null
        val legacyBooks = root.arr("books") ?: return null
        val legacyShelves = root.arr("shelves") ?: return null

        val tagNames = root.arr("tags").orEmpty().mapNotNull { it.obj() }.associate { (it.long("id") ?: -1) to it.str("name") }
        val shelfInfo = legacyShelves.mapNotNull { it.obj() }.associateBy { it.long("id") ?: -1 }

        // Custom shelves keep their order and get fresh ids.
        val shelves = mutableListOf<Shelf>()
        val customShelfId = HashMap<Long, Long>()
        shelfInfo.values.filter { it.str("kind") == "Custom" }.forEach { s ->
            val id = shelves.size + 1L
            customShelfId[s.long("id") ?: -1] = id
            shelves += Shelf(id = id, name = s.str("name").ifBlank { "?" }, position = shelves.size)
        }

        val books = mutableListOf<Book>()
        val links = mutableListOf<BookShelf>()
        val quotes = mutableListOf<Quote>()
        val sessions = mutableListOf<ReadingSession>()
        val notes = mutableListOf<Note>()

        legacyBooks.mapNotNull { it.obj() }.filter { it.bool("sample") != true }.forEach { b ->
            val id = books.size + 1L
            val format = when (b.str("format")) {
                "Hardcover" -> BookFormat.HARDCOVER
                "Ebook" -> BookFormat.EBOOK
                "Audiobook" -> BookFormat.AUDIOBOOK
                "Other" -> BookFormat.OTHER
                else -> BookFormat.PAPERBACK
            }
            val length = if (format == BookFormat.AUDIOBOOK) b.int("minutes") else b.int("pages")
            val shelf = b.long("shelf")?.let { shelfInfo[it] }
            val status = when (shelf?.str("kind")) {
                "Reading" -> ReadingStatus.READING
                "Finished" -> ReadingStatus.READ
                "Custom" -> when (shelf.str("behavior")) {
                    "Reading" -> ReadingStatus.READING
                    "Finished" -> ReadingStatus.READ
                    else -> ReadingStatus.NONE
                }
                else -> ReadingStatus.NONE
            }
            val reads = b.arr("reads").orEmpty().mapNotNull { it.obj() }
            val lastRead = reads.lastOrNull()
            val entries = b.arr("entries").orEmpty().mapNotNull { it.obj() }
            val currentRead = reads.size.coerceAtLeast(1).toLong()
            val position = entries.filter { (it.long("read") ?: 1) == currentRead }.maxOfOrNull { it.int("end") } ?: 0

            books += Book(
                id = id,
                title = b.str("title").ifBlank { "?" },
                subtitle = b.str("subtitle"),
                authors = b.arr("authors").orEmpty().mapNotNull { (it as? JsonPrimitive)?.content }.joinToString(", "),
                isbn = b.str("isbn").filter { it.isDigit() || it == 'X' },
                publisher = b.str("publisher"),
                publishedYear = b.str("published").take(10),
                language = b.str("language"),
                pageCount = length,
                format = format,
                description = b.str("description"),
                coverUrl = b.str("cover_url"),
                status = status,
                rating = (b.double("rating") ?: 0.0).toFloat().coerceIn(0f, 5f),
                review = b.str("review"),
                startedOn = lastRead?.day("start"),
                finishedOn = lastRead?.day("end"),
                currentPage = if (status == ReadingStatus.READ && length > 0) length else position,
                readCount = reads.count { it.day("end") != null },
                favorite = b.bool("favorite") == true,
                genres = b.arr("genres").orEmpty().mapNotNull { (it as? JsonPrimitive)?.content }.joinToString(", "),
                tags = b.arr("tags").orEmpty().mapNotNull { (it as? JsonPrimitive)?.longOrNull?.let(tagNames::get) }.filter { it.isNotBlank() }.joinToString(", "),
                series = b.str("series"),
                seriesPosition = (b.double("series_pos") ?: 0.0).toFloat(),
                addedAt = b.millis("added", zone) ?: System.currentTimeMillis(),
                updatedAt = b.millis("updated", zone) ?: System.currentTimeMillis(),
            )
            b.long("shelf")?.let(customShelfId::get)?.let { links += BookShelf(id, it) }
            entries.forEach { e ->
                sessions += ReadingSession(
                    id = sessions.size + 1L,
                    bookId = id,
                    startedAt = e.millis("when", zone) ?: System.currentTimeMillis(),
                    startPage = e.int("start"),
                    endPage = e.int("end"),
                    minutes = (e.double("minutes") ?: 0.0).toFloat(),
                    note = e.str("note"),
                )
            }
            b.arr("quotes").orEmpty().mapNotNull { it.obj() }.forEach { q ->
                if (q.str("text").isNotBlank()) {
                    quotes += Quote(id = quotes.size + 1L, bookId = id, text = q.str("text"), page = q.int("page"), createdAt = q.dayMillis("added", zone))
                }
            }
            b.arr("notes").orEmpty().mapNotNull { it.obj() }.forEach { n ->
                if (n.str("text").isNotBlank()) {
                    notes += Note(id = notes.size + 1L, bookId = id, title = n.str("title"), text = n.str("text"), page = n.int("page"), createdAt = n.dayMillis("added", zone))
                }
            }
        }

        val goals = root.arr("goals").orEmpty().mapNotNull { it.obj() }.mapIndexedNotNull { index, g ->
            val start = g.day("start") ?: return@mapIndexedNotNull null
            val end = g.day("end") ?: return@mapIndexedNotNull null
            Goal(
                id = index + 1L,
                name = g.str("name"),
                kind = when (g.str("kind")) {
                    "Pages" -> GoalKind.PAGES
                    "Minutes" -> GoalKind.MINUTES
                    else -> GoalKind.BOOKS
                },
                target = (g.double("target") ?: 0.0).toInt().coerceAtLeast(1),
                startDay = start,
                endDay = end,
                repeat = when (g.str("repeat")) {
                    "Daily" -> GoalRepeat.DAILY
                    "Weekly" -> GoalRepeat.WEEKLY
                    "Monthly" -> GoalRepeat.MONTHLY
                    "Yearly" -> GoalRepeat.YEARLY
                    else -> GoalRepeat.ONCE
                },
                archived = g.bool("archived") == true,
            )
        }

        return BackupPayload(System.currentTimeMillis(), books, shelves, links, quotes, sessions, notes, goals)
    }

    private fun JsonElement?.obj(): JsonObject? = this as? JsonObject
    private fun JsonObject.prim(key: String): JsonPrimitive? = (this[key] as? JsonPrimitive)?.takeIf { it !is JsonNull }
    private fun JsonObject.str(key: String): String = prim(key)?.content.orEmpty()
    private fun JsonObject.long(key: String): Long? = prim(key)?.longOrNull
    private fun JsonObject.int(key: String): Int = (prim(key)?.doubleOrNull ?: 0.0).toInt().coerceAtLeast(0)
    private fun JsonObject.double(key: String): Double? = prim(key)?.doubleOrNull
    private fun JsonObject.bool(key: String): Boolean? = prim(key)?.booleanOrNull
    private fun JsonObject.arr(key: String): JsonArray? = this[key] as? JsonArray

    private fun JsonObject.day(key: String): Long? =
        prim(key)?.content?.let { runCatching { LocalDate.parse(it.take(10)).toEpochDay() }.getOrNull() }

    private fun JsonObject.millis(key: String, zone: ZoneId): Long? =
        prim(key)?.content?.let { runCatching { LocalDateTime.parse(it).atZone(zone).toInstant().toEpochMilli() }.getOrNull() }

    private fun JsonObject.dayMillis(key: String, zone: ZoneId): Long =
        day(key)?.let { LocalDate.ofEpochDay(it).atTime(12, 0).atZone(zone).toInstant().toEpochMilli() } ?: System.currentTimeMillis()
}
