package ch.schmidtbit.shelfmark.ui

import android.content.Context
import android.net.Uri
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.runtime.staticCompositionLocalOf
import ch.schmidtbit.shelfmark.AppContainer
import ch.schmidtbit.shelfmark.R
import ch.schmidtbit.shelfmark.data.importer.CsvImporter
import ch.schmidtbit.shelfmark.data.importer.ImportPlan
import ch.schmidtbit.shelfmark.data.importer.LegacyImporter
import ch.schmidtbit.shelfmark.data.repo.ImportResult
import ch.schmidtbit.shelfmark.data.repo.RejectReason
import ch.schmidtbit.shelfmark.data.share.BackupPayload
import ch.schmidtbit.shelfmark.data.share.Envelope
import ch.schmidtbit.shelfmark.data.share.ShareCodec
import ch.schmidtbit.shelfmark.data.share.ShareFiles
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.ByteArrayInputStream
import java.io.File

sealed interface ImportOutcome {
    data class Done(val result: ImportResult) : ImportOutcome
    /** A backup was opened. Restoring replaces the library, so the user is asked first. */
    class ConfirmRestore(val backup: BackupPayload?, val zip: ByteArray?, val bookCount: Int?) : ImportOutcome
    data class Restored(val books: Int) : ImportOutcome
    /** A list of books from another app was opened. Importing adds to the library. */
    class ConfirmImport(val plan: ImportPlan, val newBooks: Int, val known: Int) : ImportOutcome
    data class Imported(val added: Int, val completed: Int) : ImportOutcome
    data object Unreadable : ImportOutcome
}

/**
 * Single entry point for every file or text that reaches the app from outside:
 * a friend's library, a backup, or a list of books from another app.
 */
class ImportController(private val container: AppContainer, private val context: Context) {
    var outcome by mutableStateOf<ImportOutcome?>(null)

    fun open(uri: Uri) {
        container.launch { open(withContext(Dispatchers.IO) { ShareFiles.readBytes(context, uri) }) }
    }

    /** A file of the app's own, such as a library that was put aside when another one took its place. */
    fun open(file: File) {
        container.launch { open(withContext(Dispatchers.IO) { runCatching { file.readBytes() }.getOrNull() }) }
    }

    private suspend fun open(bytes: ByteArray?) {
        // Whatever a file from outside does to the code that reads it, the answer is "unreadable", not a closed app.
        try {
            when {
                bytes == null -> outcome = ImportOutcome.Unreadable
                ShareFiles.isZip(bytes) -> {
                    val (backup, plan) = container.backup.inspect(ByteArrayInputStream(bytes))
                    outcome = when {
                        backup != null -> ImportOutcome.ConfirmRestore(null, bytes, backup.books.size)
                        plan != null -> confirmImport(plan)
                        else -> ImportOutcome.Unreadable
                    }
                }
                else -> openText(bytes.decodeToString())
            }
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            outcome = ImportOutcome.Unreadable
        }
    }

    /** Returns false when [text] is no Shelfmark data at all, so the caller can treat it as plain text. */
    suspend fun openText(text: String, reportUnknown: Boolean = true): Boolean {
        val envelope = ShareCodec.decode(text)
        when {
            envelope?.backup != null -> outcome = ImportOutcome.ConfirmRestore(envelope.backup, null, envelope.backup.books.size)
            envelope != null -> outcome = ImportOutcome.Done(container.social.import(envelope))
            else -> {
                val legacy = withContext(Dispatchers.Default) { LegacyImporter.parse(text) }
                // A file that is neither JSON nor a zip may be a list of books from another app.
                val plan = if (legacy == null && reportUnknown) withContext(Dispatchers.Default) { CsvImporter.parse(text) } else null
                when {
                    legacy != null -> outcome = ImportOutcome.ConfirmRestore(legacy, null, legacy.books.size)
                    plan != null -> outcome = confirmImport(plan)
                    reportUnknown -> outcome = ImportOutcome.Done(ImportResult.Rejected(RejectReason.NOT_SHELFMARK))
                    else -> return false
                }
            }
        }
        return true
    }

    fun confirmRestore(pending: ImportOutcome.ConfirmRestore) {
        outcome = null
        container.launch {
            val count = try {
                when {
                    pending.zip != null -> container.backup.restore(ByteArrayInputStream(pending.zip))
                    pending.backup != null -> pending.backup.books.size.also { container.backup.restore(pending.backup) }
                    else -> null
                }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                // A backup that names a book twice, say. The transaction took nothing over.
                null
            }
            outcome = if (count == null) ImportOutcome.Unreadable else ImportOutcome.Restored(count)
        }
    }

    private suspend fun confirmImport(plan: ImportPlan): ImportOutcome {
        val (new, known) = container.library.previewImport(plan)
        return ImportOutcome.ConfirmImport(plan, new, known)
    }

    fun confirmImport(pending: ImportOutcome.ConfirmImport) {
        outcome = null
        container.launch {
            outcome = try {
                // One sync when all the books are in, not one for every few of them.
                val (added, completed) = container.bulk { container.library.importBooks(pending.plan) }
                ImportOutcome.Imported(added, completed)
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                ImportOutcome.Unreadable
            }
        }
    }

    /** Writes [envelope] to a file and opens the share sheet so it can be sent with any messenger. */
    fun share(envelope: Envelope, baseName: String, subject: String, message: String) {
        val uri = ShareFiles.write(context, envelope, baseName)
        ShareFiles.send(context, uri, subject, message, context.getString(R.string.share_chooser))
    }
}

val LocalImporter = staticCompositionLocalOf<ImportController> { error("ImportController not provided") }
