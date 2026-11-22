package ch.schmidtbit.shelfmark.data.repo

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.ImageDecoder
import android.net.Uri
import android.os.Build
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.File
import java.util.UUID
import kotlin.math.max

/** Stores covers the user photographed or picked, scaled down, inside the app's private files. */
class CoverStore(private val context: Context) {
    val dir: File
        get() = File(context.filesDir, "covers").apply { mkdirs() }

    fun file(name: String): File = File(dir, name)

    suspend fun saveFromUri(uri: Uri): String? = withContext(Dispatchers.IO) {
        runCatching { decode(uri) }.getOrNull()?.let { saveBitmap(it) }
    }

    suspend fun saveBitmap(bitmap: Bitmap): String = withContext(Dispatchers.IO) {
        val scaled = scaleDown(bitmap, MAX_EDGE)
        val name = "${UUID.randomUUID()}.jpg"
        file(name).outputStream().use { scaled.compress(Bitmap.CompressFormat.JPEG, 88, it) }
        name
    }

    fun delete(name: String) {
        if (name.isNotBlank()) file(name).delete()
    }

    private fun decode(uri: Uri): Bitmap? =
        if (Build.VERSION.SDK_INT >= 28) {
            val source = ImageDecoder.createSource(context.contentResolver, uri)
            ImageDecoder.decodeBitmap(source) { decoder, info, _ ->
                decoder.allocator = ImageDecoder.ALLOCATOR_SOFTWARE
                val longest = max(info.size.width, info.size.height)
                if (longest > MAX_EDGE) {
                    val factor = MAX_EDGE.toFloat() / longest
                    decoder.setTargetSize(
                        (info.size.width * factor).toInt().coerceAtLeast(1),
                        (info.size.height * factor).toInt().coerceAtLeast(1),
                    )
                }
            }
        } else {
            context.contentResolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it) }
        }

    private fun scaleDown(bitmap: Bitmap, maxEdge: Int): Bitmap {
        val longest = max(bitmap.width, bitmap.height)
        if (longest <= maxEdge) return bitmap
        val factor = maxEdge.toFloat() / longest
        return Bitmap.createScaledBitmap(
            bitmap,
            (bitmap.width * factor).toInt().coerceAtLeast(1),
            (bitmap.height * factor).toInt().coerceAtLeast(1),
            true,
        )
    }

    private companion object {
        const val MAX_EDGE = 1000
    }
}
