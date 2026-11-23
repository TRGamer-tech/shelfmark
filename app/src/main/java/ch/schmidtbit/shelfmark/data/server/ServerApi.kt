package ch.schmidtbit.shelfmark.data.server

import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.long
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

class OkHttpPoster(private val client: OkHttpClient) : HttpPoster {
    override suspend fun post(url: String, headers: Map<String, String>, body: String): HttpAnswer =
        run(Request.Builder().url(url).post(body.toRequestBody(JSON)).apply { headers.forEach { (k, v) -> header(k, v) } }.build())

    override suspend fun send(method: String, url: String, headers: Map<String, String>, body: ByteArray?): HttpAnswer {
        val content = body?.toRequestBody(headers["Content-Type"]?.toMediaTypeOrNull())
        return run(Request.Builder().url(url).method(method, content).apply { headers.forEach { (k, v) -> header(k, v) } }.build())
    }

    private suspend fun run(request: Request): HttpAnswer = suspendCancellableCoroutine { cont ->
        val call = client.newCall(request)
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

    private companion object {
        val JSON = "application/json; charset=utf-8".toMediaType()
    }
}

/**
 * The server said no. [reason] is one of the words the server functions use
 * (signed_out, unknown_code, own_code, not_friends, too_large, full, bad_request, conflict),
 * "expired" for a sign-in that has to be renewed, "setup" when the project does not have
 * the Shelfmark functions, "key" for a project key that is not accepted, or "http_NNN".
 */
class ServerException(val reason: String, val status: Int) : IOException("Server: $reason ($status)")

data class Registration(val id: String, val code: String, val name: String)
data class RemoteFriend(val id: String, val name: String)
data class RemoteLibrary(val owner: String, val at: Long, val payload: JsonElement)
data class RemoteMessage(val id: String, val from: String, val at: Long, val payload: JsonElement)

data class SyncAnswer(
    val id: String,
    val code: String,
    val friends: List<RemoteFriend>,
    val libraries: List<RemoteLibrary>,
    val messages: List<RemoteMessage>,
)

/** The library of an account as the server holds it. [payload] is null when the caller has this revision already. */
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

    suspend fun send(to: String, payload: JsonElement) {
        call("shelfmark_send", buildJsonObject { put("p_to", to); put("p_payload", payload) })
    }

    /** [known] maps a friend's id to the library version this phone has, [ack] names messages that were handled. */
    suspend fun sync(known: Map<String, Long>, ack: List<String> = emptyList()): SyncAnswer {
        val answer = call(
            "shelfmark_sync",
            buildJsonObject {
                put("p_known", JsonObject(known.mapValues { JsonPrimitive(it.value) }))
                put("p_ack", JsonArray(ack.map { JsonPrimitive(it) }))
            },
        ).jsonObject
        return SyncAnswer(
            id = answer.text("id"),
            code = answer.text("code"),
            friends = answer.list("friends").map { RemoteFriend(it.text("id"), it.text("name")) },
            libraries = answer.list("libraries").map { RemoteLibrary(it.text("owner"), it.getValue("at").jsonPrimitive.long, it.getValue("payload")) },
            messages = answer.list("messages").map { RemoteMessage(it.text("id"), it.text("from"), it.getValue("at").jsonPrimitive.long, it.getValue("payload")) },
        )
    }

    /** My whole library. Costs next to nothing when [known] is still the revision on the server. */
    suspend fun vaultPull(known: Long): VaultAnswer {
        val answer = call("shelfmark_vault_pull", buildJsonObject { put("p_known", known) }).jsonObject
        return VaultAnswer(answer.getValue("revision").jsonPrimitive.long, answer["payload"]?.takeIf { it is JsonObject })
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
        poster.send("DELETE", config.cover(path), config.headers(token ?: throw ServerException("signed_out", 0)), null)
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

    private fun JsonObject.text(name: String): String = (get(name) as? JsonPrimitive)?.content.orEmpty()
    private fun JsonObject.list(name: String): List<JsonObject> = (get(name) as? JsonArray)?.jsonArray?.map { it.jsonObject }.orEmpty()

    private companion object {
        const val PREFIX = "shelfmark:"
        val json = Json { ignoreUnknownKeys = true }
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

    suspend fun signOut(accessToken: String) {
        post("logout", buildJsonObject { }, accessToken)
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
