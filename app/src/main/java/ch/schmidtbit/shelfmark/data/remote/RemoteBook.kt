package ch.schmidtbit.shelfmark.data.remote

import ch.schmidtbit.shelfmark.data.model.Book
import ch.schmidtbit.shelfmark.data.model.BookFormat

/** A book as an online catalogue describes it, before it becomes part of the library. */
data class RemoteBook(
    val title: String,
    val subtitle: String = "",
    val authors: List<String> = emptyList(),
    val isbn: String = "",
    val publisher: String = "",
    val year: String = "",
    val pageCount: Int = 0,
    val description: String = "",
    val coverUrl: String = "",
    val language: String = "",
    val format: BookFormat = BookFormat.UNKNOWN,
    val source: String = "",
) {
    val authorLine: String get() = authors.joinToString(", ")

    fun toBook(): Book = Book(
        title = title,
        subtitle = subtitle,
        authors = authorLine,
        isbn = isbn,
        publisher = publisher,
        publishedYear = year,
        language = language,
        pageCount = pageCount,
        format = format,
        description = description,
        coverUrl = coverUrl,
    )

    /** Fills every blank field of this record with the value from [other]. */
    fun fillFrom(other: RemoteBook): RemoteBook = copy(
        title = title.ifBlank { other.title },
        subtitle = subtitle.ifBlank { other.subtitle },
        authors = authors.ifEmpty { other.authors },
        isbn = isbn.ifBlank { other.isbn },
        publisher = publisher.ifBlank { other.publisher },
        year = year.ifBlank { other.year },
        pageCount = if (pageCount > 0) pageCount else other.pageCount,
        description = description.ifBlank { other.description },
        coverUrl = coverUrl.ifBlank { other.coverUrl },
        language = language.ifBlank { other.language },
        format = if (format != BookFormat.UNKNOWN) format else other.format,
    )

    companion object {
        fun normalise(text: String): String = text.lowercase().filter { it.isLetterOrDigit() }
    }
}

internal val YEAR_REGEX = Regex("""\b(1[0-9]{3}|20[0-9]{2})\b""")

internal fun extractYear(text: String): String = YEAR_REGEX.find(text)?.value.orEmpty()

/** Maps the free text binding descriptions catalogues use (English and German) to a format. */
internal fun parseFormat(text: String): BookFormat {
    val t = text.lowercase()
    return when {
        t.isBlank() -> BookFormat.UNKNOWN
        listOf("audio", "hörbuch", "hoerbuch", " cd", "mp3").any { it in t } -> BookFormat.AUDIOBOOK
        listOf("ebook", "e-book", "kindle", "epub", "electronic", "digital").any { it in t } -> BookFormat.EBOOK
        listOf("hardcover", "hardback", "gebunden", "leinen", "hard cover", "library binding", "pappband", "fester einband").any { it in t } -> BookFormat.HARDCOVER
        listOf("paperback", "taschenbuch", "softcover", "broschiert", "kartoniert", "mass market", "pocket", "trade paper", "broschur").any { it in t } -> BookFormat.PAPERBACK
        else -> BookFormat.UNKNOWN
    }
}

/** Blurbs sometimes arrive as HTML. Keeps the paragraphs, drops the markup. */
internal fun stripHtml(text: String): String {
    if ('<' !in text && '&' !in text) return text.trim()
    return text
        .replace(Regex("(?i)<br\\s*/?>"), "\n")
        .replace(Regex("(?i)</p>"), "\n\n")
        .replace(Regex("<[^>]+>"), "")
        .replace("&nbsp;", " ")
        .replace("&amp;", "&")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&apos;", "'")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace(Regex("\n{3,}"), "\n\n")
        .trim()
}
