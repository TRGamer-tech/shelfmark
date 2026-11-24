package ch.schmidtbit.shelfmark.data.repo

import androidx.room.withTransaction
import ch.schmidtbit.shelfmark.data.db.AppDatabase
import ch.schmidtbit.shelfmark.data.importer.CsvImporter
import ch.schmidtbit.shelfmark.data.importer.ImportPlan
import ch.schmidtbit.shelfmark.data.importer.LegacyImporter
import ch.schmidtbit.shelfmark.data.share.BackupPayload
import ch.schmidtbit.shelfmark.data.share.Envelope
import ch.schmidtbit.shelfmark.data.share.ShareCodec
import ch.schmidtbit.shelfmark.data.share.VaultPrefs
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.ByteArrayOutputStream
import java.io.File
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

    /**
     * The whole library as one document, in a fixed order, so that the same library
     * always gives the same document. [prefs] are the settings that belong to the person.
     */
    suspend fun snapshot(prefs: VaultPrefs? = null, at: Long = System.currentTimeMillis()): BackupPayload = BackupPayload(
        exportedAt = at,
        books = db.books().all().sortedBy { it.id },
        shelves = db.shelves().all().sortedBy { it.id },
        links = db.shelves().allLinks().sortedWith(compareBy({ it.bookId }, { it.shelfId })),
        quotes = db.quotes().all().sortedBy { it.id },
        sessions = db.sessions().all().sortedBy { it.id },
        notes = db.notes().all().sortedBy { it.id },
        goals = db.goals().all().sortedBy { it.id },
        purchases = db.purchases().all().sortedBy { it.id },
        ornaments = db.ornaments().all().sortedBy { it.id },
        prefs = prefs,
    )

    /**
     * Writes a backup: the library as it is now, or [library] when one is given, with the
     * cover photos of its books that are on this phone.
     */
    suspend fun export(out: OutputStream, library: BackupPayload? = null) = withContext(Dispatchers.IO) {
        val payload = library ?: snapshot()
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

    /**
     * Saves a backup to wherever [open] leads: a file the reader chose, on the phone, on a
     * drive in the cloud, on a stick. False when nothing usable was written, because the
     * place gave no way in or broke off on the way. A place like that is not the app's to
     * trust, so whatever it throws ends here.
     */
    suspend fun exportTo(open: () -> OutputStream?): Boolean = withContext(Dispatchers.IO) {
        try {
            val out = open() ?: return@withContext false
            out.use { export(it) }
            true
        } catch (e: kotlin.coroutines.cancellation.CancellationException) {
            throw e
        } catch (e: Exception) {
            false
        }
    }

    /**
     * Puts [library] aside in [dir] before it is replaced as a whole, as a backup file that
     * the backup import reads. Only the newest [KEPT] are kept. Returns the file, or null
     * when it could not be written: the library on its way out is then lost as it would
     * have been before, which is no reason to stop the reader from going on.
     */
    suspend fun keepReplaced(library: BackupPayload, dir: File, at: Long = System.currentTimeMillis()): File? = withContext(Dispatchers.IO) {
        runCatching {
            dir.mkdirs()
            val file = File(dir, "$REPLACED_PREFIX$at.zip")
            file.outputStream().use { export(it, library.copy(exportedAt = at)) }
            replaced(dir).drop(KEPT).forEach { it.delete() }
            file
        }.getOrNull()
    }

    /** The libraries that were put aside in [dir], the newest first. */
    fun replaced(dir: File): List<File> =
        dir.listFiles { file -> file.name.startsWith(REPLACED_PREFIX) && file.name.endsWith(".zip") }.orEmpty().sortedByDescending { it.name }

    /**
     * Replaces the library with [backup]. With [onlyIf] given, only while the library is
     * still what it was when that snapshot was taken, looked at and written in one
     * transaction: what the reader changed in the meantime is not run over. [together] is
     * what has to change along with the library (the settings, which live elsewhere): when
     * it says no, the library stays as it was. Returns the library as it stands afterwards,
     * or null when nothing was written.
     */
    suspend fun restore(backup: BackupPayload, onlyIf: BackupPayload? = null, together: suspend () -> Boolean = { true }): BackupPayload? = try {
        replace(backup, onlyIf, together)
    } catch (e: NotWritten) {
        null
    }

    /** Leaves the transaction without keeping what it wrote. */
    private class NotWritten : Exception()

    private suspend fun replace(backup: BackupPayload, onlyIf: BackupPayload?, together: suspend () -> Boolean): BackupPayload =
        db.withTransaction {
            if (onlyIf != null && !sameLibrary(snapshot(at = 0), onlyIf)) throw NotWritten()
            // Deleting the books cascades to their quotes, sessions, notes and list memberships.
            db.books().clear()
            db.shelves().clear()
            db.goals().clear()
            db.ornaments().clear()
            backup.shelves.forEach { db.shelves().insert(it) }
            backup.books.forEach { db.books().insert(it) }
            val bookIds = backup.books.map { it.id }.toSet()
            val shelfIds = backup.shelves.map { it.id }.toSet()
            backup.links.filter { it.bookId in bookIds && it.shelfId in shelfIds }.forEach { db.shelves().link(it) }
            backup.quotes.filter { it.bookId in bookIds }.forEach { db.quotes().insert(it) }
            backup.sessions.filter { it.bookId in bookIds }.forEach { db.sessions().insert(it) }
            backup.notes.filter { it.bookId in bookIds }.forEach { db.notes().insert(it) }
            backup.goals.forEach { db.goals().insert(it) }
            backup.purchases.filter { it.bookId in bookIds }.forEach { db.purchases().insert(it) }
            // Ornaments on a custom list only make sense if that list came along.
            backup.ornaments.filter { o -> !o.shelfKey.startsWith("list_") || o.shelfKey.removePrefix("list_").toLongOrNull() in shelfIds }
                .forEach { db.ornaments().insert(it) }
            if (!together()) throw NotWritten()
            snapshot(at = 0)
        }

    /** Whether two snapshots hold the same books, lists, quotes and so on. When they were taken and the settings do not count. */
    private fun sameLibrary(a: BackupPayload, b: BackupPayload): Boolean = a.copy(exportedAt = 0, prefs = null) == b.copy(exportedAt = 0, prefs = null)

    /**
     * Looks into a zip without changing anything. Returns the backup it holds, or failing
     * that the first table of books found among its CSV files, or null for neither.
     */
    suspend fun inspect(input: InputStream): Pair<BackupPayload?, ImportPlan?> = withContext(Dispatchers.IO) {
        var backup: BackupPayload? = null
        val plans = ArrayList<Pair<String, ImportPlan>>()
        runCatching {
            ZipInputStream(input).use { zip ->
                while (true) {
                    val entry = zip.nextEntry ?: break
                    val name = entry.name.substringAfterLast('/')
                    when {
                        name == JSON_NAME -> backup = parseBackup(zip.readBytes().decodeToString())
                        name.endsWith(".csv", ignoreCase = true) -> CsvImporter.parse(zip.readBytes().decodeToString())?.let { plans += name.lowercase() to it }
                    }
                }
            }
        }
        // An export often holds several tables (books, sessions, quotes). The one with the
        // books is the file named after them, or else simply the longest list.
        val plan = plans.firstOrNull { (name, _) -> name.startsWith("book") || name.startsWith("librar") || name.startsWith("buch") || name.startsWith("bücher") }?.second
            ?: plans.maxByOrNull { it.second.books.size }?.second
        backup to plan
    }

    /** Accepts this app's backup and the desktop Shelfmark's library file. */
    fun parseBackup(text: String): BackupPayload? = ShareCodec.decode(text)?.backup ?: LegacyImporter.parse(text)

    private fun isSafeName(name: String): Boolean =
        name.isNotBlank() && name.none { it == '/' || it == '\\' } && name != "." && name != ".."

    private fun ZipInputStream.readBytes(): ByteArray = ByteArrayOutputStream().also { copyTo(it) }.toByteArray()

    companion object {
        /** When the library in [file] was put aside: its name says so, and failing that the file itself. */
        fun replacedAt(file: File): Long = file.name.removePrefix(REPLACED_PREFIX).removeSuffix(".zip").toLongOrNull() ?: file.lastModified()

        const val JSON_NAME = "shelfmark-backup.json"
        const val COVER_PREFIX = "covers/"

        /** How the files of libraries that were replaced as a whole begin. The moment follows, so that names sort by age. */
        const val REPLACED_PREFIX = "shelfmark-replaced-"

        /** How many replaced libraries are kept. */
        const val KEPT = 3
    }
}
