package ch.schmidtbit.shelfmark.util

/** Turns the lines a text recogniser found on a book page back into running text. */
object OcrText {
    /**
     * Joins lines with spaces and mends words that were hyphenated at a line break:
     * "Geschich-" + "te" becomes "Geschichte". A hyphen before a capital letter is kept,
     * since that is usually a real compound ("Nord-" + "Amerika").
     */
    fun join(lines: List<String>): String {
        val out = StringBuilder()
        lines.map { it.trim() }.filter { it.isNotEmpty() }.forEach { line ->
            when {
                out.isEmpty() -> out.append(line)
                out.endsWith("-") && line.first().isLowerCase() && out.length >= 2 && out[out.length - 2].isLetter() -> {
                    out.setLength(out.length - 1)
                    out.append(line)
                }
                else -> out.append(' ').append(line)
            }
        }
        return out.toString()
    }
}
