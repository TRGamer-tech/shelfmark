package ch.schmidtbit.shelfmark.data.model

import ch.schmidtbit.shelfmark.util.finite
import kotlinx.serialization.KSerializer
import kotlinx.serialization.SerializationException
import kotlinx.serialization.descriptors.PrimitiveKind
import kotlinx.serialization.descriptors.PrimitiveSerialDescriptor
import kotlinx.serialization.descriptors.SerialDescriptor
import kotlinx.serialization.encoding.Decoder
import kotlinx.serialization.encoding.Encoder
import kotlinx.serialization.json.JsonDecoder
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonPrimitive

/**
 * A decimal number in a library document. Infinity and "not a number" cannot be written
 * as JSON, and a document that holds 1e39 where a float belongs cannot be read: one such
 * number, however it got there, would stop every sync and every backup for good. So what
 * is not finite is written and read as 0, which everywhere here means "not set".
 */
object FiniteFloat : KSerializer<Float> {
    override val descriptor: SerialDescriptor = PrimitiveSerialDescriptor("ch.schmidtbit.shelfmark.FiniteFloat", PrimitiveKind.FLOAT)

    override fun serialize(encoder: Encoder, value: Float) = encoder.encodeFloat(value.finite())

    override fun deserialize(decoder: Decoder): Float =
        if (decoder is JsonDecoder) number(decoder).toFloat().finite() else decoder.decodeFloat().finite()
}

/** The same as [FiniteFloat] for the numbers that are kept more exactly. */
object FiniteDouble : KSerializer<Double> {
    override val descriptor: SerialDescriptor = PrimitiveSerialDescriptor("ch.schmidtbit.shelfmark.FiniteDouble", PrimitiveKind.DOUBLE)

    override fun serialize(encoder: Encoder, value: Double) = encoder.encodeDouble(value.finite())

    override fun deserialize(decoder: Decoder): Double =
        if (decoder is JsonDecoder) number(decoder).finite() else decoder.decodeDouble().finite()
}

// A number is taken however large it is written. Anything that is no number at all stays an error.
private fun number(decoder: JsonDecoder): Double {
    val element = decoder.decodeJsonElement()
    return (element as? JsonPrimitive)?.takeIf { it !is JsonNull && !it.isString }?.content?.toDoubleOrNull()
        ?: throw SerializationException("Not a number: $element")
}
