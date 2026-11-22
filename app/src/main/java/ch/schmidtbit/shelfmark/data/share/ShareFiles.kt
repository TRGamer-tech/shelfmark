package ch.schmidtbit.shelfmark.data.share

import android.app.Activity
import android.content.ClipData
import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.core.content.FileProvider
import java.io.ByteArrayOutputStream
import java.io.File

/** Writes Shelfmark files for the share sheet and reads the ones that come in. */
object ShareFiles {
    const val MIME = "application/json"
    private const val MAX_BYTES = 16 * 1024 * 1024
    private const val KEEP_MS = 24 * 60 * 60 * 1000L

    fun write(context: Context, envelope: Envelope, baseName: String): Uri {
        val dir = File(context.cacheDir, "shared").apply { mkdirs() }
        val now = System.currentTimeMillis()
        dir.listFiles()?.forEach { if (now - it.lastModified() > KEEP_MS) it.delete() }
        val file = File(dir, fileName(baseName))
        file.writeText(ShareCodec.encode(envelope))
        return FileProvider.getUriForFile(context, context.packageName + ".files", file)
    }

    /** Opens the system share sheet with the file attached and [text] as the message. */
    fun send(context: Context, uri: Uri, subject: String, text: String, chooserTitle: String) {
        val send = Intent(Intent.ACTION_SEND).apply {
            type = MIME
            putExtra(Intent.EXTRA_STREAM, uri)
            putExtra(Intent.EXTRA_SUBJECT, subject)
            putExtra(Intent.EXTRA_TEXT, text)
            clipData = ClipData.newRawUri(subject, uri)
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }
        val chooser = Intent.createChooser(send, chooserTitle)
        if (context !is Activity) chooser.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        context.startActivity(chooser)
    }

    /** Reads an incoming file. Returns null if it cannot be read or is unreasonably large. */
    fun readBytes(context: Context, uri: Uri): ByteArray? = runCatching {
        context.contentResolver.openInputStream(uri)?.use { input ->
            val out = ByteArrayOutputStream()
            val buffer = ByteArray(64 * 1024)
            while (true) {
                val n = input.read(buffer)
                if (n < 0) break
                out.write(buffer, 0, n)
                if (out.size() > MAX_BYTES) return null
            }
            out.toByteArray()
        }
    }.getOrNull()

    fun isZip(bytes: ByteArray): Boolean = bytes.size > 3 && bytes[0] == 'P'.code.toByte() && bytes[1] == 'K'.code.toByte()

    /** "Anna's library" becomes "Anna-s-library.shelfmark.json". */
    fun fileName(baseName: String): String {
        val safe = baseName.map { if (it.isLetterOrDigit()) it else '-' }.joinToString("")
            .replace(Regex("-+"), "-").trim('-').take(48).ifBlank { "shelfmark" }
        return "$safe.shelfmark.json"
    }
}
