package ch.schmidtbit.shelfmark.data.remote

import java.util.Locale

/**
 * A library catalogue reachable over SRU that answers with MARC records.
 * The catalogues differ only in their address and in how a query is spelled.
 */
class SruCatalogue(
    override val name: String,
    private val http: HttpFetcher,
    private val baseUrl: String,
    private val isbnQuery: (String) -> String,
    private val wordsQuery: (List<String>) -> String,
) : BookSource {
    /** Union catalogues are thorough but slow, and they only match whole words. */
    override val suggests = false

    override suspend fun search(query: String, limit: Int, lang: String, partial: Boolean): List<RemoteBook> {
        val words = searchWords(query)
        if (words.isEmpty()) return emptyList()
        // These catalogues do not sort by relevance, so a few more records are fetched and ranked afterwards.
        return fetch(wordsQuery(words), limit.coerceIn(5, 15), null)
    }

    override suspend fun byIsbn(isbn: String, lang: String): RemoteBook? = fetch(isbnQuery(isbn), 5, isbn).firstOrNull()

    private suspend fun fetch(query: String, max: Int, wantedIsbn: String?): List<RemoteBook> {
        val body = http.get("$baseUrl&query=${enc(query)}&maximumRecords=$max") ?: return emptyList()
        return MarcXml.parse(body, name, wantedIsbn)
    }

    companion object {
        /** K10plus: the union catalogue of most German university and state libraries. */
        fun k10plus(http: HttpFetcher) = SruCatalogue(
            name = "k10plus",
            http = http,
            baseUrl = "https://sru.k10plus.de/opac-de-627?version=1.1&operation=searchRetrieve&recordSchema=marcxml",
            isbnQuery = { "pica.isb=$it" },
            // Each word has to be in the title or be a person's name. Searching all fields
            // would also match notes and subjects and bury the book under books about it.
            wordsQuery = { words -> words.joinToString(" and ") { "(pica.tit=$it or pica.per=$it)" } },
        )

        /** swisscovery: the shared catalogue of Swiss academic libraries. */
        fun swisscovery(http: HttpFetcher) = SruCatalogue(
            name = "swisscovery",
            http = http,
            baseUrl = "https://swisscovery.slsp.ch/view/sru/41SLSP_NETWORK?version=1.2&operation=searchRetrieve&recordSchema=marcxml",
            isbnQuery = { "alma.isbn=$it" },
            wordsQuery = { words -> words.joinToString(" and ") { "(alma.title=$it or alma.creator=$it)" } + " and alma.mms_material_type=BK" },
        )

        /** The German National Library, which receives a copy of everything published in German. */
        fun dnb(http: HttpFetcher) = SruCatalogue(
            name = "dnb",
            http = http,
            baseUrl = "https://services.dnb.de/sru/dnb?version=1.1&operation=searchRetrieve&recordSchema=MARC21-xml",
            isbnQuery = { "num=$it" },
            wordsQuery = { words -> words.joinToString(" and ") { "(tit=$it or per=$it)" } + " and mat=books" },
        )
    }
}

/** Splits what the user typed into plain words, dropping everything a query language could trip over. */
internal fun searchWords(query: String): List<String> =
    query.map { if (it.isLetterOrDigit()) it else ' ' }.joinToString("").split(' ').filter { it.isNotBlank() }

/** lobid: the catalogue of the libraries of North Rhine-Westphalia as open data, strong on German titles. */
class LobidApi(private val http: HttpFetcher) : BookSource {
    override val name = "lobid"

    override suspend fun search(query: String, limit: Int, lang: String, partial: Boolean): List<RemoteBook> {
        val words = searchWords(query)
        if (words.isEmpty()) return emptyList()
        val typing = partial && !query.endsWith(' ') && words.last().length >= 2
        val q = (if (typing) words.dropLast(1) + (words.last() + "*") else words).joinToString(" AND ")
        return fetch("q=${enc(q)}&filter=${enc("type:Book")}&size=${limit.coerceAtMost(12)}")
    }

    override suspend fun byIsbn(isbn: String, lang: String): RemoteBook? =
        fetch("q=${enc("isbn:$isbn")}&size=3").let { found -> found.firstOrNull { it.isbn == isbn } ?: found.firstOrNull() }

    private suspend fun fetch(params: String): List<RemoteBook> =
        parse(http.get("https://lobid.org/resources/search?$params&format=json") ?: return emptyList())

    internal fun parse(body: String, wantedIsbn: String? = null): List<RemoteBook> {
        val members = parseObject(body)?.array("member") ?: return emptyList()
        return members.mapNotNull { element ->
            val m = element.asObject() ?: return@mapNotNull null
            val title = MarcXml.cleanTitle(m.string("title").orEmpty())
            if (title.isBlank()) return@mapNotNull null
            val publication = m.array("publication")?.firstOrNull().asObject()
            val isbns = m.strings("isbn").mapNotNull { ch.schmidtbit.shelfmark.util.Isbn.to13(it) }
            val creators = m.array("contribution").orEmpty().mapNotNull { it.asObject() }
                .filter { c -> c["role"].asObject()?.string("id").orEmpty().let { it.endsWith("/aut") || it.endsWith("/cre") || it.isEmpty() } }
                .mapNotNull { it["agent"].asObject()?.string("label") }
                .map(MarcXml::personName)
            val medium = m.array("medium").orEmpty().mapNotNull { it.asObject()?.string("label") }.joinToString(" ")
            RemoteBook(
                title = title,
                subtitle = m.strings("otherTitleInformation").firstOrNull().orEmpty(),
                authors = creators.distinct(),
                isbn = isbns.firstOrNull { it == wantedIsbn } ?: isbns.firstOrNull().orEmpty(),
                publisher = publication?.strings("publishedBy")?.firstOrNull().orEmpty(),
                year = extractYear(publication?.string("startDate").orEmpty()),
                pageCount = Regex("""(\d{1,5})\s*(S\.|Seiten|p\.|pages)""").find(m.string("extent").orEmpty())?.groupValues?.get(1)?.toIntOrNull() ?: 0,
                language = m.array("language")?.firstOrNull().asObject()?.string("id")?.substringAfterLast('/').orEmpty(),
                format = when {
                    medium.contains("Audio", ignoreCase = true) -> ch.schmidtbit.shelfmark.data.model.BookFormat.AUDIOBOOK
                    medium.contains("Online", ignoreCase = true) -> ch.schmidtbit.shelfmark.data.model.BookFormat.EBOOK
                    else -> ch.schmidtbit.shelfmark.data.model.BookFormat.UNKNOWN
                },
                source = name,
            )
        }
    }
}

/**
 * Apple Books through the public iTunes search. It knows no page counts or print ISBNs,
 * but it has blurbs and large cover pictures for most books that are on sale.
 */
class ITunesApi(private val http: HttpFetcher, private val country: () -> String = { Locale.getDefault().country }) : BookSource {
    override val name = "applebooks"

    override suspend fun search(query: String, limit: Int, lang: String, partial: Boolean): List<RemoteBook> {
        val words = searchWords(query)
        if (words.isEmpty()) return emptyList()
        return parse(http.get("$BASE/search?term=${enc(words.joinToString(" "))}&media=ebook&limit=${limit.coerceAtMost(15)}${store()}") ?: return emptyList())
    }

    override suspend fun byIsbn(isbn: String, lang: String): RemoteBook? =
        http.get("$BASE/lookup?isbn=$isbn${store()}")?.let(::parse)?.firstOrNull()?.copy(isbn = isbn)

    private fun store(): String = country().lowercase().takeIf { it.length == 2 && it.all(Char::isLetter) }?.let { "&country=$it" }.orEmpty()

    internal fun parse(body: String): List<RemoteBook> {
        val results = parseObject(body)?.array("results") ?: return emptyList()
        return results.mapNotNull { element ->
            val r = element.asObject() ?: return@mapNotNull null
            val title = r.string("trackName").orEmpty()
            if (title.isBlank()) return@mapNotNull null
            RemoteBook(
                title = title,
                authors = r.string("artistName").orEmpty().split(" & ", ", ").map { it.trim() }.filter { it.isNotEmpty() },
                year = extractYear(r.string("releaseDate").orEmpty().take(4)),
                description = stripHtml(r.string("description").orEmpty()),
                // The address carries the picture size, so a larger one is only a matter of asking.
                coverUrl = r.string("artworkUrl100").orEmpty().replace("100x100bb", "600x600bb"),
                source = name,
            )
        }
    }

    private companion object {
        const val BASE = "https://itunes.apple.com"
    }
}
