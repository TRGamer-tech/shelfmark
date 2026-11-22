package ch.schmidtbit.shelfmark

import ch.schmidtbit.shelfmark.data.importer.LegacyImporter
import ch.schmidtbit.shelfmark.data.model.BookFormat
import ch.schmidtbit.shelfmark.data.model.GoalKind
import ch.schmidtbit.shelfmark.data.model.GoalRepeat
import ch.schmidtbit.shelfmark.data.model.ReadingStatus
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.LocalDate
import java.time.ZoneOffset

/** The library file of the desktop Shelfmark, written in the shape its Rust data model serialises to. */
class LegacyImporterTest {
    private val text = javaClass.classLoader!!.getResourceAsStream("fixtures/desktop_library.json")!!.bufferedReader().use { it.readText() }
    private val library = LegacyImporter.parse(text, ZoneOffset.UTC)!!

    @Test fun booksKeepTheirDetails() {
        // The sample book the desktop app ships for trying it out is left behind.
        assertEquals(listOf("Project Hail Mary", "Iron Gold", "Dune", "The Culture Map"), library.books.map { it.title })
        val book = library.books.first()
        assertEquals("Andy Weir", book.authors)
        assertEquals("9780593135204", book.isbn)
        assertEquals(478, book.pageCount)
        assertEquals(BookFormat.PAPERBACK, book.format)
        assertEquals(4.75f, book.rating)
        assertEquals("Rocky!", book.review)
        assertEquals("Space, Fiction", book.genres)
        assertEquals("cozy", book.tags)
        assertTrue(book.favorite)
        assertEquals(LocalDate.parse("2026-02-04").toEpochDay(), book.startedOn)
        assertEquals(LocalDate.parse("2026-03-05").toEpochDay(), book.finishedOn)
        assertEquals(1, book.readCount)
        assertEquals(478, book.currentPage)
    }

    @Test fun builtInShelvesBecomeTheStatusAndCustomShelvesBecomeLists() {
        val byTitle = library.books.associateBy { it.title }
        assertEquals(ReadingStatus.READ, byTitle.getValue("Project Hail Mary").status)
        assertEquals(ReadingStatus.READING, byTitle.getValue("Iron Gold").status)
        assertEquals(120, byTitle.getValue("Iron Gold").currentPage)
        assertEquals("Red Rising", byTitle.getValue("Iron Gold").series)
        assertEquals(4f, byTitle.getValue("Iron Gold").seriesPosition)
        assertEquals(ReadingStatus.NONE, byTitle.getValue("Dune").status)
        // Audiobooks are measured in minutes.
        assertEquals(BookFormat.AUDIOBOOK, byTitle.getValue("Dune").format)
        assertEquals(1260, byTitle.getValue("Dune").pageCount)

        assertEquals(listOf("Paused"), library.shelves.map { it.name })
        val paused = library.links.single()
        assertEquals(byTitle.getValue("The Culture Map").id, paused.bookId)
        assertEquals(library.shelves.single().id, paused.shelfId)
    }

    @Test fun sessionsQuotesNotesAndGoalsComeAlong() {
        assertEquals(3, library.sessions.size)
        val last = library.sessions[1]
        assertEquals(467, last.startPage)
        assertEquals(478, last.endPage)
        assertEquals(14f, last.minutes)
        assertEquals("the end", last.note)
        assertEquals(0f, library.sessions[2].minutes)

        assertEquals("Fist my bump.", library.quotes.single().text)
        assertEquals(301, library.quotes.single().page)
        assertEquals("Reread in a year", library.notes.single().text)
        assertEquals("Idea", library.notes.single().title)

        assertEquals(2, library.goals.size)
        assertEquals(GoalKind.PAGES, library.goals[0].kind)
        assertEquals(5000, library.goals[0].target)
        assertEquals(GoalRepeat.ONCE, library.goals[0].repeat)
        assertEquals(GoalRepeat.YEARLY, library.goals[1].repeat)
    }

    @Test fun otherJsonIsNotMistakenForALibrary() {
        assertNull(LegacyImporter.parse("""{"app":"shelfmark","v":1,"type":"library"}"""))
        assertNull(LegacyImporter.parse("not json"))
        assertNull(LegacyImporter.parse("""{"books": 5}"""))
    }
}
