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

    /**
     * The project key always travels as "apikey". Only the older kind of key, which is a
     * signed token, may also be sent as a bearer token. The newer kind (sb_publishable_...)
     * is rejected there.
     */
    fun headers(): Map<String, String> = buildMap {
        put("apikey", key)
        if (!key.startsWith("sb_")) put("Authorization", "Bearer $key")
    }

    companion object {
        fun of(url: String, key: String): ServerConfig? = ServerConfig(url.trim().trimEnd('/'), key.trim()).takeIf { it.valid }
    }
}

data class HttpAnswer(val code: Int, val body: String)

/** Minimal POST abstraction, so the server client can be tested without a network. */
fun interface HttpPoster {
    suspend fun post(url: String, headers: Map<String, String>, body: String): HttpAnswer
}

class OkHttpPoster(private val client: OkHttpClient) : HttpPoster {
    override suspend fun post(url: String, headers: Map<String, String>, body: String): HttpAnswer = suspendCancellableCoroutine { cont ->
        val request = Request.Builder().url(url).post(body.toRequestBody(JSON)).apply { headers.forEach { (k, v) -> header(k, v) } }.build()
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
 * (forbidden, unknown_code, own_code, not_friends, too_large, full, bad_request),
 * "setup" when the project does not have the Shelfmark functions, or "http_NNN".
 */
class ServerException(val reason: String, val status: Int) : IOException("Server: $reason ($status)")

data class Registration(val code: String, val name: String)
data class RemoteFriend(val id: String, val name: String)
data class RemoteLibrary(val owner: String, val at: Long, val payload: JsonElement)
data class RemoteMessage(val id: String, val from: String, val at: Long, val payload: JsonElement)

data class SyncAnswer(
    val code: String,
    val friends: List<RemoteFriend>,
    val libraries: List<RemoteLibrary>,
    val messages: List<RemoteMessage>,
)

/** The handful of calls the app makes. Each is one function of supabase/schema.sql. */
class ServerApi(private val config: ServerConfig, private val poster: HttpPoster) {

    /** The daily check. Returns normally when the server answered. */
    suspend fun ping() {
        call("shelfmark_ping", buildJsonObject { })
    }

    suspend fun register(id: String, secret: String, name: String): Registration {
        val answer = call("shelfmark_register", me(id, secret) { put("p_name", name) }).jsonObject
        return Registration(answer.text("code"), answer.text("name"))
    }

    suspend fun newCode(id: String, secret: String): String =
        call("shelfmark_new_code", me(id, secret)).jsonObject.text("code")

    suspend fun addFriend(id: String, secret: String, code: String): RemoteFriend {
        val answer = call("shelfmark_add_friend", me(id, secret) { put("p_code", code) }).jsonObject
        return RemoteFriend(answer.text("id"), answer.text("name"))
    }

    suspend fun removeFriend(id: String, secret: String, friendId: String) {
        call("shelfmark_remove_friend", me(id, secret) { put("p_friend", friendId) })
    }

    /** Returns the version the server gave the library. */
    suspend fun publish(id: String, secret: String, library: JsonElement): Long =
        call("shelfmark_publish", me(id, secret) { put("p_library", library) }).jsonObject.getValue("at").jsonPrimitive.long

    suspend fun send(id: String, secret: String, to: String, payload: JsonElement) {
        call("shelfmark_send", me(id, secret) { put("p_to", to); put("p_payload", payload) })
    }

    /** [known] maps a friend's id to the library version this phone has, [ack] names messages that were handled. */
    suspend fun sync(id: String, secret: String, known: Map<String, Long>, ack: List<String> = emptyList()): SyncAnswer {
        val answer = call(
            "shelfmark_sync",
            me(id, secret) {
                put("p_known", JsonObject(known.mapValues { JsonPrimitive(it.value) }))
                put("p_ack", JsonArray(ack.map { JsonPrimitive(it) }))
            },
        ).jsonObject
        return SyncAnswer(
            code = answer.text("code"),
            friends = answer.list("friends").map { RemoteFriend(it.text("id"), it.text("name")) },
            libraries = answer.list("libraries").map { RemoteLibrary(it.text("owner"), it.getValue("at").jsonPrimitive.long, it.getValue("payload")) },
            messages = answer.list("messages").map { RemoteMessage(it.text("id"), it.text("from"), it.getValue("at").jsonPrimitive.long, it.getValue("payload")) },
        )
    }

    suspend fun deleteAccount(id: String, secret: String) {
        call("shelfmark_delete_account", me(id, secret))
    }

    private fun me(id: String, secret: String, more: kotlinx.serialization.json.JsonObjectBuilder.() -> Unit = {}): JsonObject = buildJsonObject {
        put("p_id", id)
        put("p_secret", secret)
        more()
    }

    private suspend fun call(function: String, arguments: JsonObject): JsonElement {
        val headers = config.headers() + mapOf("Content-Type" to "application/json", "Accept" to "application/json")
        val answer = poster.post(config.rpc(function), headers, arguments.toString())
        if (answer.code in 200..299) {
            return runCatching { json.parseToJsonElement(answer.body) }.getOrElse { throw ServerException("bad_answer", answer.code) }
        }
        val error = runCatching { json.parseToJsonElement(answer.body).jsonObject }.getOrNull()
        val message = error?.get("message")?.let { (it as? JsonPrimitive)?.content }.orEmpty()
        val code = error?.get("code")?.let { (it as? JsonPrimitive)?.content }.orEmpty()
        throw ServerException(
            reason = when {
                message.startsWith(PREFIX) -> message.removePrefix(PREFIX)
                // The project answers, but schema.sql was not run there (or the Data API is off).
                code == "PGRST202" || answer.code == 404 -> "setup"
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
