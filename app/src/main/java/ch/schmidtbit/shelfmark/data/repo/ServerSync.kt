package ch.schmidtbit.shelfmark.data.repo

import androidx.room.withTransaction
import ch.schmidtbit.shelfmark.data.db.AppDatabase
import ch.schmidtbit.shelfmark.data.model.Friend
import ch.schmidtbit.shelfmark.data.model.FriendBook
import ch.schmidtbit.shelfmark.data.model.Loan
import ch.schmidtbit.shelfmark.data.model.LoanAction
import ch.schmidtbit.shelfmark.data.model.LoanNews
import ch.schmidtbit.shelfmark.data.model.LoanRules
import ch.schmidtbit.shelfmark.data.server.AuthApi
import ch.schmidtbit.shelfmark.data.server.AuthException
import ch.schmidtbit.shelfmark.data.server.HttpPoster
import ch.schmidtbit.shelfmark.data.server.ServerApi
import ch.schmidtbit.shelfmark.data.server.ServerConfig
import ch.schmidtbit.shelfmark.data.server.ServerException
import ch.schmidtbit.shelfmark.data.server.Session
import ch.schmidtbit.shelfmark.data.server.SyncAnswer
import ch.schmidtbit.shelfmark.data.server.VaultAnswer
import ch.schmidtbit.shelfmark.data.share.BackupPayload
import ch.schmidtbit.shelfmark.data.share.ShareCodec
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.json.Json
import java.io.File
import java.io.IOException
import java.security.MessageDigest
import java.time.LocalDate

sealed interface SyncResult {
    /** No server is built in, or nobody is signed in. */
    data object Off : SyncResult

    /**
     * [news] are the loans the other side changed since this device last looked. [due] are
     * the books that should be back by now and that this device has not yet reminded of.
     */
    data class Done(
        val news: List<LoanNews> = emptyList(),
        val due: List<Loan> = emptyList(),
        val libraries: Int = 0,
    ) : SyncResult

    /** [reason] is "network" or one of the reasons of [ServerException] and [AuthException]. */
    data class Failed(val reason: String) : SyncResult

    /**
     * The first time an account meets this device, and both already hold books. They were
     * never the same library, so there is nothing to merge by: the user says which one counts.
     */
    data class Choose(val onAccount: Int, val onDevice: Int) : SyncResult
}

/** Which library to go on with when an account and a device both have one. */
enum class Keep { ACCOUNT, DEVICE }

data class SyncStatus(val running: Boolean = false, val error: String? = null)

/**
 * Everything that involves the account: signing in, keeping the library the same on every
 * device and on the website (the "vault"), and friends.
 *
 * A friend's shelf arrives as it would in a file: the server holds the snapshot each person
 * shares, and it goes through [SocialRepository.import] as if the file had been opened by
 * hand. Loans are different. A loan is one record on the server that lender and borrower
 * both read, this device only remembers what it last heard, and the books of the library
 * follow from it (see [LoanBooks]).
 */
class ServerSync(
    private val db: AppDatabase,
    private val settings: SettingsRepository,
    private val social: SocialRepository,
    private val backup: BackupManager,
    private val covers: CoverStore,
    /** The server this build talks to, if any. */
    private val config: ServerConfig?,
    private val poster: HttpPoster,
    /** Where the library is kept as it was when this device and the server last agreed. */
    private val baseFile: File,
    private val now: () -> Long = System::currentTimeMillis,
    private val today: () -> Long = { LocalDate.now().toEpochDay() },
    /**
     * Where the work is done. Not on the main thread: writing a whole library as a
     * document, comparing two of them and reading pictures takes long enough to be felt.
     */
    private val work: CoroutineDispatcher = Dispatchers.Default,
    /** The address of the website, without a slash at the end. Empty when the build knows none. */
    private val website: String = "",
    /**
     * Hears what a look at the server brought that the reader should be told: news about
     * loans, and books that are due. Every look reports here, whoever started it and
     * whatever they do with its result, so that nothing is said twice and nothing is lost.
     */
    private val announce: (SyncResult.Done) -> Unit = {},
    /**
     * Where a library is put aside before it is replaced as a whole, which only happens when
     * an account and a device that both hold books meet and the reader says which one counts.
     */
    private val replacedDir: File? = null,
) {
    val status = MutableStateFlow(SyncStatus())

    /** Whether this build has a server at all. Without one the app works with files only. */
    val available: Boolean get() = config != null

    private val mutex = Mutex()

    // ---- the account ----

    /** Signs in and brings this device in step with the account. */
    suspend fun signIn(email: String, password: String): SyncResult = withContext(work) {
        safely({ SyncResult.Failed(it) }) { signInNow(email, password) }
    }

    private suspend fun signInNow(email: String, password: String): SyncResult {
        val config = config ?: return SyncResult.Failed(NO_SERVER)
        val session = try {
            AuthApi(config, poster, now).signIn(email, password)
        } catch (e: Exception) {
            return SyncResult.Failed(reasonOf(e))
        }
        welcome(session)
        return sync()
    }

    /**
     * Creates an account. Returns null when the address has to be confirmed by a link in a
     * mail first: nobody is signed in then, and signing in works once that is done.
     */
    suspend fun signUp(email: String, password: String): SyncResult? = withContext(work) {
        safely<SyncResult?>({ SyncResult.Failed(it) }) { signUpNow(email, password) }
    }

    private suspend fun signUpNow(email: String, password: String): SyncResult? {
        val config = config ?: return SyncResult.Failed(NO_SERVER)
        val session = try {
            // The link in the confirmation mail should end on the page that says "confirmed".
            AuthApi(config, poster, now).signUp(email, password, website.takeIf { it.startsWith("http") }?.let { "$it/confirmed" }) ?: return null
        } catch (e: Exception) {
            return SyncResult.Failed(reasonOf(e))
        }
        welcome(session)
        return sync()
    }

    private suspend fun welcome(session: Session) = mutex.withLock {
        val sameAccount = settings.current().userId == session.userId && baseFile.exists()
        // Another account, or the first one: what this device knew about a server was about somebody else.
        if (!sameAccount) {
            baseFile.delete()
            db.social().markAllOffline()
            db.social().clearLoans()
        }
        settings.setSession(session.accessToken, session.refreshToken, session.expiresAt, session.email, session.userId.takeIf { !sameAccount })
        status.value = SyncStatus()
    }

    /** Has a mail sent with a link for choosing a new password. Null when it worked, else the reason. */
    suspend fun recover(email: String): String? {
        val config = config ?: return NO_SERVER
        return try {
            AuthApi(config, poster, now).recover(email)
            null
        } catch (e: Exception) {
            reasonOf(e)
        }
    }

    /** Signs out on this device. The library stays here, and it stays on the account. */
    suspend fun signOut() = withContext(work) { safely({ }) { signOutNow() } }

    private suspend fun signOutNow() = mutex.withLock {
        val s = settings.current()
        val server = config
        if (server != null && s.accessToken.isNotBlank()) {
            // Telling the server is good manners, not a condition for signing out here.
            runCatching { AuthApi(server, poster, now).signOut(s.accessToken) }
        }
        forget()
    }

    /** Deletes the account and everything of it on the server. This device keeps its library. False when that failed. */
    suspend fun deleteAccount(): Boolean = withContext(work) { safely({ false }) { deleteAccountNow() } }

    private suspend fun deleteAccountNow(): Boolean = mutex.withLock {
        val config = config ?: return@withLock false
        try {
            val token = token() ?: return@withLock false
            val api = ServerApi(config, poster, token)
            // The cover photos first, while there is still somebody who may remove them: everything
            // in the account's own folder, also the pictures of books that are long gone. What the
            // folder does not name (a server that cannot list) is at least what the books still show.
            val me = settings.current().userId
            val listed = quietly { api.listCovers(me).map { "$me/$it" } }.orEmpty()
            val shown = db.books().all().map { it.coverUrl }.filter { it.startsWith(config.coverAddress("$me/")) }.map { it.removePrefix(config.coverAddress("")) }
            // A picture that will not go must not keep the account from going.
            (listed + shown).distinct().forEach { path -> quietly { api.deleteCover(path) } }
            api.deleteAccount()
        } catch (e: Exception) {
            reasonOf(e)
            return@withLock false
        }
        forget()
        baseFile.delete()
        settings.setVault(0, "")
        true
    }

    private suspend fun forget() {
        settings.clearSession()
        db.social().markAllOffline()
        // Loans are read from the server by whoever is signed in. Signed out, a book that was
        // lent or borrowed through one is a book lent or borrowed by hand.
        db.social().clearLoans()
        status.value = SyncStatus()
    }

    /** A token the server accepts right now, renewed when the old one is about to run out. Null when signed out. */
    private suspend fun token(): String? {
        val config = config ?: return null
        val s = settings.current()
        if (!s.signedIn) return null
        if (s.accessToken.isNotBlank() && s.tokenExpiresAt - 60 > now() / 1000) return s.accessToken
        return try {
            val fresh = AuthApi(config, poster, now).refresh(s.refreshToken)
            settings.setSession(fresh.accessToken, fresh.refreshToken, fresh.expiresAt, fresh.email)
            fresh.accessToken
        } catch (e: AuthException) {
            // Too many requests is a matter of waiting. Anything else means this sign-in is over:
            // the password was changed, the account deleted, or the session ended elsewhere.
            if (e.reason == "over_request_rate_limit" || e.status >= 500) throw e
            forget()
            // The reader did not do this, and may not be looking: the shelf says that it happened.
            settings.setSignedOutNotice(true)
            null
        }
    }

    /**
     * What went wrong, as a reason that can be shown. Whatever happens while this class is
     * at work ends here as a failed step with a reason: it never takes the app down.
     */
    private fun reasonOf(e: Exception): String = when (e) {
        is CancellationException -> throw e
        is ServerException -> e.reason
        is AuthException -> e.reason
        is IOException -> NETWORK
        else -> {
            runCatching { android.util.Log.w("Shelfmark", "The sync stopped on something unexpected", e) }
            UNEXPECTED
        }
    }

    /** Runs one of the things this class offers. What it throws becomes what [failed] makes of the reason. */
    private suspend fun <T> safely(failed: (String) -> T, step: suspend () -> T): T = try {
        step()
    } catch (e: Exception) {
        failed(reasonOf(e))
    }

    /** Does something that may fail without anything depending on it. Null when it failed. */
    private suspend fun <T> quietly(step: suspend () -> T): T? = try {
        step()
    } catch (e: CancellationException) {
        throw e
    } catch (e: Exception) {
        null
    }

    // ---- keeping everything in step ----

    suspend fun sync(): SyncResult = withContext(work) {
        safely({ reason -> status.value = SyncStatus(error = reason); SyncResult.Failed(reason) }) { syncNow() }
    }

    private suspend fun syncNow(): SyncResult = mutex.withLock {
        val config = config ?: return@withLock SyncResult.Off
        if (!settings.current().signedIn) return@withLock SyncResult.Off
        status.value = SyncStatus(running = true)
        val result = try {
            try {
                exchange(config)
            } catch (e: ServerException) {
                // The token ran out a moment early, by the server's clock. A fresh one, once.
                if (e.reason != "expired") throw e
                val s = settings.current()
                settings.setSession("", s.refreshToken, 0, s.accountEmail)
                exchange(config)
            }
        } catch (e: Exception) {
            SyncResult.Failed(reasonOf(e))
        }
        status.value = SyncStatus(error = (result as? SyncResult.Failed)?.reason)
        result
    }

    /** Answers the question of [SyncResult.Choose] and goes on from there. */
    suspend fun choose(keep: Keep): SyncResult = withContext(work) { safely({ SyncResult.Failed(it) }) { chooseNow(keep) } }

    private suspend fun chooseNow(keep: Keep): SyncResult {
        val config = config ?: return SyncResult.Off
        val failed = mutex.withLock {
            try {
                val api = ServerApi(config, poster, token() ?: return@withLock SyncResult.Off)
                replaceOne(api, keep)
                null
            } catch (e: Exception) {
                SyncResult.Failed(reasonOf(e))
            }
        }
        return failed ?: sync()
    }

    /**
     * One of two libraries is replaced as a whole here, and only here. Whichever one it is,
     * it is put aside as a backup file first, so that one tap cannot lose it for good.
     */
    private suspend fun replaceOne(api: ServerApi, keep: Keep) {
        repeat(TRIES) {
            val remote = api.vaultPull(0)
            val theirs = read(remote, known = 0)
            val local = snapshot()
            try {
                if (keep == Keep.ACCOUNT && theirs != null) {
                    // Put aside first: a phone that is switched off in between has lost nothing.
                    val aside = putAside(local)
                    try {
                        adopt(theirs, remote.revision, seen = local)
                    } catch (e: ChangedMeanwhile) {
                        aside?.delete()
                        throw e
                    }
                } else {
                    if (theirs != null) putAside(theirs)
                    push(api, local, remote.revision)
                }
                return
            } catch (e: ChangedMeanwhile) {
                // What is put aside has to be what is replaced. Once more, with the library as it is now.
            }
        }
    }

    private suspend fun putAside(library: BackupPayload): File? {
        val dir = replacedDir ?: return null
        return if (library.isEmpty()) null else backup.keepReplaced(library, dir, now())
    }

    private suspend fun exchange(config: ServerConfig): SyncResult {
        val token = token() ?: return SyncResult.Off
        val api = ServerApi(config, poster, token)

        // 0. Covers photographed here get an address, so that they can be seen elsewhere.
        uploadCovers(api, config)

        // 1. My own library, between this device and the account.
        vault(api)?.let { return it }

        // 2. My profile for friends, whenever my name changed.
        var s = settings.current()
        if (s.helloName != s.profileName || s.friendCode.isBlank()) {
            val profile = api.hello(s.profileName)
            settings.setHello(s.profileName, profile.code)
            s = settings.current()
        }

        // 3. What is new from friends, and where the loans stand.
        val known = db.social().onlineFriends().associate { it.id to it.serverAt }
        val answer = api.sync(known)
        if (answer.code.isNotBlank() && answer.code != s.friendCode) settings.setFriendCode(answer.code)
        // The first look at the loans of an account has nothing to compare with, and tells no news.
        val done = take(answer, first = !s.loansSeen)
        if (!s.loansSeen) settings.setLoansSeen()
        // Said right away. Whatever goes wrong further down, the reader has heard it, and it will not be news again.
        if (done.news.isNotEmpty() || done.due.isNotEmpty()) announce(done)

        // 4. The books follow the loans. That is a change to the library like any other,
        // and goes to the account so that the other devices do not have to work it out again.
        if (followLoans()) vault(api)

        // 5. The part of the library friends may see, when it differs from what the server has.
        // After the loans, because a book that is promised to somebody cannot be asked for.
        val shared = social.exportLibrary(s.shareStatus, s.shareRatings)
        val fingerprint = fingerprint(ShareCodec.encode(shared.copy(library = shared.library?.copy(createdAt = 0))))
        if (fingerprint != s.publishedHash) {
            api.publish(ShareCodec.encodeElement(shared))
            settings.setPublishedHash(fingerprint)
        }

        settings.setLastSync(now())
        return done
    }

    /**
     * A cover that was photographed is a file on this phone. Uploaded, it is a picture with
     * an address like any other cover, which the website, other devices and friends can show.
     */
    private suspend fun uploadCovers(api: ServerApi, config: ServerConfig) {
        val me = settings.current().userId
        for (book in db.books().all()) {
            if (book.coverPath.isBlank()) continue
            val path = "$me/${book.coverPath}"
            val address = config.coverAddress(path)
            if (book.coverUrl == address) continue
            // Taken on another device: the file is not here, and its address came with the book.
            val file = covers.file(book.coverPath).takeIf { it.exists() } ?: continue
            try {
                api.uploadCover(path, file.readBytes())
            } catch (e: ServerException) {
                // One picture that is refused must not keep the library from being saved.
                if (e.reason == "expired") throw e
                continue
            }
            // Onto the book as it is now: the reader may have changed it while the picture was on its way.
            db.withTransaction {
                val current = db.books().get(book.id)
                if (current != null && current.coverPath == book.coverPath) db.books().update(current.copy(coverUrl = address, updatedAt = now()))
            }
        }
    }

    /**
     * Brings the library on this device and the one on the account together. Returns
     * null when that is done, or a question for the user.
     */
    private suspend fun vault(api: ServerApi): SyncResult? {
        var conflict = false
        repeat(TRIES) {
            try {
                return vaultOnce(api)
            } catch (e: ServerException) {
                // Somebody else saved between our look and our save. Look again.
                if (e.reason != "conflict") throw e
                conflict = true
            } catch (e: ChangedMeanwhile) {
                // The reader changed something between our look and our write. Look again, with that in it.
                conflict = false
            }
        }
        if (conflict) throw ServerException("conflict", 400)
        // The library does not hold still. The next sync, a moment after the last change, finds it at rest.
        return SyncResult.Done()
    }

    /** The library or the settings were changed between the look at them and the write over them. */
    private class ChangedMeanwhile : Exception()

    private suspend fun vaultOnce(api: ServerApi): SyncResult? {
        val s = settings.current()
        val local = snapshot()

        if (s.vaultRevision == 0L) {
            // This device and this account have never been in step.
            val remote = api.vaultPull(0)
            val theirs = read(remote, known = 0)
            when {
                theirs == null || theirs.isEmpty() -> push(api, local, remote.revision)
                local.isEmpty() -> adopt(theirs, remote.revision, seen = local)
                else -> return SyncResult.Choose(onAccount = theirs.books.size, onDevice = local.books.size)
            }
            return null
        }

        val changedHere = fingerprint(local) != s.vaultHash
        val remote = api.vaultPull(s.vaultRevision)
        val theirs = read(remote, known = s.vaultRevision)
        when {
            // The server has what we last saw (or lost it altogether): only our own changes matter.
            theirs == null -> if (changedHere || remote.revision != s.vaultRevision) push(api, local, remote.revision)
            !changedHere -> adopt(theirs, remote.revision, seen = local)
            else -> {
                replace(VaultMerge.merge(loadBase(), local, theirs), seen = local)
                push(api, snapshot(), remote.revision, showed = listOf(local, theirs))
            }
        }
        return null
    }

    /**
     * Puts [library] in the place of the one on this device, but only while that one is still
     * the one that was looked at ([seen]): the look and the write are a second or two of
     * network apart, and a star given or a session logged in between must not be run over.
     * Returns the library as it stands here afterwards.
     */
    private suspend fun replace(library: BackupPayload, seen: BackupPayload): BackupPayload {
        var prefs = seen.prefs
        val written = backup.restore(library, onlyIf = seen) {
            // The settings go the same way, and with the library or not at all.
            val wanted = library.prefs ?: return@restore true
            prefs = settings.applyPrefs(wanted, onlyIf = seen.prefs) ?: return@restore false
            true
        } ?: throw ChangedMeanwhile()
        return written.copy(prefs = prefs)
    }

    /**
     * The library the account holds, or null where there is nothing to read: the account has
     * none yet, or this device has that very revision already. A library that is there and
     * that this version cannot read stops everything: it is never taken for an empty one,
     * and nothing is written over it (see "A library a client cannot read is never
     * replaced" in supabase/README.md).
     */
    private fun read(remote: VaultAnswer, known: Long): BackupPayload? {
        val payload = remote.payload
        if (payload == null) {
            if (remote.revision != 0L && remote.revision != known) throw ServerException(UNREADABLE, 200)
            return null
        }
        return ShareCodec.decodeVault(payload) ?: throw ServerException(UNREADABLE, 200)
    }

    // The time of the snapshot is left at zero: the same library is the same document.
    private suspend fun snapshot(): BackupPayload = backup.snapshot(settings.current().vaultPrefs(), at = 0)

    /**
     * Saves [local] to the account. [showed] are libraries that went into it besides the one
     * this device and the account last agreed on: what they showed and [local] does not is
     * a picture nobody shows any more.
     */
    private suspend fun push(api: ServerApi, local: BackupPayload, expected: Long, showed: List<BackupPayload> = emptyList()) {
        val before = listOfNotNull(loadBase()) + showed
        val revision = api.vaultPush(ShareCodec.encodeVault(local.copy(exportedAt = now())), expected)
        settings.setVault(revision, fingerprint(local))
        saveBase(local)
        removeCoversNobodyShows(api, before, local)
    }

    /**
     * A cover photo has an address that anybody who knows it can open. Once no book shows it
     * any more (the book was deleted, or got another cover), it is taken off the storage.
     * [before] is what showed pictures until this save, [saved] what the account holds now.
     * Only pictures of the account's own folder are touched, and one that will not go is
     * left: the save has happened, and a picture is no reason to call it failed.
     */
    private suspend fun removeCoversNobodyShows(api: ServerApi, before: List<BackupPayload>, saved: BackupPayload) {
        val config = config ?: return
        val mine = config.coverAddress(settings.current().userId + "/")
        val shown = saved.books.mapTo(HashSet()) { it.coverUrl }
        before.flatMap { it.books }.map { it.coverUrl }.filter { it.startsWith(mine) && it !in shown }.distinct().forEach { address ->
            quietly { api.deleteCover(address.removePrefix(config.coverAddress(""))) }
        }
    }

    /** Takes over the library of the account, unless the one here has changed since it was looked at ([seen]). */
    private suspend fun adopt(theirs: BackupPayload, revision: Long, seen: BackupPayload) {
        // What is here now, as this app writes it, is what later changes are measured against.
        val mine = replace(theirs, seen)
        settings.setVault(revision, fingerprint(mine))
        saveBase(mine)
    }

    private fun BackupPayload.isEmpty(): Boolean = books.isEmpty() && shelves.isEmpty() && quotes.isEmpty() && goals.isEmpty()

    private fun saveBase(payload: BackupPayload) {
        runCatching { baseFile.writeText(ShareCodec.encodeVault(payload).toString()) }
    }

    private fun loadBase(): BackupPayload? =
        runCatching { ShareCodec.decodeVault(Json.parseToJsonElement(baseFile.readText())) }.getOrNull()

    private suspend fun take(answer: SyncAnswer, first: Boolean): SyncResult.Done {
        var libraries = 0
        for (entry in answer.libraries) {
            val envelope = ShareCodec.decodeElement(entry.payload) ?: continue
            // A library counts only for the person the server says it came from.
            if (envelope.library?.ownerId != entry.owner) continue
            if (social.import(envelope, fromServer = true) is ImportResult.LibraryImported) {
                db.social().markOnline(entry.owner, entry.at)
                libraries++
            }
        }

        // Friends without a library yet still show up, and friends who left disappear.
        val serverIds = answer.friends.map { it.id }.toSet()
        for (friend in answer.friends) {
            if (db.social().getFriend(friend.id) == null) {
                db.social().upsertFriend(
                    Friend(id = friend.id, name = friend.name.ifBlank { "?" }, sharedAt = 0, importedAt = now(), includesStatus = false, includesRatings = false, online = true),
                )
            }
        }
        db.social().onlineFriends().filter { it.id !in serverIds }.forEach { db.social().deleteFriend(it.id) }

        // The loans are what the server says, no more and no less. What only this phone
        // knows about one (that it reminded of the day) stays with it.
        val before = db.social().loans().associateBy { it.id }
        val loans = answer.loans.map { it.copy(dueSaid = before[it.id]?.dueSaid) }
        if (loans.toSet() != before.values.toSet()) {
            db.withTransaction {
                db.social().clearLoans()
                db.social().upsertLoans(loans)
            }
        }
        val news = if (first) emptyList() else loans
            .filter { !it.byMe && it.updatedAt > (before[it.id]?.updatedAt ?: 0) }
            .map { LoanNews(it, LoanRules.news(it, before[it.id])) }
        // A reminder is given once per loan and day it was due on. Another day is another reminder.
        val day = today()
        val due = loans.filter { it.dueBy(day) && it.dueSaid != it.dueOn }
        due.forEach { db.social().markDueSaid(it.id) }
        return SyncResult.Done(news, due, libraries)
    }

    /** Brings the books in line with the loans (see [LoanBooks]). True when a book had to change. */
    private suspend fun followLoans(): Boolean {
        val loans = db.social().loans()
        if (loans.isEmpty()) return false
        val shared = loans.filter { !it.lender && it.state.out }.mapNotNull { db.social().findFriendBook(it.peerId, it.bookId) }
        // Read and written in one go, so that nothing the reader does to a book falls in between.
        return db.withTransaction {
            val changed = LoanBooks.follow(db.books().all(), loans, shared, now())
            changed.forEach { book -> if (db.books().get(book.id) == null) db.books().insert(book) else db.books().update(book) }
            changed.isNotEmpty()
        }
    }

    // ---- loans ----

    /**
     * Asks a friend for one of the books on their shelf. Returns null when the question
     * is with them, otherwise the reason it is not: "taken" when the book went to somebody
     * else in the meantime, "network", or what else the server said.
     */
    suspend fun loanAsk(book: FriendBook, note: String): String? = withContext(work) {
        safely<String?>({ it }) { loanStep { api -> api.loanAsk(book, note.trim()) } }
    }

    /**
     * Takes one step of a loan (see [LoanRules.actions] for which are open). [due] goes with
     * a yes and with another day: the epoch day the book is wanted back by, or null for no
     * fixed date. Returns null when it is done, otherwise the reason it is not: "not_allowed"
     * when the loan has moved on in the meantime, in which case the loans were fetched again
     * and show where it stands.
     */
    suspend fun loanAct(loanId: String, action: LoanAction, due: Long? = null, reason: String = ""): String? = withContext(work) {
        safely<String?>({ it }) { loanStep(putAway = action == LoanAction.HIDE) { api -> api.loanAct(loanId, action, due, reason.trim()) } }
    }

    private suspend fun loanStep(putAway: Boolean = false, step: suspend (ServerApi) -> Loan): String? {
        val config = config ?: return NO_SERVER
        val failed = try {
            val token = mutex.withLock { token() } ?: return "signed_out"
            val loan = step(ServerApi(config, poster, token))
            // The screens show the step at once, before the rest has caught up.
            if (putAway) db.social().deleteLoan(loan.id)
            else db.social().upsertLoans(listOf(loan.copy(dueSaid = db.social().getLoan(loan.id)?.dueSaid)))
            null
        } catch (e: Exception) {
            reasonOf(e)
        }
        // The books follow the loan, and what friends may ask for changes with it. After a
        // refusal too: the loan is not where this device thought it was.
        if (failed != NETWORK) sync()
        return failed
    }

    // ---- friends ----

    /** Connects with the owner of [code]. Returns their name, or the reason it did not work. */
    suspend fun addFriend(code: String): Result<String> = withContext(work) {
        safely({ Result.failure(ServerException(it, 0)) }) { addFriendNow(code) }
    }

    private suspend fun addFriendNow(code: String): Result<String> {
        val config = config ?: return Result.failure(ServerException(NO_SERVER, 0))
        return try {
            val token = mutex.withLock { token() } ?: return Result.failure(ServerException("signed_out", 0))
            val friend = ServerApi(config, poster, token).addFriend(code)
            sync()
            Result.success(friend.name)
        } catch (e: Exception) {
            Result.failure(e as? ServerException ?: ServerException(reasonOf(e), 0))
        }
    }

    /** Ends the friendship, on the server too when it lives there. False when the server could not be reached. */
    suspend fun removeFriend(id: String): Boolean = safely({ false }) { removeFriendNow(id) }

    private suspend fun removeFriendNow(id: String): Boolean {
        val friend = db.social().getFriend(id) ?: return true
        if (friend.online && config != null && settings.current().signedIn) {
            try {
                val token = mutex.withLock { token() } ?: return false
                ServerApi(config, poster, token).removeFriend(id)
            } catch (e: Exception) {
                reasonOf(e)
                return false
            }
        }
        db.social().deleteFriend(id)
        return true
    }

    /** Replaces my friend code, so the old one stops working. Null when that failed. */
    suspend fun newCode(): String? {
        val config = config ?: return null
        return try {
            val token = mutex.withLock { token() } ?: return null
            ServerApi(config, poster, token).newCode().also { settings.setFriendCode(it) }
        } catch (e: Exception) {
            reasonOf(e)
            null
        }
    }

    /**
     * Once a day the app says hello to its server. A free Supabase project is paused when
     * its database sees no activity for a week, and this is that activity. Nothing about
     * the user is sent, and it happens whether or not anybody is signed in. Somebody who
     * is signed in is brought up to date as well.
     */
    suspend fun dailyCheck(): SyncResult = withContext(work) { safely({ SyncResult.Failed(it) }) { dailyCheckNow() } }

    private suspend fun dailyCheckNow(): SyncResult {
        val config = config ?: return SyncResult.Off
        val day = today()
        if (settings.current().lastPingDay != day) {
            try {
                ServerApi(config, poster).ping()
                settings.setLastPingDay(day)
            } catch (e: Exception) {
                // No connection right now. The next start of the app or the next run in the background tries again.
                reasonOf(e)
            }
        }
        return sync()
    }

    private fun fingerprint(payload: BackupPayload): String = fingerprint(ShareCodec.encodeVault(payload.copy(exportedAt = 0)).toString())

    private fun fingerprint(text: String): String =
        MessageDigest.getInstance("SHA-256").digest(text.toByteArray()).joinToString("") { "%02x".format(it) }

    companion object {
        const val NETWORK = "network"
        const val NO_SERVER = "no_server"

        /** The library on the account is one this version cannot read. Nothing is written until an update can. */
        const val UNREADABLE = "unreadable"

        /** Something went wrong that nobody foresaw. The step is given up, the app goes on. */
        const val UNEXPECTED = "unexpected"

        /** How often a step is started over when the library, here or on the account, changed under it. */
        private const val TRIES = 4
    }
}
