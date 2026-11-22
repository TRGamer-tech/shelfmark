package ch.schmidtbit.shelfmark.ui.camera

import android.content.Context
import android.graphics.Bitmap
import android.net.Uri
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.latin.TextRecognizerOptions
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

/** On-device text recognition (ML Kit, Latin script). Nothing leaves the phone. */
object Ocr {
    suspend fun lines(bitmap: Bitmap): List<String> = recognise(InputImage.fromBitmap(bitmap, 0))

    suspend fun lines(context: Context, uri: Uri): List<String> = recognise(InputImage.fromFilePath(context, uri))

    private suspend fun recognise(image: InputImage): List<String> = suspendCancellableCoroutine { cont ->
        val recognizer = TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS)
        recognizer.process(image)
            .addOnSuccessListener { result ->
                cont.resume(result.textBlocks.flatMap { block -> block.lines.map { it.text } })
            }
            .addOnFailureListener { if (cont.isActive) cont.resumeWithException(it) }
            .addOnCompleteListener { recognizer.close() }
    }
}
