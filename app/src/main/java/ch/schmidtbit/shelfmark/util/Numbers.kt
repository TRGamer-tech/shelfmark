package ch.schmidtbit.shelfmark.util

/**
 * Decimal numbers that come from outside: typed into a field, or read from somebody's
 * file. Kotlin reads "1e39" as infinity and "NaN" as a number that is none, and neither
 * can be written into a library document, so they are stopped here.
 */
object Numbers {
    /** The highest position in a series anybody needs. */
    const val MAX_SERIES = 9999f

    private val PLAIN = Regex("""\d{1,9}(\.\d{0,6})?|\.\d{1,6}""")

    /** What a field for a decimal number may hold while somebody is typing: digits and one comma or point. */
    private val TYPING = Regex("""\d{0,9}([.,]\d{0,6})?""")

    /**
     * A number written the plain way, with digits and at most one comma or point. Null
     * for everything else: an empty text, a sign, an exponent, a word.
     */
    fun decimal(text: String): Double? {
        val plain = text.trim().replace(',', '.')
        if (!PLAIN.matches(plain)) return null
        return plain.toDoubleOrNull()?.takeIf { it.isFinite() }
    }

    /** The position in a series that [text] gives, or 0 for "not set" when it gives none that makes sense. */
    fun seriesPosition(text: String): Float = decimal(text)?.toFloat()?.takeIf { it in 0f..MAX_SERIES } ?: 0f

    /** Whether [text] can still become a plain number, so that a field can refuse the key that would spoil it. */
    fun typable(text: String): Boolean = TYPING.matches(text)
}

/** This number, or 0 when it is infinite or not a number at all. */
fun Float.finite(): Float = if (isFinite()) this else 0f

/** This number, or 0 when it is infinite or not a number at all. */
fun Double.finite(): Double = if (isFinite()) this else 0.0
