package ch.schmidtbit.shelfmark.data.repo

import androidx.room.withTransaction
import ch.schmidtbit.shelfmark.data.db.AppDatabase
import ch.schmidtbit.shelfmark.data.model.Friend
import ch.schmidtbit.shelfmark.data.model.FriendBook
import ch.schmidtbit.shelfmark.data.model.FriendWithCount
import ch.schmidtbit.shelfmark.data.model.LendRequest
import ch.schmidtbit.shelfmark.data.model.LendStatus
import ch.schmidtbit.shelfmark.data.model.Ownership
import ch.schmidtbit.shelfmark.data.share.Envelope
import ch.schmidtbit.shelfmark.data.share.LendAnswerMsg
import ch.schmidtbit.shelfmark.data.share.LendRequestMsg
import ch.schmidtbit.shelfmark.data.share.ShareCodec
import ch.schmidtbit.shelfmark.util.Dates
import kotlinx.coroutines.flow.Flow
import java.util.UUID

/** What happened when a Shelfmark file was opened. */
sealed interface ImportResult {
    data class LibraryImported(val friendId: String, val name: String, val bookCount: Int) : ImportResult
    data class RequestReceived(val requestId: String, val fromName: String, val bookTitle: String) : ImportResult
    data class AnswerReceived(val accepted: Boolean, val fromName: String, val bookTitle: String) : ImportResult
    data class BackupFound(val envelope: Envelope) : ImportResult
    data class Rejected(val reason: RejectReason) : ImportResult
}

enum class RejectReason { NOT_SHELFMARK, OWN_LIBRARY, NOT_FOR_ME, UNKNOWN_REQUEST, NEWER_VERSION }

/** Friends' shared libraries and the borrow requests going back and forth. */
class SocialRepository(private val db: AppDatabase, private val settings: SettingsRepository) {
    val friends: Flow<List<FriendWithCount>> = db.social().observeFriends()
    val requests: Flow<List<LendRequest>> = db.social().observeRequests()
    val pendingIncoming: Flow<Int> = db.social().observePendingIncoming()

    fun friend(id: String): Flow<Friend?> = db.social().observeFriend(id)
    fun friendBooks(id: String): Flow<List<FriendBook>> = db.social().observeFriendBooks(id)
    suspend fun getFriendBook(localId: Long): FriendBook? = db.social().getFriendBook(localId)

    /** Snapshot of my library for friends. */
    suspend fun exportLibrary(includeStatus: Boolean, includeRatings: Boolean): Envelope {
        val userId = settings.ensureUserId()
        val name = settings.current().profileName
        val library = ShareCodec.buildLibrary(
            ownerId = userId,
            ownerName = name,
            books = db.books().all(),
            shelves = db.shelves().all(),
            links = db.shelves().allLinks(),
            includeStatus = includeStatus,
            includeRatings = includeRatings,
        )
        return Envelope(type = Envelope.TYPE_LIBRARY, library = library)
    }

    suspend fun import(text: String): ImportResult {
        val envelope = ShareCodec.decode(text) ?: return ImportResult.Rejected(RejectReason.NOT_SHELFMARK)
        return import(envelope)
    }

    suspend fun import(envelope: Envelope): ImportResult {
        if (envelope.v > Envelope.VERSION) return ImportResult.Rejected(RejectReason.NEWER_VERSION)
        val me = settings.ensureUserId()
        envelope.library?.let { library ->
            if (library.ownerId == me) return ImportResult.Rejected(RejectReason.OWN_LIBRARY)
            val friend = ShareCodec.toFriend(library)
            val books = ShareCodec.toFriendBooks(library)
            db.withTransaction {
                // Replacing the friend row cascades to the old snapshot of their books.
                // Whether the friend is connected through the server is not part of a library and stays.
                val before = db.social().getFriend(friend.id)
                db.social().upsertFriend(friend.copy(online = before?.online ?: false, serverAt = before?.serverAt ?: 0))
                db.social().clearFriendBooks(friend.id)
                db.social().insertFriendBooks(books)
            }
            return ImportResult.LibraryImported(friend.id, friend.name, books.size)
        }
        envelope.request?.let { msg ->
            if (msg.toId != me) return ImportResult.Rejected(RejectReason.NOT_FOR_ME)
            // Opening the same file twice must not reset an answer that was already given.
            if (db.social().getRequest(msg.requestId) == null) {
                db.social().upsertRequest(
                    LendRequest(
                        id = msg.requestId,
                        incoming = true,
                        bookRemoteId = msg.bookId,
                        bookTitle = msg.bookTitle,
                        bookAuthors = msg.bookAuthors,
                        isbn = msg.isbn,
                        peerId = msg.fromId,
                        peerName = msg.fromName,
                        note = msg.note,
                        createdAt = msg.createdAt,
                    ),
                )
            }
            return ImportResult.RequestReceived(msg.requestId, msg.fromName, msg.bookTitle)
        }
        envelope.answer?.let { msg ->
            val request = db.social().getRequest(msg.requestId)?.takeIf { !it.incoming }
                ?: return ImportResult.Rejected(RejectReason.UNKNOWN_REQUEST)
            db.social().upsertRequest(
                request.copy(
                    status = if (msg.accepted) LendStatus.ACCEPTED else LendStatus.DECLINED,
                    answeredAt = msg.answeredAt,
                ),
            )
            return ImportResult.AnswerReceived(msg.accepted, msg.fromName, request.bookTitle)
        }
        if (envelope.backup != null) return ImportResult.BackupFound(envelope)
        return ImportResult.Rejected(RejectReason.NOT_SHELFMARK)
    }

    /** Records an outgoing request and returns the file content to send to the owner. */
    suspend fun createRequest(book: FriendBook, note: String): Envelope {
        val me = settings.ensureUserId()
        val friend = db.social().getFriend(book.friendId)
        val now = System.currentTimeMillis()
        val request = LendRequest(
            id = UUID.randomUUID().toString(),
            incoming = false,
            bookRemoteId = book.remoteId,
            bookTitle = book.title,
            bookAuthors = book.authors,
            isbn = book.isbn,
            peerId = book.friendId,
            peerName = friend?.name.orEmpty(),
            note = note.trim(),
            createdAt = now,
        )
        db.social().upsertRequest(request)
        return Envelope(type = Envelope.TYPE_REQUEST, request = requestMessage(request, me))
    }

    /** Rebuilds the file for a request that was created earlier, e.g. to send it again. */
    suspend fun requestEnvelope(requestId: String): Envelope? {
        val request = db.social().getRequest(requestId)?.takeIf { !it.incoming } ?: return null
        return Envelope(type = Envelope.TYPE_REQUEST, request = requestMessage(request, settings.ensureUserId()))
    }

    /**
     * Answers a friend's request with yes or no. Saying yes also marks my copy as lent out.
     * Returns the file content to send back, or null if the request does not exist.
     */
    suspend fun answerRequest(requestId: String, accept: Boolean): Envelope? {
        val request = db.social().getRequest(requestId)?.takeIf { it.incoming } ?: return null
        val now = System.currentTimeMillis()
        val me = settings.ensureUserId()
        db.withTransaction {
            db.social().upsertRequest(
                request.copy(status = if (accept) LendStatus.ACCEPTED else LendStatus.DECLINED, answeredAt = now),
            )
            if (accept) {
                val book = db.books().get(request.bookRemoteId)
                if (book != null && book.ownership == Ownership.OWNED && book.lentTo.isBlank()) {
                    db.books().update(book.copy(lentTo = request.peerName, lentSince = Dates.today(), updatedAt = now))
                }
            }
        }
        return Envelope(
            type = Envelope.TYPE_ANSWER,
            answer = LendAnswerMsg(
                requestId = request.id,
                accepted = accept,
                bookTitle = request.bookTitle,
                fromId = me,
                fromName = settings.current().profileName,
                toId = request.peerId,
                answeredAt = now,
            ),
        )
    }

    suspend fun deleteFriend(id: String) = db.social().deleteFriend(id)
    suspend fun getFriend(id: String): Friend? = db.social().getFriend(id)
    suspend fun getRequest(id: String): LendRequest? = db.social().getRequest(id)
    suspend fun deleteRequest(id: String) = db.social().deleteRequest(id)

    private suspend fun requestMessage(request: LendRequest, me: String) = LendRequestMsg(
        requestId = request.id,
        bookId = request.bookRemoteId,
        bookTitle = request.bookTitle,
        bookAuthors = request.bookAuthors,
        isbn = request.isbn,
        fromId = me,
        fromName = settings.current().profileName,
        toId = request.peerId,
        note = request.note,
        createdAt = request.createdAt,
    )
}
