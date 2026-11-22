package ch.schmidtbit.shelfmark.data.repo

import androidx.room.withTransaction
import ch.schmidtbit.shelfmark.data.db.AppDatabase
import ch.schmidtbit.shelfmark.data.importer.LegacyImporter
import ch.schmidtbit.shelfmark.data.share.BackupPayload
import ch.schmidtbit.shelfmark.data.share.Envelope
import ch.schmidtbit.shelfmark.data.share.ShareCodec
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.ByteArrayOutputStream
import java.io.InputStream
import java.io.OutputStream
import java.util.zip.ZipEntry
import java.util.zip.ZipInputStream
import java.util.zip.ZipOutputStream

/**
 * Full backup of the user's own library as a zip: one JSON file with all books,
 * lists and quotes, plus the cover photos the user took.
 */
class BackupManager(private val db: AppDatabase, private val covers: CoverStore) {

    suspend fun export(out: OutputStream) = withContext(Dispatchers.IO) {
        val payload = BackupPayload(
            exportedAt = System.currentTimeMillis(),
            books = db.books().all(),
            shelves = db.shelves().all(),
            links = db.shelves().allLinks(),
            quotes = db.quotes().all(),
            sessions = db.sessions().all(),
            notes = db.notes().all(),
            goals = db.goals().all(),
        )
        ZipOutputStream(out).use { zip ->
            zip.putNextEntry(ZipEntry(JSON_NAME))
            zip.write(ShareCodec.encode(Envelope(type = Envelope.TYPE_BACKUP, backup = payload)).toByteArray())
            zip.closeEntry()
            payload.books.map { it.coverPath }.filter { it.isNotBlank() }.distinct().forEach { name ->
                val file = covers.file(name)
                if (file.exists()) {
                    zip.putNextEntry(ZipEntry(COVER_PREFIX + name))
                    file.inputStream().use { it.copyTo(zip) }
                    zip.closeEntry()
                }
            }
        }
    }

    /**
     * Replaces the current library with the backup. Returns the number of restored books,
     * or null if the stream is not a Shelfmark backup (in which case nothing is changed).
     */
    suspend fun restore(input: InputStream): Int? = withContext(Dispatchers.IO) {
        var payload: BackupPayload? = null
        val coverFiles = HashMap<String, ByteArray>()
        runCatching {
            ZipInputStream(input).use { zip ->
                while (true) {
                    val entry = zip.nextEntry ?: break
                    val name = entry.name
                    when {
                        // The desktop app's export zip uses the same file name for its own format.
                        name.substringAfterLast('/') == JSON_NAME -> payload = parseBackup(zip.readBytes().decodeToString())
                        // Only plain file names are accepted, so an archive cannot write outside the cover folder.
                        name.startsWith(COVER_PREFIX) && isSafeName(name.removePrefix(COVER_PREFIX)) ->
                            coverFiles[name.removePrefix(COVER_PREFIX)] = zip.readBytes()
                    }
                }
            }
        }
        val backup = payload ?: return@withContext null
        restore(backup)
        coverFiles.forEach { (name, bytes) -> covers.file(name).writeBytes(bytes) }
        backup.books.size
    }

    suspend fun restore(backup: BackupPayload) {
        db.withTransaction {
            // Deleting the books cascades to their quotes, sessions, notes and list memberships.
            db.books().clear()
            db.shelves().clear()
            db.goals().clear()
            backup.shelves.forEach { db.shelves().insert(it) }
            backup.books.forEach { db.books().insert(it) }
            val bookIds = backup.books.map { it.id }.toSet()
            val shelfIds = backup.shelves.map { it.id }.toSet()
            backup.links.filter { it.bookId in bookIds && it.shelfId in shelfIds }.forEach { db.shelves().link(it) }
            backup.quotes.filter { it.bookId in bookIds }.forEach { db.quotes().insert(it) }
            backup.sessions.filter { it.bookId in bookIds }.forEach { db.sessions().insert(it) }
            backup.notes.filter { it.bookId in bookIds }.forEach { db.notes().insert(it) }
            backup.goals.forEach { db.goals().insert(it) }
        }
    }

    /** Accepts this app's backup and the desktop Shelfmark's library file. */
    fun parseBackup(text: String): BackupPayload? = ShareCodec.decode(text)?.backup ?: LegacyImporter.parse(text)

    private fun isSafeName(name: String): Boolean =
        name.isNotBlank() && name.none { it == '/' || it == '\\' } && name != "." && name != ".."

    private fun ZipInputStream.readBytes(): ByteArray = ByteArrayOutputStream().also { copyTo(it) }.toByteArray()

    companion object {
        const val JSON_NAME = "shelfmark-backup.json"
        const val COVER_PREFIX = "covers/"
    }
}
