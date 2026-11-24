package ch.schmidtbit.shelfmark.data.server

import ch.schmidtbit.shelfmark.data.model.BookFormat
import ch.schmidtbit.shelfmark.data.model.FriendBook
import ch.schmidtbit.shelfmark.data.model.Loan
import ch.schmidtbit.shelfmark.data.model.LoanAction
import ch.schmidtbit.shelfmark.data.model.LoanState
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.long
import kotlinx.serialization.json.longOrNull
import kotlinx.serialization.json.put
import okhttp3.Call
import okhttp3.Callback
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import java.io.IOException
import java.util.concurrent.TimeUnit
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

/** Where the Shelfmark server lives: the address of a Supabase project and its public key. */
data class ServerConfig(val url: String, val key: String) {
    val valid: Boolean get() = url.startsWith("http") && key.isNotBlank()

    fun rpc(function: String): String = url.trimEnd('/') + "/rest/v1/rpc/" + function

    fun auth(path: String): String = url.trimEnd('/') + "/auth/v1/" + path

    /** Where a cover photo is uploaded to and removed from. [path] is "<user id>/<file name>". */
    fun cover(path: String): String = url.trimEnd('/') + "/storage/v1/object/$COVERS/" + path

    /** The address under which everybody can see that photo. */
    fun coverAddress(path: String): String = url.trimEnd('/') + "/storage/v1/object/public/$COVERS/" + path

    /** Where the storage is asked what a folder holds. */
    val coverList: String get() = url.trimEnd('/') + "/storage/v1/object/list/$COVERS"

    /**
     * The project key always travels as "apikey". "Authorization" carries the token of the
     * person who is signed in. With nobody signed in, only the older kind of project key,
     * which is a token itself, is sent there as well.
     */
    fun headers(token: String? = null): Map<String, String> = buildMap {
        put("apikey", key)
        when {
            token != null -> put("Authorization", "Bearer $token")
            !key.startsWith("sb_") -> put("Authorization", "Bearer $key")
        }
        put("Content-Type", "application/json")
        put("Accept", "application/json")
    }

    companion object {
        const val COVERS = "shelfmark-covers"

        fun of(url: String, key: String): ServerConfig? = ServerConfig(url.trim().trimEnd('/'), key.trim()).takeIf { it.valid }
    }
}

data class HttpAnswer(val code: Int, val body: String)

/** Minimal POST abstraction, so the server client can be tested without a network. */
fun interface HttpPoster {
    suspend fun post(url: String, headers: Map<String, String>, body: String): HttpAnswer

    /** For what is not JSON: sends [body] as it is, or nothing, with the given method. */
    suspend fun send(method: String, url: String, headers: Map<String, String>, body: ByteArray?): HttpAnswer = HttpAnswer(501, "")
}

/**
 * Passes every call on to the poster that [make] builds, which it does when the first
 * call is made: an HTTP client is not needed to start the app, only to talk to a server.
 */
class LazyPoster(make: () -> HttpPoster) : HttpPoster {
    private val real by lazy(make)

    override suspend fun post(url: String, headers: Map<String, String>, body: String): HttpAnswer = real.post(url, headers, body)

    override suspend fun send(method: String, url: String, headers: Map<String, String>, body: ByteArray?): HttpAnswer = real.send(method, url, headers, body)
}

class OkHttpPoster(private val client: OkHttpClient) : HttpPoster {
    // A whole library, or a picture, over a slow line takes longer than a question and its answer.
    private val patient: OkHttpClient by lazy {
        client.newBuilder()
            .callTimeout(LARGE_SECONDS, TimeUnit.SECONDS)
            .readTimeout(LARGE_SECONDS, TimeUnit.SECONDS)
            .writeTimeout(LARGE_SECONDS, TimeUnit.SECONDS)
            .build()
    }

    override suspend fun post(url: String, headers: Map<String, String>, body: String): HttpAnswer =
        run(Request.Builder().url(url).post(body.toRequestBody(JSON)).apply { headers.forEach { (k, v) -> header(k, v) } }.build())

    override suspend fun send(method: String, url: String, headers: Map<String, String>, body: ByteArray?): HttpAnswer {
        val content = body?.toRequestBody(headers["Content-Type"]?.toMediaTypeOrNull())
        return run(Request.Builder().url(url).method(method, content).apply { headers.forEach { (k, v) -> header(k, v) } }.build())
    }

    /** The call for [request], with the time it is given: more for what carries a library or a picture. */
    internal fun callFor(request: Request): Call = (if (isLarge(request.url.encodedPath)) patient else client).newCall(request)

    private suspend fun run(request: Request): HttpAnswer = suspendCancellableCoroutine { cont ->
        val call = callFor(request)
        cont.invokeOnCancellation { call.cancel() }
        call.enqueue(object : Callback {
            override fun onFailure(call: Call, e: IOException) {
                if (cont.isActive) cont.resumeWithException(e)
            }

            override fun onResponse(call: Call, response: Response) {
                response.use {
                    try {
                        cont.resume(HttpAnswer(it.code, it.body.string()))
                    } catch (e: IOException) {
                        if (cont.isActive) cont.resumeWithException(e)
                    }
                }
            }
        })
    }

    companion object {
        private val JSON = "application/json; charset=utf-8".toMediaType()

        /** How long a call that carries a whole library, or a picture, may take. */
        const val LARGE_SECONDS = 60L

        // The vault in both directions, what friends get, what friends give, and the cover photos.
        private val LARGE = listOf("/rpc/shelfmark_vault_", "/rpc/shelfmark_publish", "/rpc/shelfmark_sync", "/storage/v1/object/")

        fun isLarge(path: String): Boolean = LARGE.any { it in path }
    }
}

/**
 * The server said no. [reason] is one of the words the server functions use
 * (signed_out, unknown_code, own_code, not_friends, too_large, full, bad_request, conflict,
 * and for loans taken, not_allowed, unknown_loan, invalid, outdated),
 * "expired" for a sign-in that has to be renewed, "setup" when the project does not have
 * the Shelfmark functions (or not the one that was called, because its schema.sql is an
 * older one), "key" for a project key that is not accepted, or "http_NNN".
 */
class ServerException(val reason: String, val status: Int) : IOException("Server: $reason ($status)")

data class Registration(val id: String, val code: String, val name: String)
data class RemoteFriend(val id: String, val name: String)
data class RemoteLibrary(val owner: String, val at: Long, val payload: JsonElement)

data class SyncAnswer(
    val id: String,
    val code: String,
    val friends: List<RemoteFriend>,
    val libraries: List<RemoteLibrary>,
    /** Every loan I am part of and have not put away, the newest question first. */
    val loans: List<Loan>,
)

/**
 * The library of an account as the server holds it. [payload] is null when the caller has
 * this revision already, and when the account has no library yet (revision 0).
 */
data class VaultAnswer(val revision: Long, val payload: JsonElement?)

/**
 * The calls the app makes, each one a function of supabase/schema.sql. All but [ping]
 * act for the person whose [token] is passed, and for nobody else.
 */
class ServerApi(private val config: ServerConfig, private val poster: HttpPoster, private val token: String? = null) {

    /** The daily check. Needs no sign-in. Returns normally when the server answered. */
    suspend fun ping() {
        call("shelfmark_ping", buildJsonObject { }, signedIn = false)
    }

    /** Returns my profile, creating it on first use. A name that is given is set. */
    suspend fun hello(name: String? = null): Registration {
        val answer = call("shelfmark_hello", buildJsonObject { if (name != null) put("p_name", name) }).jsonObject
        return Registration(answer.text("id"), answer.text("code"), answer.text("name"))
    }

    suspend fun newCode(): String = call("shelfmark_new_code", buildJsonObject { }).jsonObject.text("code")

    suspend fun addFriend(code: String): RemoteFriend {
        val answer = call("shelfmark_add_friend", buildJsonObject { put("p_code", code) }).jsonObject
        return RemoteFriend(answer.text("id"), answer.text("name"))
    }

    suspend fun removeFriend(friendId: String) {
        call("shelfmark_remove_friend", buildJsonObject { put("p_friend", friendId) })
    }

    suspend fun publish(library: JsonElement) {
        call("shelfmark_publish", buildJsonObject { put("p_library", library) })
    }

    /**
     * Asks a friend for one of their books. [book] is the book as their shared library shows it.
     * Asking again for a book I already asked for gives back the question that is still open.
     * Refused with "taken" when the book is reserved for somebody or out.
     */
    suspend fun loanAsk(book: FriendBook, note: String): Loan {
        val answer = call(
            "shelfmark_loan_ask",
            buildJsonObject {
                put("p_friend", book.friendId)
                put("p_book", book.remoteId)
                put("p_info", buildJsonObject {
                    put("title", book.title)
                    put("authors", book.authors)
                    put("isbn", book.isbn)
                    put("coverUrl", book.coverUrl)
                    put("pageCount", book.pageCount)
                    put("format", book.format.name)
                })
                put("p_note", note)
            },
        )
        return readLoan(answer) ?: throw ServerException("bad_answer", 200)
    }

    /**
     * One step of a loan. [due] counts for saying yes and for another day: the epoch day the
     * book is wanted back by, null for no fixed date. [reason] goes with a no or a yes taken back.
     * Refused with "not_allowed" when the loan has moved on and this step no longer fits.
     */
    suspend fun loanAct(loanId: String, action: LoanAction, due: Long? = null, reason: String = ""): Loan {
        val answer = call(
            "shelfmark_loan_act",
            buildJsonObject {
                put("p_loan", loanId)
                put("p_action", action.word)
                put("p_due", due)
                put("p_reason", reason)
            },
        )
        return readLoan(answer) ?: throw ServerException("bad_answer", 200)
    }

    /** [known] maps a friend's id to the library version this phone has. */
    suspend fun sync(known: Map<String, Long>): SyncAnswer {
        val answer = call("shelfmark_sync", buildJsonObject { put("p_known", JsonObject(known.mapValues { JsonPrimitive(it.value) })) }).jsonObject
        return SyncAnswer(
            id = answer.text("id"),
            code = answer.text("code"),
            friends = answer.list("friends").map { RemoteFriend(it.text("id"), it.text("name")) },
            libraries = answer.list("libraries").map { RemoteLibrary(it.text("owner"), it.getValue("at").jsonPrimitive.long, it.getValue("payload")) },
            // A server from before the loans sends none, and that reads as "no loans".
            loans = answer.list("loans").mapNotNull(::readLoan),
        )
    }

    /** My whole library. Costs next to nothing when [known] is still the revision on the server. */
    suspend fun vaultPull(known: Long): VaultAnswer {
        val answer = call("shelfmark_vault_pull", buildJsonObject { put("p_known", known) }).jsonObject
        // Whatever is there is handed on, a document or not: what cannot be read must not be taken for "nothing there".
        return VaultAnswer(answer.getValue("revision").jsonPrimitive.long, answer["payload"]?.takeIf { it !is JsonNull })
    }

    /** Saves my library if the server is still at revision [expected]. Returns the new revision. Refused with "conflict" otherwise. */
    suspend fun vaultPush(payload: JsonElement, expected: Long): Long =
        call("shelfmark_vault_push", buildJsonObject { put("p_payload", payload); put("p_expected", expected) }).jsonObject
            .getValue("revision").jsonPrimitive.long

    suspend fun deleteAccount() {
        call("shelfmark_delete_account", buildJsonObject { })
    }

    /** Uploads a cover photo to [path] ("<my user id>/<file name>"). Replaces a picture that is there already. */
    suspend fun uploadCover(path: String, jpeg: ByteArray) {
        val headers = config.headers(token ?: throw ServerException("signed_out", 0)) + mapOf("Content-Type" to "image/jpeg", "x-upsert" to "true")
        val answer = poster.send("POST", config.cover(path), headers, jpeg)
        if (answer.code !in 200..299) throw ServerException(if ("JWT" in answer.body || "jwt" in answer.body) "expired" else "upload_${answer.code}", answer.code)
    }

    suspend fun deleteCover(path: String) {
        val answer = poster.send("DELETE", config.cover(path), config.headers(token ?: throw ServerException("signed_out", 0)), null)
        if (answer.code !in 200..299) throw ServerException("remove_${answer.code}", answer.code)
    }

    /**
     * The names of all the pictures in the folder of [userId], which has to be the caller's own:
     * the storage shows everybody their own folder and nothing of anybody else's.
     */
    suspend fun listCovers(userId: String): List<String> {
        val headers = config.headers(token ?: throw ServerException("signed_out", 0))
        val names = mutableListOf<String>()
        // A page at a time, until one comes back that is not full. The bound is for a server that never stops.
        for (page in 0 until LIST_PAGES) {
            val asked = buildJsonObject { put("prefix", userId); put("limit", LIST_PAGE); put("offset", page * LIST_PAGE) }
            val answer = poster.post(config.coverList, headers, asked.toString())
            if (answer.code !in 200..299) throw ServerException("list_${answer.code}", answer.code)
            val entries = runCatching { json.parseToJsonElement(answer.body) as? JsonArray }.getOrNull() ?: throw ServerException("bad_answer", answer.code)
            names += entries.mapNotNull { (it as? JsonObject)?.text("name")?.takeIf(String::isNotBlank) }
            if (entries.size < LIST_PAGE) break
        }
        return names
    }

    private suspend fun call(function: String, arguments: JsonObject, signedIn: Boolean = true): JsonElement {
        if (signedIn && token == null) throw ServerException("signed_out", 0)
        val answer = poster.post(config.rpc(function), config.headers(token.takeIf { signedIn }), arguments.toString())
        if (answer.code in 200..299) {
            return runCatching { json.parseToJsonElement(answer.body) }.getOrElse { throw ServerException("bad_answer", answer.code) }
        }
        val error = runCatching { json.parseToJsonElement(answer.body).jsonObject }.getOrNull()
        val message = error?.get("message")?.let { (it as? JsonPrimitive)?.content }.orEmpty()
        val code = error?.get("code")?.let { (it as? JsonPrimitive)?.content }.orEmpty()
        throw ServerException(
            reason = when {
                message.startsWith(PREFIX) -> message.removePrefix(PREFIX)
                // The project answers, but schema.sql was not run there (or it is the older one).
                code == "PGRST202" || answer.code == 404 -> "setup"
                // A sign-in that ran out, or a function that nobody may call without one.
                code.startsWith("PGRST3") || message.contains("JWT", ignoreCase = true) -> "expired"
                code == "42501" -> "signed_out"
                answer.code == 401 || answer.code == 403 -> "key"
                else -> "http_${answer.code}"
            },
            status = answer.code,
        )
    }

    private fun JsonObject.list(name: String): List<JsonObject> = (get(name) as? JsonArray)?.jsonArray?.mapNotNull { it as? JsonObject }.orEmpty()

    companion object {
        private const val PREFIX = "shelfmark:"
        private const val LIST_PAGE = 100
        private const val LIST_PAGES = 200
        private val json = Json { ignoreUnknownKeys = true }

        private fun JsonObject.text(name: String): String = (get(name) as? JsonPrimitive)?.takeIf { it !is JsonNull }?.content.orEmpty()
        private fun JsonObject.number(name: String): Long? = (get(name) as? JsonPrimitive)?.longOrNull

        /**
         * A loan as the server tells it to one of its two sides (see "Loans" in supabase/README.md).
         * Null for what is no loan, and for a loan in a state this version of the app does not
         * know: showing that one with the wrong buttons would be worse than not showing it.
         */
        fun readLoan(element: JsonElement): Loan? {
            val tree = element as? JsonObject ?: return null
            val id = tree.text("id").ifBlank { return null }
            val state = LoanState.of(tree.text("state")) ?: return null
            val role = tree.text("role").takeIf { it == "lender" || it == "borrower" } ?: return null
            val book = tree["book"] as? JsonObject ?: JsonObject(emptyMap())
            return Loan(
                id = id,
                lender = role == "lender",
                peerId = tree.text("peer"),
                peerName = tree.text("peerName"),
                bookId = tree.number("bookId") ?: return null,
                title = book.text("title"),
                authors = book.text("authors"),
                isbn = book.text("isbn"),
                coverUrl = book.text("coverUrl"),
                pageCount = book.number("pageCount")?.toInt() ?: 0,
                format = BookFormat.entries.firstOrNull { it.name == book.text("format") } ?: BookFormat.UNKNOWN,
                note = tree.text("note"),
                state = state,
                reason = tree.text("reason"),
                dueOn = tree.number("dueOn"),
                askedAt = tree.number("askedAt") ?: 0,
                agreedAt = tree.number("agreedAt"),
                handedAt = tree.number("handedAt"),
                receivedAt = tree.number("receivedAt"),
                givenBackAt = tree.number("givenBackAt"),
                closedAt = tree.number("closedAt"),
                updatedAt = tree.number("updatedAt") ?: 0,
                byMe = (tree["byMe"] as? JsonPrimitive)?.content == "true",
            )
        }
    }
}

/** Who is signed in, and for how long the token is good. */
data class Session(val accessToken: String, val refreshToken: String, val expiresAt: Long, val userId: String, val email: String)

/**
 * Signing in did not work. [reason] is Supabase's own word for it where it has one:
 * invalid_credentials, user_already_exists, weak_password, email_not_confirmed,
 * validation_failed, email_address_invalid, signup_disabled, refresh_token_not_found,
 * over_email_send_rate_limit, over_request_rate_limit. Otherwise "http_NNN".
 */
class AuthException(val reason: String, val status: Int) : IOException("Sign-in: $reason ($status)")

/** Accounts: Supabase Auth with e-mail and password, the few calls of it the app needs. */
class AuthApi(private val config: ServerConfig, private val poster: HttpPoster, private val now: () -> Long = System::currentTimeMillis) {

    /**
     * Creates an account. Returns the sign-in, or null when the address has to be confirmed by mail first.
     * [returnTo] is the page the link in that mail leads to once Supabase has checked it. Without
     * one, Supabase sends people to the address in its own settings, which may be no page of ours.
     */
    suspend fun signUp(email: String, password: String, returnTo: String? = null): Session? {
        val path = if (returnTo.isNullOrBlank()) "signup" else "signup?redirect_to=" + java.net.URLEncoder.encode(returnTo, "UTF-8")
        return session(post(path, buildJsonObject { put("email", email.trim()); put("password", password) }))
    }

    suspend fun signIn(email: String, password: String): Session =
        session(post("token?grant_type=password", buildJsonObject { put("email", email.trim()); put("password", password) }))
            ?: throw AuthException("bad_answer", 200)

    /** Trades the long-lived token for a fresh sign-in. The old one stops working. */
    suspend fun refresh(refreshToken: String): Session =
        session(post("token?grant_type=refresh_token", buildJsonObject { put("refresh_token", refreshToken) })) ?: throw AuthException("bad_answer", 200)

    /**
     * Ends the sign-in of this device. Supabase would end every sign-in of the account when it
     * is not told otherwise, and with it the one on the reader's other phone and in their browser.
     */
    suspend fun signOut(accessToken: String) {
        post("logout?scope=local", buildJsonObject { }, accessToken)
    }

    /** Has Supabase send a mail with a link for choosing a new password. */
    suspend fun recover(email: String) {
        post("recover", buildJsonObject { put("email", email.trim()) })
    }

    private suspend fun post(path: String, body: JsonObject, token: String? = null): JsonObject? {
        val answer = poster.post(config.auth(path), config.headers(token), body.toString())
        val tree = runCatching { json.parseToJsonElement(answer.body) as? JsonObject }.getOrNull()
        if (answer.code in 200..299) return tree
        val reason = (tree?.get("error_code") as? JsonPrimitive)?.content
            ?: (tree?.get("error") as? JsonPrimitive)?.content
            ?: if (answer.code == 429) "over_request_rate_limit" else "http_${answer.code}"
        throw AuthException(reason, answer.code)
    }

    private fun session(tree: JsonObject?): Session? {
        val token = (tree?.get("access_token") as? JsonPrimitive)?.content ?: return null
        val user = tree["user"] as? JsonObject
        val expiresIn = (tree["expires_in"] as? JsonPrimitive)?.content?.toLongOrNull() ?: 3600
        return Session(
            accessToken = token,
            refreshToken = (tree["refresh_token"] as? JsonPrimitive)?.content.orEmpty(),
            expiresAt = (tree["expires_at"] as? JsonPrimitive)?.content?.toLongOrNull() ?: (now() / 1000 + expiresIn),
            userId = (user?.get("id") as? JsonPrimitive)?.content.orEmpty(),
            email = (user?.get("email") as? JsonPrimitive)?.content.orEmpty(),
        )
    }

    private companion object {
        val json = Json { ignoreUnknownKeys = true }
    }
}
