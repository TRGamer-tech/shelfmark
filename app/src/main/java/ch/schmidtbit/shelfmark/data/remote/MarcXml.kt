package ch.schmidtbit.shelfmark.data.remote

import ch.schmidtbit.shelfmark.data.model.BookFormat
import ch.schmidtbit.shelfmark.util.Isbn
import org.w3c.dom.Element
import org.w3c.dom.Node
import java.io.StringReader
import javax.xml.parsers.DocumentBuilderFactory

/**
 * Reads MARC 21 records out of an SRU response, the format library catalogues answer in.
 * Works for any catalogue: element prefixes and attribute order do not matter.
 */
internal object MarcXml {
    private val PAGES = Regex("""(\d{1,5})\s*(S\.|Seiten|Seite|p\.|pages|pp\.|Bl\.|S$)""")
    private val FIRST_NUMBER = Regex("""\d{2,5}""")

    fun parse(xml: String, source: String, wantedIsbn: String? = null): List<RemoteBook> {
        val document = runCatching {
            val factory = DocumentBuilderFactory.newInstance()
            // Catalogue answers never need a DOCTYPE, refusing them keeps external entities out.
            runCatching { factory.setFeature("http://apache.org/xml/features/disallow-doctype-decl", true) }
            factory.isExpandEntityReferences = false
            factory.newDocumentBuilder().parse(org.xml.sax.InputSource(StringReader(xml)))
        }.getOrNull() ?: return emptyList()

        val all = document.getElementsByTagName("*")
        val records = (0 until all.length).map { all.item(it) as Element }
            .filter { it.local() == "record" && it.children().any { child -> child.local() == "datafield" } }
        val books = records.mapNotNull { toBook(it, source, wantedIsbn) }
        // A search by ISBN can also return other editions that merely mention the number.
        return if (wantedIsbn == null) books else books.sortedByDescending { it.isbn == wantedIsbn }
    }

    private fun toBook(record: Element, source: String, wantedIsbn: String?): RemoteBook? {
        val leader = record.children().firstOrNull { it.local() == "leader" }?.textContent.orEmpty()
        // Position 6 is the kind of material: a and t are text, i is a spoken recording.
        val kind = leader.getOrNull(6) ?: 'a'
        if (kind != 'a' && kind != 't' && kind != 'i') return null
        val fields = record.children().filter { it.local() == "datafield" }
        fun field(tag: String) = fields.firstOrNull { it.getAttribute("tag") == tag }
        fun all(tag: String) = fields.filter { it.getAttribute("tag") == tag }
        fun Element.sub(code: Char): String = subs(code).firstOrNull().orEmpty()

        val titleField = field("245") ?: return null
        val title = cleanTitle(titleField.sub('a'))
        if (title.isBlank()) return null

        val isbns = all("020").flatMap { it.subs('a') + it.subs('9') }.mapNotNull { Isbn.to13(it.substringBefore(' ')) }
        val binding = all("020").flatMap { it.subs('q') + it.subs('c') }.joinToString(" ")
        val carrier = all("338").joinToString(" ") { it.sub('b') + " " + it.sub('a') }
        val imprint = fields.firstOrNull { it.getAttribute("tag") == "264" && it.getAttribute("ind2") == "1" } ?: field("264") ?: field("260")
        val control008 = record.children().firstOrNull { it.local() == "controlfield" && it.getAttribute("tag") == "008" }?.textContent.orEmpty()
        val extent = field("300")?.sub('a').orEmpty()

        val creators = buildList {
            field("100")?.sub('a')?.let(::add)
            all("700").filter { f -> f.subs('4').any { it == "aut" || it == "cre" } }.forEach { add(it.sub('a')) }
        }.map(::personName).filter { it.isNotBlank() }.distinct()

        return RemoteBook(
            title = title,
            subtitle = cleanTitle(titleField.sub('b')),
            authors = creators,
            isbn = isbns.firstOrNull { it == wantedIsbn } ?: isbns.firstOrNull().orEmpty(),
            publisher = imprint?.sub('b').orEmpty().trim().trimEnd(',', ';', ':').trim(),
            year = extractYear(imprint?.sub('c').orEmpty()).ifBlank { extractYear(control008.drop(7).take(4)) },
            pageCount = (PAGES.find(extent)?.groupValues?.get(1) ?: FIRST_NUMBER.find(extent)?.value)?.toIntOrNull() ?: 0,
            description = field("520")?.sub('a').orEmpty().trim(),
            language = field("041")?.sub('a').orEmpty().ifBlank { control008.drop(35).take(3).trim().takeIf { it.length == 3 && it.all(Char::isLetter) }.orEmpty() },
            format = when {
                kind == 'i' -> BookFormat.AUDIOBOOK
                carrier.contains("cr") || carrier.contains("Online", ignoreCase = true) -> BookFormat.EBOOK
                else -> parseFormat(binding)
            },
            source = source,
        )
    }

    /** "Schlink, Bernhard" as catalogues file it becomes "Bernhard Schlink". */
    internal fun personName(filed: String): String {
        val name = filed.trim().trimEnd(',', '.').trim()
        val parts = name.split(',', limit = 2)
        return if (parts.size == 2) (parts[1].trim() + " " + parts[0].trim()).trim() else name
    }

    /** Drops the marks around a leading article and the punctuation MARC puts before the next subfield. */
    internal fun cleanTitle(raw: String): String = raw
        .replace("<<", "").replace(">>", "")
        .replace("\u0098", "").replace("\u009C", "").replace("¬", "")
        .trim().trimEnd('/', ':', ';', '=').trim()

    private fun Element.local(): String = (localName ?: nodeName).substringAfter(':')

    private fun Element.children(): List<Element> {
        val out = ArrayList<Element>()
        var node = firstChild
        while (node != null) {
            if (node.nodeType == Node.ELEMENT_NODE) out += node as Element
            node = node.nextSibling
        }
        return out
    }

    private fun Element.subs(code: Char): List<String> =
        children().filter { it.local() == "subfield" && it.getAttribute("code") == code.toString() }.map { it.textContent.trim() }
}
