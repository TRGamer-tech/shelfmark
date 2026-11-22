package ch.schmidtbit.shelfmark.data.share

import ch.schmidtbit.shelfmark.data.model.Book
import ch.schmidtbit.shelfmark.data.model.BookFormat
import ch.schmidtbit.shelfmark.data.model.BookShelf
import ch.schmidtbit.shelfmark.data.model.Friend
import ch.schmidtbit.shelfmark.data.model.FriendBook
import ch.schmidtbit.shelfmark.data.model.Ownership
import ch.schmidtbit.shelfmark.data.model.Quote
import ch.schmidtbit.shelfmark.data.model.ReadingStatus
import ch.schmidtbit.shelfmark.data.model.Shelf
import kotlinx.serialization.EncodeDefault
import kotlinx.serialization.ExperimentalSerializationApi
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

/**
 * Everything Shelfmark users exchange travels as one small JSON file with this wrapper:
 * a library snapshot, a request to borrow a book, or the answer to such a request.
 * The files go through whatever messenger the friends already use, so no server is involved.
 */
@OptIn(ExperimentalSerializationApi::class)
@Serializable
data class Envelope(
    @EncodeDefault val app: String = APP,
    @EncodeDefault val v: Int = VERSION,
    val type: String,
    val library: SharedLibrary? = null,
    val request: LendRequestMsg? = null,
    val answer: LendAnswerMsg? = null,
    val backup: BackupPayload? = null,
) {
    companion object {
        const val APP = "shelfmark"
        const val VERSION = 1
        const val TYPE_LIBRARY = "library"
        const val TYPE_REQUEST = "lend_request"
        const val TYPE_ANSWER = "lend_answer"
        const val TYPE_BACKUP = "backup"
    }
}

@Serializable
data class SharedLibrary(
    val ownerId: String,
    val ownerName: String,
    val createdAt: Long,
    /** False when the owner only shares who owns what. */
    val includesStatus: Boolean,
    val includesRatings: Boolean,
    val books: List<SharedBook>,
)

@Serializable
data class SharedBook(
    val id: Long,
    val title: String,
    val authors: String = "",
    val isbn: String = "",
    val coverUrl: String = "",
    val pages: Int = 0,
    val format: BookFormat = BookFormat.UNKNOWN,
    val description: String = "",
    val ownership: Ownership = Ownership.OWNED,
    /** True when the owner would lend it and it is not out on loan. */
    val available: Boolean = false,
    val status: ReadingStatus? = null,
    val shelves: List<String> = emptyList(),
    val rating: Float = 0f,
    val spice: Int = 0,
    val review: String = "",
    val startedOn: Long? = null,
    val finishedOn: Long? = null,
)

@Serializable
data class LendRequestMsg(
    val requestId: String,
    val bookId: Long,
    val bookTitle: String,
    val bookAuthors: String = "",
    val isbn: String = "",
    val fromId: String,
    val fromName: String,
    val toId: String,
    val note: String = "",
    val createdAt: Long,
)

@Serializable
data class LendAnswerMsg(
    val requestId: String,
    val accepted: Boolean,
    val bookTitle: String,
    /** The owner who answered. */
    val fromId: String,
    val fromName: String,
    /** The friend who asked. */
    val toId: String,
    val answeredAt: Long,
)

/** Full export of the user's own data, used by backup and restore. */
@Serializable
data class BackupPayload(
    val exportedAt: Long,
    val books: List<Book>,
    val shelves: List<Shelf>,
    val links: List<BookShelf>,
    val quotes: List<Quote>,
)

object ShareCodec {
    private val json = Json {
        ignoreUnknownKeys = true
        encodeDefaults = false
        explicitNulls = false
    }

    fun encode(envelope: Envelope): String = json.encodeToString(Envelope.serializer(), envelope.copy(app = Envelope.APP))

    /** Returns null for anything that is not a Shelfmark file. */
    fun decode(text: String): Envelope? {
        val trimmed = text.trim().removePrefix("﻿")
        if (!trimmed.startsWith("{")) return null
        return runCatching {
            val tree = json.parseToJsonElement(trimmed) as JsonObject
            // The marker must really be in the file, a default value does not count.
            if ((tree["app"] as? JsonPrimitive)?.content != Envelope.APP) return null
            json.decodeFromJsonElement(Envelope.serializer(), tree)
        }.getOrNull()
    }

    /** Builds the snapshot friends receive. Private details are only included when the owner opted in. */
    fun buildLibrary(
        ownerId: String,
        ownerName: String,
        books: List<Book>,
        shelves: List<Shelf>,
        links: List<BookShelf>,
        includeStatus: Boolean,
        includeRatings: Boolean,
        now: Long = System.currentTimeMillis(),
    ): SharedLibrary {
        val shelfNames = shelves.associate { it.id to it.name }
        val shelvesByBook = links.groupBy({ it.bookId }, { shelfNames[it.shelfId] }).mapValues { it.value.filterNotNull() }
        val shared = books
            // Without status sharing the snapshot is "who owns what", so the wishlist stays private.
            .filter { includeStatus || it.ownership != Ownership.NOT_OWNED }
            .map { b ->
                SharedBook(
                    id = b.id,
                    title = b.title,
                    authors = b.authors,
                    isbn = b.isbn,
                    coverUrl = b.coverUrl,
                    pages = b.pageCount,
                    format = b.format,
                    description = b.description,
                    ownership = b.ownership,
                    available = b.availableToLend,
                    status = if (includeStatus) b.status else null,
                    shelves = if (includeStatus) shelvesByBook[b.id].orEmpty() else emptyList(),
                    rating = if (includeRatings) b.rating else 0f,
                    spice = if (includeRatings) b.spice else 0,
                    review = if (includeRatings) b.review else "",
                    startedOn = if (includeRatings) b.startedOn else null,
                    finishedOn = if (includeRatings) b.finishedOn else null,
                )
            }
        return SharedLibrary(ownerId, ownerName, now, includeStatus, includeRatings, shared)
    }

    fun toFriend(library: SharedLibrary, now: Long = System.currentTimeMillis()): Friend = Friend(
        id = library.ownerId,
        name = library.ownerName.ifBlank { "?" },
        sharedAt = library.createdAt,
        importedAt = now,
        includesStatus = library.includesStatus,
        includesRatings = library.includesRatings,
    )

    fun toFriendBooks(library: SharedLibrary): List<FriendBook> = library.books.map { b ->
        FriendBook(
            friendId = library.ownerId,
            remoteId = b.id,
            title = b.title,
            authors = b.authors,
            isbn = b.isbn,
            coverUrl = b.coverUrl,
            pageCount = b.pages,
            format = b.format,
            description = b.description,
            status = b.status,
            ownership = b.ownership,
            available = b.available,
            rating = b.rating,
            spice = b.spice,
            review = b.review,
            startedOn = b.startedOn,
            finishedOn = b.finishedOn,
            shelves = b.shelves.joinToString("\n"),
        )
    }
}
