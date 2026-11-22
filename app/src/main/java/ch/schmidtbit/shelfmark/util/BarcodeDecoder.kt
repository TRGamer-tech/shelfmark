package ch.schmidtbit.shelfmark.util

import com.google.zxing.BarcodeFormat
import com.google.zxing.BinaryBitmap
import com.google.zxing.DecodeHintType
import com.google.zxing.MultiFormatReader
import com.google.zxing.PlanarYUVLuminanceSource
import com.google.zxing.ReaderException
import com.google.zxing.common.HybridBinarizer

/** Finds the ISBN barcode (EAN-13 with a 978/979 prefix) in a greyscale camera frame. */
object BarcodeDecoder {
    private val hints = mapOf(
        DecodeHintType.POSSIBLE_FORMATS to listOf(BarcodeFormat.EAN_13),
        DecodeHintType.TRY_HARDER to true,
    )

    /**
     * [luminance] holds one byte per pixel, row by row. The frame is tried as it is and
     * turned by 90 degrees, because the sensor is usually mounted sideways to the phone.
     */
    fun decodeIsbn(luminance: ByteArray, width: Int, height: Int): String? =
        decode(luminance, width, height) ?: decode(rotate90(luminance, width, height), height, width)

    private fun decode(data: ByteArray, width: Int, height: Int): String? = try {
        val source = PlanarYUVLuminanceSource(data, width, height, 0, 0, width, height, false)
        val reader = MultiFormatReader().apply { setHints(hints) }
        reader.decodeWithState(BinaryBitmap(HybridBinarizer(source))).text?.takeIf { Isbn.isBookEan(it) }
    } catch (e: ReaderException) {
        null
    }

    internal fun rotate90(data: ByteArray, width: Int, height: Int): ByteArray {
        val out = ByteArray(width * height)
        for (y in 0 until height) {
            val row = y * width
            for (x in 0 until width) {
                out[x * height + (height - 1 - y)] = data[row + x]
            }
        }
        return out
    }
}
