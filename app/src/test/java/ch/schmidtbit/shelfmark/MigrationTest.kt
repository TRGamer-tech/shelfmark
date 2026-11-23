package ch.schmidtbit.shelfmark

import android.content.Context
import android.database.sqlite.SQLiteDatabase
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import ch.schmidtbit.shelfmark.data.db.AppDatabase
import ch.schmidtbit.shelfmark.data.model.OrnamentKind
import ch.schmidtbit.shelfmark.data.model.Purchase
import ch.schmidtbit.shelfmark.data.model.ReadingStatus
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import java.io.File

/**
 * An update of the app must keep the library: version 1 data has to open as version 2.
 * The old database is built from the schema file Room exported for version 1, then opened
 * with the current code. Room migrates it and refuses to open if the result does not match.
 */
@RunWith(RobolectricTestRunner::class)
class MigrationTest {
    private val name = "migration-test.db"
    private val context: Context get() = ApplicationProvider.getApplicationContext()

    /** Creates a database exactly as the given version of the app would have. */
    private fun createOldDatabase(version: Int, fill: (SQLiteDatabase) -> Unit) {
        val schema = Json.parseToJsonElement(File("schemas/ch.schmidtbit.shelfmark.data.db.AppDatabase/$version.json").readText()).jsonObject
            .getValue("database").jsonObject
        context.deleteDatabase(name)
        context.openOrCreateDatabase(name, Context.MODE_PRIVATE, null).use { db ->
            schema.getValue("entities").jsonArray.forEach { entity ->
                val table = entity.jsonObject.getValue("tableName").jsonPrimitive.content
                db.execSQL(entity.jsonObject.getValue("createSql").jsonPrimitive.content.replace("\${TABLE_NAME}", table))
                entity.jsonObject["indices"]?.jsonArray?.forEach { index ->
                    db.execSQL(index.jsonObject.getValue("createSql").jsonPrimitive.content.replace("\${TABLE_NAME}", table))
                }
            }
            schema.getValue("setupQueries").jsonArray.forEach { db.execSQL(it.jsonPrimitive.content) }
            fill(db)
            db.version = version
        }
    }

    @Test fun libraryOfVersionOneSurvivesTheUpdate() = runBlocking {
        createOldDatabase(1) { db ->
            db.execSQL(
                "INSERT INTO books (id, title, subtitle, authors, isbn, publisher, publishedYear, language, pageCount, format, description, " +
                    "coverUrl, coverPath, status, ownership, borrowedFrom, lendable, lentTo, lentSince, rating, spice, review, startedOn, finishedOn, " +
                    "currentPage, readCount, favorite, genres, tags, series, seriesPosition, addedAt, updatedAt) VALUES " +
                    "(7, 'Der Vorleser', '', 'Bernhard Schlink', '9783257229530', 'Diogenes', '1997', 'de', 206, 'PAPERBACK', '', " +
                    "'', '', 'READ', 'OWNED', '', 1, 'Ben', 20000, 4.5, 2, 'Stark.', 19990, 20000, 206, 1, 1, 'Roman', '', '', 0, 1000, 2000)",
            )
            db.execSQL("INSERT INTO quotes (id, bookId, text, page, note, fromOcr, createdAt) VALUES (1, 7, 'Ein Zitat.', 12, '', 0, 3000)")
            db.execSQL("INSERT INTO sessions (id, bookId, startedAt, startPage, endPage, minutes, note) VALUES (1, 7, 4000, 0, 50, 60.0, '')")
            db.execSQL("INSERT INTO shelves (id, name, position, createdAt) VALUES (3, 'Favoriten', 0, 5000)")
            db.execSQL("INSERT INTO book_shelf (bookId, shelfId) VALUES (7, 3)")
            db.execSQL("INSERT INTO friends (id, name, sharedAt, importedAt, includesStatus, includesRatings) VALUES ('friend-1', 'Ben', 6000, 7000, 1, 0)")
        }

        val db = Room.databaseBuilder(context, AppDatabase::class.java, name).build()
        try {
            val book = db.books().get(7)!!
            assertEquals("Der Vorleser", book.title)
            assertEquals(ReadingStatus.READ, book.status)
            assertEquals(4.5f, book.rating)
            assertEquals(2, book.spice)
            assertEquals("Ben", book.lentTo)
            assertTrue(book.favorite)
            assertEquals("Ein Zitat.", db.quotes().all().single().text)
            assertEquals(50, db.sessions().all().single().endPage)
            assertEquals(3L, db.shelves().allLinks().single().shelfId)

            // The tables that are new in version 2 are there and usable.
            db.purchases().insert(Purchase(bookId = 7, day = 20001, price = 14.9, currency = "CHF", store = "Orell"))
            assertEquals(14.9, db.purchases().observeForBook(7).first().single().price, 0.0)
            db.ornaments().insert(ch.schmidtbit.shelfmark.data.model.Ornament(shelfKey = "READ", kind = OrnamentKind.TROPHY, position = 1))
            assertEquals(OrnamentKind.TROPHY, db.ornaments().all().single().kind)

            // Version 3: a friend from before is simply not connected through the server, and there is an outbox.
            val friend = db.social().getFriend("friend-1")!!
            assertEquals("Ben", friend.name)
            assertEquals(false, friend.online)
            assertEquals(0L, friend.serverAt)
            db.social().markOnline("friend-1", 99)
            assertEquals(listOf("friend-1"), db.social().onlineFriends().map { it.id })
            db.social().enqueue(ch.schmidtbit.shelfmark.data.model.OutboxMessage(toId = "friend-1", payload = "{}"))
            assertEquals(1, db.social().outbox().size)
        } finally {
            db.close()
        }
    }
}
