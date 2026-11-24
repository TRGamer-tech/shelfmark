package ch.schmidtbit.shelfmark.data.repo

import androidx.room.withTransaction
import ch.schmidtbit.shelfmark.data.db.AppDatabase
import ch.schmidtbit.shelfmark.data.model.Friend
import ch.schmidtbit.shelfmark.data.model.FriendBook
import ch.schmidtbit.shelfmark.data.model.FriendWithCount
import ch.schmidtbit.shelfmark.data.model.Loan
import ch.schmidtbit.shelfmark.data.share.Envelope
import ch.schmidtbit.shelfmark.data.share.ShareCodec
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.map

/** What happened when a Shelfmark file was opened. */
sealed interface ImportResult {
    data class LibraryImported(val friendId: String, val name: String, val bookCount: Int) : ImportResult
    data class BackupFound(val envelope: Envelope) : ImportResult
    data class Rejected(val reason: RejectReason) : ImportResult
}

enum class RejectReason { NOT_SHELFMARK, OWN_LIBRARY, NEWER_VERSION, OLD_REQUEST }

/** Friends' shared libraries, and the loans between friends as the server last told them. */
class SocialRepository(private val db: AppDatabase, private val settings: SettingsRepository) {
    val friends: Flow<List<FriendWithCount>> = db.social().observeFriends()

    /** Every loan I am part of and have not put away, the newest question first. */
    val loans: Flow<List<Loan>> = db.social().observeLoans()

    /** How many loans wait for a tap of mine: an answer, or confirming that a book changed hands. */
    val waitingLoans: Flow<Int> = loans.map { all -> all.count { it.waitsForMe } }.distinctUntilChanged()

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
            // A book that is promised to somebody is taken, though it still stands on my shelf.
            held = db.social().loans().filter { it.lender && it.state.holdsBook }.mapTo(HashSet()) { it.bookId },
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
        if (envelope.backup != null) return ImportResult.BackupFound(envelope)
        // A borrow request or its answer, written by a version from before the loans.
        if (envelope.type in Envelope.OLD_REQUEST_TYPES) return ImportResult.Rejected(RejectReason.OLD_REQUEST)
        return ImportResult.Rejected(RejectReason.NOT_SHELFMARK)
    }

    suspend fun deleteFriend(id: String) = db.social().deleteFriend(id)
    suspend fun getFriend(id: String): Friend? = db.social().getFriend(id)
}
