package ch.schmidtbit.shelfmark.data.remote

import ch.schmidtbit.shelfmark.util.Isbn

/**
 * Client for the Google Books volumes API. It works without a key, but the keyless
 * quota is shared and often exhausted, so an optional personal key can be supplied.
 */
class GoogleBooksApi(private val http: HttpFetcher, private val apiKey: suspend () -> String = { "" }) : BookSource {
    override val name = "googlebooks"

    override suspend fun search(query: String, limit: Int, lang: String, partial: Boolean): List<RemoteBook> =
        parseVolumes(http.get(url("q=${enc(query)}&maxResults=${limit.coerceIn(1, 40)}&printType=books")) ?: return emptyList())

    override suspend fun byIsbn(isbn: String, lang: String): RemoteBook? =
        http.get(url("q=isbn:$isbn&maxResults=1"))?.let { parseVolumes(it) }?.firstOrNull()?.let {
            if (it.isbn.isBlank()) it.copy(isbn = isbn) else it
        }

    private suspend fun url(params: String): String {
        val key = apiKey().trim()
        return "$BASE/volumes?$params" + if (key.isNotEmpty()) "&key=${enc(key)}" else ""
    }

    internal fun parseVolumes(body: String): List<RemoteBook> {
        val items = parseObject(body)?.array("items") ?: return emptyList()
        return items.mapNotNull { element ->
            val info = element.asObject()?.get("volumeInfo").asObject() ?: return@mapNotNull null
            val title = info.string("title").orEmpty()
            if (title.isBlank()) return@mapNotNull null
            val identifiers = info.array("industryIdentifiers").orEmpty().mapNotNull { it.asObject() }
            val isbn13 = identifiers.firstOrNull { it.string("type") == "ISBN_13" }?.string("identifier")
            val isbn10 = identifiers.firstOrNull { it.string("type") == "ISBN_10" }?.string("identifier")
            val images = info["imageLinks"].asObject()
            RemoteBook(
                title = title,
                subtitle = info.string("subtitle").orEmpty(),
                authors = info.strings("authors"),
                isbn = (isbn13 ?: isbn10)?.let { Isbn.to13(it) }.orEmpty(),
                publisher = info.string("publisher").orEmpty(),
                year = extractYear(info.string("publishedDate").orEmpty()),
                pageCount = info.int("pageCount") ?: 0,
                description = stripHtml(info.string("description").orEmpty()),
                coverUrl = (images?.string("thumbnail") ?: images?.string("smallThumbnail")).orEmpty()
                    .replace("http://", "https://")
                    .replace("&edge=curl", ""),
                language = info.string("language").orEmpty(),
                source = name,
            )
        }
    }

    private companion object {
        const val BASE = "https://www.googleapis.com/books/v1"
    }
}
