package ch.schmidtbit.shelfmark.util

/** ISBN-10 / ISBN-13 helpers. All functions accept input with hyphens or spaces. */
object Isbn {
    fun clean(raw: String): String = raw.uppercase().filter { it.isDigit() || it == 'X' }

    fun isValid13(s: String): Boolean {
        if (s.length != 13 || !s.all(Char::isDigit)) return false
        return weightedSum13(s) % 10 == 0
    }

    fun isValid10(s: String): Boolean {
        if (s.length != 10) return false
        var sum = 0
        for (i in 0 until 10) {
            val c = s[i]
            val v = when {
                c.isDigit() -> c - '0'
                c == 'X' && i == 9 -> 10
                else -> return false
            }
            sum += v * (10 - i)
        }
        return sum % 11 == 0
    }

    fun isValid(raw: String): Boolean = clean(raw).let { isValid13(it) || isValid10(it) }

    /** True for the "Bookland" EAN-13 codes printed on books (prefix 978 or 979). */
    fun isBookEan(raw: String): Boolean = clean(raw).let { isValid13(it) && (it.startsWith("978") || it.startsWith("979")) }

    /** Normalises any valid ISBN to its 13 digit form, or returns null if the input is not an ISBN. */
    fun to13(raw: String): String? {
        val s = clean(raw)
        if (isValid13(s)) return s
        if (!isValid10(s)) return null
        val body = "978" + s.substring(0, 9)
        val check = (10 - weightedSum13(body) % 10) % 10
        return body + check
    }

    private fun weightedSum13(s: String): Int =
        s.foldIndexed(0) { i, acc, c -> acc + (c - '0') * if (i % 2 == 0) 1 else 3 }
}
