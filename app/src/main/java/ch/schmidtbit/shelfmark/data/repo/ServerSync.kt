package ch.schmidtbit.shelfmark.data.repo

import ch.schmidtbit.shelfmark.data.db.AppDatabase
import ch.schmidtbit.shelfmark.data.model.Friend
import ch.schmidtbit.shelfmark.data.model.LendStatus
import ch.schmidtbit.shelfmark.data.model.OutboxMessage
import ch.schmidtbit.shelfmark.data.server.HttpPoster
import ch.schmidtbit.shelfmark.data.server.ServerApi
import ch.schmidtbit.shelfmark.data.server.ServerConfig
import ch.schmidtbit.shelfmark.data.server.ServerException
import ch.schmidtbit.shelfmark.data.server.SyncAnswer
import ch.schmidtbit.shelfmark.data.share.Envelope
import ch.schmidtbit.shelfmark.data.share.ShareCodec
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import java.io.IOException
import java.security.MessageDigest
import java.time.LocalDate

sealed interface SyncResult {
    /** No server is set up, or the user has not connected to it. */
    data object Off : SyncResult

    /** [requests] and [answers] are the ones that were new this time, e.g. to tell the user about. */
    data class Done(
        val requests: List<ImportResult.RequestReceived> = emptyList(),
        val answers: List<ImportResult.AnswerReceived> = emptyList(),
        val libraries: Int = 0,
    ) : SyncResult

    /** [reason] is "network" or one of the reasons of [ServerException]. */
    data class Failed(val reason: String) : SyncResult
}

data class SyncStatus(val running: Boolean = false, val error: String? = null)

/**
 * Keeps friends in step through the server. The server is only a relay for the very
 * things that can also be sent as files: it holds the library snapshot each person
 * shares and passes borrow requests and their answers on. Whatever arrives goes through
 * [SocialRepository.import], exactly as if the file had been opened by hand.
 */
class ServerSync(
    private val db: AppDatabase,
    private val settings: SettingsRepository,
    private val social: SocialRepository,
    /** The server the app was built for, if any. A server entered in the settings wins. */
    private val builtIn: ServerConfig?,
    private val poster: HttpPoster,
    private val now: () -> Long = System::currentTimeMillis,
    private val today: () -> Long = { LocalDate.now().toEpochDay() },
) {
    val status = MutableStateFlow(SyncStatus())
    val waiting: Flow<Int> = db.social().observeOutboxCount()
    val hasBuiltIn: Boolean get() = builtIn != null

    private val mutex = Mutex()

    suspend fun config(): ServerConfig? {
        val s = settings.current()
        return ServerConfig.of(s.serverUrl, s.serverKey) ?: builtIn
    }

    /** Creates the profile on the server, publishes the library and fetches what is there. */
    suspend fun connect(): SyncResult {
        if (config() == null) return SyncResult.Failed(NO_SERVER)
        settings.setOnline(true)
        val result = sync()
        // A first connection that did not work leaves the user where they were.
        if (result is SyncResult.Failed && settings.current().friendCode.isBlank()) settings.setOnline(false)
        return result
    }

    /** Removes everything of mine from the server and stops using it. False when the server could not be reached. */
    suspend fun disconnect(): Boolean = mutex.withLock {
        val s = settings.current()
        val config = config()
        if (s.online && config != null && s.serverSecret.isNotBlank()) {
            try {
                ServerApi(config, poster).deleteAccount(s.userId, s.serverSecret)
            } catch (e: ServerException) {
                // "forbidden" means the profile is gone already, which is what was wanted.
                if (e.reason != "forbidden") return@withLock false
            } catch (e: IOException) {
                return@withLock false
            }
        }
        settings.setOnline(false)
        db.social().markAllOffline()
        db.social().clearOutbox()
        status.value = SyncStatus()
        true
    }

    suspend fun sync(): SyncResult = mutex.withLock {
        val config = config()
        if (config == null || !settings.current().online) return@withLock SyncResult.Off
        status.value = SyncStatus(running = true)
        val result = try {
            try {
                exchange(ServerApi(config, poster), config)
            } catch (e: ServerException) {
                // The server forgets profiles that were away for a very long time. Registering again fixes that.
                if (e.reason != "forbidden") throw e
                settings.setRegistered("", settings.current().friendCode)
                exchange(ServerApi(config, poster), config)
            }
        } catch (e: ServerException) {
            SyncResult.Failed(e.reason)
        } catch (e: IOException) {
            SyncResult.Failed(NETWORK)
        }
        status.value = SyncStatus(error = (result as? SyncResult.Failed)?.reason)
        result
    }

    private suspend fun exchange(api: ServerApi, config: ServerConfig): SyncResult {
        val id = settings.ensureUserId()
        val secret = settings.ensureServerSecret()
        var s = settings.current()

        // 1. The profile, whenever the server or my name changed.
        val wanted = config.url + "|" + s.profileName
        if (s.registeredAs != wanted || s.friendCode.isBlank()) {
            val registration = api.register(id, secret, s.profileName)
            settings.setRegistered(wanted, registration.code)
            settings.setPublishedHash("")
            s = settings.current()
        }

        // 2. My library, when it differs from what the server has.
        val mine = social.exportLibrary(s.shareStatus, s.shareRatings)
        val fingerprint = fingerprint(mine)
        if (fingerprint != s.publishedHash) {
            api.publish(id, secret, ShareCodec.encodeElement(mine))
            settings.setPublishedHash(fingerprint)
        }

        // 3. What I wrote to friends while there was no connection.
        for (message in db.social().outbox()) {
            val payload = ShareCodec.decode(message.payload)
            try {
                if (payload != null) api.send(id, secret, message.toId, ShareCodec.encodeElement(payload))
            } catch (e: ServerException) {
                // Not friends any more, or too large: this one will never arrive, drop it. Anything else stops the run.
                if (e.reason !in setOf("not_friends", "too_large", "bad_request")) throw e
            }
            db.social().dequeue(message.id)
        }

        // 4. What is new for me.
        val known = db.social().onlineFriends().associate { it.id to it.serverAt }
        val answer = api.sync(id, secret, known)
        if (answer.code.isNotBlank() && answer.code != s.friendCode) settings.setFriendCode(answer.code)
        val done = take(answer)
        if (answer.messages.isNotEmpty()) {
            // Tell the server which messages arrived, so it can delete them.
            val knownNow = db.social().onlineFriends().associate { it.id to it.serverAt }
            api.sync(id, secret, knownNow, answer.messages.map { it.id })
        }
        settings.setLastSync(now())
        return done
    }

    private suspend fun take(answer: SyncAnswer): SyncResult.Done {
        var libraries = 0
        for (entry in answer.libraries) {
            val envelope = ShareCodec.decodeElement(entry.payload) ?: continue
            // A library counts only for the person the server says it came from.
            if (envelope.library?.ownerId != entry.owner) continue
            if (social.import(envelope) is ImportResult.LibraryImported) {
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

        val requests = ArrayList<ImportResult.RequestReceived>()
        val answers = ArrayList<ImportResult.AnswerReceived>()
        for (message in answer.messages) {
            val envelope = ShareCodec.decodeElement(message.payload) ?: continue
            // Nobody can ask or answer in somebody else's name.
            val honest = envelope.request?.fromId == message.from || envelope.answer?.fromId == message.from
            if (!honest) continue
            val newRequest = envelope.request?.let { social.getRequest(it.requestId) == null } ?: false
            val openAnswer = envelope.answer?.let { social.getRequest(it.requestId)?.status == LendStatus.PENDING } ?: false
            when (val result = social.import(envelope)) {
                is ImportResult.RequestReceived -> if (newRequest) requests += result
                is ImportResult.AnswerReceived -> if (openAnswer) answers += result
                else -> Unit
            }
        }
        return SyncResult.Done(requests, answers, libraries)
    }

    /** True when something for [peerId] can go through the server instead of the share sheet. */
    suspend fun canReach(peerId: String): Boolean =
        settings.current().online && config() != null && db.social().getFriend(peerId)?.online == true

    /** Sends [envelope] to a friend. Returns true when it left right away, false when it waits for a connection. */
    suspend fun send(toId: String, envelope: Envelope): Boolean {
        val queued = db.social().enqueue(OutboxMessage(toId = toId, payload = ShareCodec.encode(envelope), createdAt = now()))
        sync()
        return db.social().outbox().none { it.id == queued }
    }

    /** Connects with the owner of [code]. Returns their name, or the reason it did not work. */
    suspend fun addFriend(code: String): Result<String> {
        val config = config() ?: return Result.failure(ServerException(NO_SERVER, 0))
        val s = settings.current()
        if (!s.online) return Result.failure(ServerException(NO_SERVER, 0))
        return try {
            val friend = ServerApi(config, poster).addFriend(settings.ensureUserId(), settings.ensureServerSecret(), code)
            sync()
            Result.success(friend.name)
        } catch (e: ServerException) {
            Result.failure(e)
        } catch (e: IOException) {
            Result.failure(ServerException(NETWORK, 0))
        }
    }

    /** Ends the friendship, on the server too when it lives there. False when the server could not be reached. */
    suspend fun removeFriend(id: String): Boolean {
        val friend = db.social().getFriend(id) ?: return true
        val config = config()
        val s = settings.current()
        if (friend.online && s.online && config != null) {
            try {
                ServerApi(config, poster).removeFriend(s.userId, s.serverSecret, id)
            } catch (e: IOException) {
                return false
            }
        }
        db.social().deleteFriend(id)
        return true
    }

    /** Replaces my friend code, so the old one stops working. Null when that failed. */
    suspend fun newCode(): String? {
        val config = config() ?: return null
        val s = settings.current()
        if (!s.online) return null
        return try {
            ServerApi(config, poster).newCode(s.userId, s.serverSecret).also { settings.setFriendCode(it) }
        } catch (e: IOException) {
            null
        }
    }

    /**
     * Once a day the app says hello to its server. A free Supabase project is paused when
     * its database sees no activity for a week, and this is that activity. Nothing about
     * the user is sent. If the user is connected, friends are brought up to date as well.
     */
    suspend fun dailyCheck(): SyncResult {
        val config = config() ?: return SyncResult.Off
        val day = today()
        if (settings.current().lastPingDay != day) {
            try {
                ServerApi(config, poster).ping()
                settings.setLastPingDay(day)
            } catch (e: IOException) {
                // No connection right now. The next start of the app or the next run in the background tries again.
            }
        }
        return sync()
    }

    private fun fingerprint(envelope: Envelope): String {
        // The time of export is left out: the same books are the same library.
        val stable = envelope.copy(library = envelope.library?.copy(createdAt = 0))
        val digest = MessageDigest.getInstance("SHA-256").digest(ShareCodec.encode(stable).toByteArray())
        return digest.joinToString("") { "%02x".format(it) }
    }

    companion object {
        const val NETWORK = "network"
        const val NO_SERVER = "no_server"
    }
}
