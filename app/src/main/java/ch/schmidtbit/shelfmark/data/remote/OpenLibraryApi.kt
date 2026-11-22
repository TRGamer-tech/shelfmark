package ch.schmidtbit.shelfmark.data.remote

import ch.schmidtbit.shelfmark.util.Isbn
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonObject

/** Client for openlibrary.org, a free catalogue that needs no key. */
class OpenLibraryApi(private val http: HttpFetcher) : BookSource {
    override val name = "openlibrary"

    override suspend fun search(query: String, limit: Int, lang: String, partial: Boolean): List<RemoteBook> {
        val q = buildQuery(query, partial)
        if (q.isEmpty()) return emptyList()
        val url = "$BASE/search.json?q=${enc(q)}&limit=$limit&lang=${enc(lang)}&fields=$SEARCH_FIELDS"
        return parseSearch(http.get(url) ?: return emptyList())
    }

    /**
     * Open Library matches whole words only. While the user is typing, the last word gets a
     * trailing wildcard so "der vorl" already finds "Der Vorleser". Characters that have a
     * meaning in the search syntax are dropped.
     */
    internal fun buildQuery(query: String, partial: Boolean): String {
        val words = query.map { if (it.isLetterOrDigit() || it == '\'' ) it else ' ' }.joinToString("")
            .split(' ').filter { it.isNotBlank() }
        if (words.isEmpty()) return ""
        val typing = partial && !query.endsWith(' ') && words.last().length >= 2
        return if (typing) (words.dropLast(1) + (words.last() + "*")).joinToString(" ") else words.joinToString(" ")
    }

    override suspend fun byIsbn(isbn: String, lang: String): RemoteBook? = coroutineScope {
        // Two views of the same edition: "data" has author names and cover links,
        // the raw edition record has binding, language and the link to the work.
        val dataCall = async { http.get("$BASE/api/books?bibkeys=ISBN:$isbn&format=json&jscmd=data") }
        val editionCall = async { runCatching { http.get("$BASE/isbn/$isbn.json") }.getOrNull() }
        val fromData = dataCall.await()?.let { parseData(it, isbn) }
        val edition = editionCall.await()?.let { parseObject(it) }
        val fromEdition = edition?.let { parseEdition(it, isbn) }
        var book = when {
            fromData != null && fromEdition != null -> fromData.fillFrom(fromEdition)
            else -> fromData ?: fromEdition
        } ?: return@coroutineScope null
        if (book.description.isBlank()) {
            val workKey = edition?.array("works")?.firstOrNull()?.asObject()?.string("key")
            if (!workKey.isNullOrBlank()) {
                val work = runCatching { http.get("$BASE$workKey.json") }.getOrNull()?.let { parseObject(it) }
                book = book.copy(description = work?.get("description").textValue())
            }
        }
        book
    }

    internal fun parseSearch(body: String): List<RemoteBook> {
        val docs = parseObject(body)?.array("docs") ?: return emptyList()
        return docs.mapNotNull { element ->
            val work = element.asObject() ?: return@mapNotNull null
            // With "lang" set, Open Library attaches the best matching edition of each work.
            val edition = work["editions"].asObject()?.array("docs")?.firstOrNull()?.asObject()
            val title = edition?.string("title").orEmpty().ifBlank { work.string("title").orEmpty() }
            if (title.isBlank()) return@mapNotNull null
            val coverId = edition?.int("cover_i") ?: work.int("cover_i")
            RemoteBook(
                title = title,
                subtitle = edition?.string("subtitle").orEmpty().ifBlank { work.string("subtitle").orEmpty() },
                authors = work.strings("author_name"),
                isbn = pickIsbn(edition?.strings("isbn").orEmpty()),
                publisher = edition?.strings("publisher")?.firstOrNull().orEmpty(),
                year = edition?.strings("publish_date")?.firstOrNull()?.let(::extractYear).orEmpty()
                    .ifBlank { work.int("first_publish_year")?.toString().orEmpty() },
                pageCount = work.int("number_of_pages_median") ?: 0,
                coverUrl = coverId?.let { "$COVERS/b/id/$it-L.jpg" }.orEmpty(),
                language = edition?.strings("language")?.firstOrNull().orEmpty(),
                source = name,
            )
        }
    }

    internal fun parseData(body: String, isbn: String): RemoteBook? {
        val root = parseObject(body) ?: return null
        val entry = root.values.firstOrNull().asObject() ?: return null
        val title = entry.string("title").orEmpty()
        if (title.isBlank()) return null
        val cover = entry["cover"].asObject()
        return RemoteBook(
            title = title,
            subtitle = entry.string("subtitle").orEmpty(),
            authors = entry.array("authors").orEmpty().mapNotNull { it.asObject()?.string("name") },
            isbn = isbn,
            publisher = entry.array("publishers")?.firstOrNull()?.asObject()?.string("name").orEmpty(),
            year = extractYear(entry.string("publish_date").orEmpty()),
            pageCount = entry.int("number_of_pages") ?: 0,
            coverUrl = (cover?.string("large") ?: cover?.string("medium")).orEmpty(),
            source = name,
        )
    }

    internal fun parseEdition(edition: JsonObject, isbn: String): RemoteBook? {
        val title = edition.string("title").orEmpty()
        if (title.isBlank()) return null
        val coverId = edition.array("covers")?.firstOrNull()?.let { (it as? JsonPrimitive)?.intOrNull }?.takeIf { it > 0 }
        return RemoteBook(
            title = title,
            subtitle = edition.string("subtitle").orEmpty(),
            isbn = isbn,
            publisher = edition.strings("publishers").firstOrNull().orEmpty(),
            year = extractYear(edition.string("publish_date").orEmpty()),
            pageCount = edition.int("number_of_pages") ?: 0,
            description = edition["description"].textValue(),
            coverUrl = coverId?.let { "$COVERS/b/id/$it-L.jpg" }.orEmpty(),
            language = edition.array("languages")?.firstOrNull()?.asObject()?.string("key")?.substringAfterLast('/').orEmpty(),
            format = parseFormat(edition.string("physical_format").orEmpty()),
            source = name,
        )
    }

    private fun pickIsbn(candidates: List<String>): String =
        candidates.firstOrNull { Isbn.isValid13(Isbn.clean(it)) }?.let(Isbn::clean)
            ?: candidates.firstNotNullOfOrNull { Isbn.to13(it) }.orEmpty()

    private companion object {
        const val BASE = "https://openlibrary.org"
        const val COVERS = "https://covers.openlibrary.org"
        const val SEARCH_FIELDS = "key,title,subtitle,author_name,first_publish_year,cover_i,number_of_pages_median," +
            "editions,editions.key,editions.title,editions.subtitle,editions.isbn,editions.language," +
            "editions.cover_i,editions.publisher,editions.publish_date"
    }
}

internal val lenientJson = Json { ignoreUnknownKeys = true; isLenient = true }

internal fun parseObject(body: String): JsonObject? =
    runCatching { lenientJson.parseToJsonElement(body).jsonObject }.getOrNull()

internal fun JsonElement?.asObject(): JsonObject? = this as? JsonObject

internal fun JsonObject.string(key: String): String? =
    (this[key] as? JsonPrimitive)?.takeIf { it.isString }?.content

internal fun JsonObject.int(key: String): Int? = (this[key] as? JsonPrimitive)?.intOrNull

internal fun JsonObject.array(key: String): JsonArray? = this[key] as? JsonArray

internal fun JsonObject.strings(key: String): List<String> =
    array(key).orEmpty().mapNotNull { (it as? JsonPrimitive)?.takeIf { p -> p.isString }?.content }

/** Open Library stores long texts either as a plain string or as {"type": ..., "value": ...}. */
internal fun JsonElement?.textValue(): String = when (this) {
    is JsonPrimitive -> if (isString) content.trim() else ""
    is JsonObject -> string("value").orEmpty().trim()
    else -> ""
}
