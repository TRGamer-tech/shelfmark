package ch.schmidtbit.shelfmark.ui

import android.content.Context
import android.net.Uri
import android.widget.Toast
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
import ch.schmidtbit.shelfmark.data.repo.SyncResult
import ch.schmidtbit.shelfmark.data.share.BackupPayload
import ch.schmidtbit.shelfmark.data.share.Envelope
import ch.schmidtbit.shelfmark.data.share.ShareCodec
import ch.schmidtbit.shelfmark.data.share.ShareFiles
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.ByteArrayInputStream

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
 * a friend's library, a borrow request, its answer, or a backup.
 */
class ImportController(private val container: AppContainer, private val context: Context) {
    var outcome by mutableStateOf<ImportOutcome?>(null)

    fun open(uri: Uri) {
        container.launch {
            val bytes = withContext(Dispatchers.IO) { ShareFiles.readBytes(context, uri) }
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
            val count = when {
                pending.zip != null -> container.backup.restore(ByteArrayInputStream(pending.zip))
                pending.backup != null -> pending.backup.books.size.also { container.backup.restore(pending.backup) }
                else -> null
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
            val (added, completed) = container.library.importBooks(pending.plan)
            outcome = ImportOutcome.Imported(added, completed)
        }
    }

    /** Writes [envelope] to a file and opens the share sheet so it can be sent with any messenger. */
    fun share(envelope: Envelope, baseName: String, subject: String, message: String) {
        val uri = ShareFiles.write(context, envelope, baseName)
        ShareFiles.send(context, uri, subject, message, context.getString(R.string.share_chooser))
    }

    /**
     * Gets [envelope] to a friend: through the server when the friend is connected there,
     * otherwise as a file through the share sheet.
     */
    fun deliver(peerId: String, envelope: Envelope, baseName: String, subject: String, message: String) {
        container.launch { deliverNow(peerId, envelope, baseName, subject, message) }
    }

    private suspend fun deliverNow(peerId: String, envelope: Envelope, baseName: String, subject: String, message: String) {
        if (container.server.canReach(peerId)) {
            val sent = container.server.send(peerId, envelope)
            Toast.makeText(context, context.getString(if (sent) R.string.server_sent else R.string.server_queued), Toast.LENGTH_LONG).show()
        } else {
            share(envelope, baseName, subject, message)
        }
    }

    /** Answers a borrow request and gets the answer to the friend who asked. */
    fun answer(requestId: String, accept: Boolean) {
        container.launch {
            val envelope = container.social.answerRequest(requestId, accept) ?: return@launch
            val title = envelope.answer?.bookTitle.orEmpty()
            deliverNow(
                envelope.answer?.toId.orEmpty(),
                envelope,
                baseName = context.getString(R.string.share_answer_file, title),
                subject = context.getString(R.string.share_answer_subject, title),
                message = context.getString(if (accept) R.string.share_answer_yes else R.string.share_answer_no, title),
            )
        }
    }

    /**
     * Looks whether friends wrote. With the app open, a new request or answer is shown
     * right away, the same way as when its file is opened.
     */
    fun refresh(force: Boolean = false) {
        container.launch {
            val news = container.refreshFriends(force) as? SyncResult.Done ?: return@launch
            if (outcome != null) return@launch
            val first: ImportResult? = news.requests.firstOrNull() ?: news.answers.firstOrNull()
            if (first != null) outcome = ImportOutcome.Done(first)
        }
    }
}

val LocalImporter = staticCompositionLocalOf<ImportController> { error("ImportController not provided") }
