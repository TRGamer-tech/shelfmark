package ch.schmidtbit.shelfmark

import android.content.Context
import androidx.datastore.preferences.core.PreferenceDataStoreFactory
import androidx.test.core.app.ApplicationProvider
import ch.schmidtbit.shelfmark.data.db.AppDatabase
import ch.schmidtbit.shelfmark.data.model.Book
import ch.schmidtbit.shelfmark.data.model.LendStatus
import ch.schmidtbit.shelfmark.data.model.ReadingStatus
import ch.schmidtbit.shelfmark.data.repo.CoverStore
import ch.schmidtbit.shelfmark.data.repo.ImportResult
import ch.schmidtbit.shelfmark.data.repo.LibraryRepository
import ch.schmidtbit.shelfmark.data.repo.ServerSync
import ch.schmidtbit.shelfmark.data.repo.SettingsRepository
import ch.schmidtbit.shelfmark.data.repo.SocialRepository
import ch.schmidtbit.shelfmark.data.repo.SyncResult
import ch.schmidtbit.shelfmark.data.server.HttpAnswer
import ch.schmidtbit.shelfmark.data.server.HttpPoster
import ch.schmidtbit.shelfmark.data.server.OkHttpPoster
import ch.schmidtbit.shelfmark.data.server.ServerApi
import ch.schmidtbit.shelfmark.data.server.ServerConfig
import ch.schmidtbit.shelfmark.data.server.ServerException
import ch.schmidtbit.shelfmark.data.share.Envelope
import ch.schmidtbit.shelfmark.data.share.ShareCodec
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.long
import kotlinx.serialization.json.put
import okhttp3.OkHttpClient
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import java.io.IOException
import java.util.UUID

/**
 * The server, rebuilt in memory with the rules of supabase/schema.sql, so the app's side
 * can be tested without a network. [LiveServerTest] runs the same story against the real SQL.
 */
class FakeServer : HttpPoster {
    private class Profile(val secret: String, var name: String, var code: String)
    private class Message(val id: String, val to: String, val from: String, val payload: JsonElement, val at: Long)

    private val profiles = LinkedHashMap<String, Profile>()
    private val friendships = HashSet<Pair<String, String>>()
    private val libraries = HashMap<String, Pair<Long, JsonElement>>()
    private val messages = ArrayList<Message>()
    private var clock = 1_000L
    private var codes = 0

    /** Set to make every call fail the way a phone without reception does. */
    var offline = false
    val calls = HashMap<String, Int>()
    val lastHeaders = HashMap<String, String>()

    fun forget(id: String) {
        profiles.remove(id)
        friendships.removeAll { it.first == id || it.second == id }
        libraries.remove(id)
        messages.removeAll { it.to == id || it.from == id }
    }

    fun knows(id: String): Boolean = id in profiles
    fun waitingFor(id: String): Int = messages.count { it.to == id }

    private fun refuse(reason: String): Nothing = throw Refusal(reason)
    private class Refusal(val reason: String) : Exception()

    private fun newCode(): String = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789".let { a -> (++codes).toString(32).padStart(10, '2').map { a[it.digitToInt(32)] }.joinToString("") }

    override suspend fun post(url: String, headers: Map<String, String>, body: String): HttpAnswer {
        if (offline) throw IOException("no connection")
        lastHeaders.clear(); lastHeaders.putAll(headers)
        val function = url.substringAfterLast("/rpc/")
        calls[function] = (calls[function] ?: 0) + 1
        val args = Json.parseToJsonElement(body).jsonObject
        fun text(name: String) = (args[name] as? JsonPrimitive)?.content.orEmpty()
        return try {
            val answer: JsonElement = synchronized(this) { run(function, args, ::text) }
            HttpAnswer(200, answer.toString())
        } catch (e: Refusal) {
            if (e.reason == "missing") HttpAnswer(404, """{"code":"PGRST202","message":"Could not find the function"}""")
            else HttpAnswer(400, buildJsonObject { put("code", "P0001"); put("message", "shelfmark:" + e.reason) }.toString())
        }
    }

    private fun run(function: String, args: JsonObject, text: (String) -> String): JsonElement {
        val id = text("p_id")
        fun me(): Profile = profiles[id]?.takeIf { it.secret == text("p_secret") } ?: refuse("forbidden")
        clock += 10
        return when (function) {
            "shelfmark_ping" -> buildJsonObject { put("ok", true) }
            "shelfmark_register" -> {
                if (text("p_secret").length < 32) refuse("bad_request")
                val profile = profiles[id]
                when {
                    profile == null -> profiles[id] = Profile(text("p_secret"), text("p_name"), newCode())
                    profile.secret != text("p_secret") -> refuse("forbidden")
                    else -> profile.name = text("p_name")
                }
                buildJsonObject { put("id", id); put("code", profiles.getValue(id).code); put("name", profiles.getValue(id).name) }
            }
            "shelfmark_new_code" -> { me().code = newCode(); buildJsonObject { put("code", profiles.getValue(id).code) } }
            "shelfmark_add_friend" -> {
                me()
                val wanted = text("p_code").uppercase().filter { it.isLetterOrDigit() }
                val friend = profiles.entries.firstOrNull { it.value.code == wanted } ?: refuse("unknown_code")
                if (friend.key == id) refuse("own_code")
                friendships += id to friend.key
                friendships += friend.key to id
                buildJsonObject { put("id", friend.key); put("name", friend.value.name) }
            }
            "shelfmark_remove_friend" -> {
                me()
                val other = text("p_friend")
                friendships -= id to other
                friendships -= other to id
                messages.removeAll { (it.to == id && it.from == other) || (it.to == other && it.from == id) }
                buildJsonObject { put("ok", true) }
            }
            "shelfmark_publish" -> { me(); libraries[id] = clock to args.getValue("p_library"); buildJsonObject { put("at", clock) } }
            "shelfmark_send" -> {
                me()
                if ((id to text("p_to")) !in friendships) refuse("not_friends")
                val message = Message(UUID.randomUUID().toString(), text("p_to"), id, args.getValue("p_payload"), clock)
                messages += message
                buildJsonObject { put("id", message.id) }
            }
            "shelfmark_sync" -> {
                val profile = me()
                val ack = (args["p_ack"] as? JsonArray)?.map { it.jsonPrimitive.content }.orEmpty()
                messages.removeAll { it.to == id && it.id in ack }
                val known = (args["p_known"] as? JsonObject).orEmpty()
                val friends = friendships.filter { it.first == id }.map { it.second }.sorted()
                buildJsonObject {
                    put("code", profile.code)
                    put("name", profile.name)
                    put("friends", buildJsonArray { friends.forEach { f -> add(buildJsonObject { put("id", f); put("name", profiles.getValue(f).name) }) } })
                    put("libraries", buildJsonArray {
                        friends.forEach { f ->
                            val (at, payload) = libraries[f] ?: return@forEach
                            if (at > (known[f]?.jsonPrimitive?.long ?: 0)) add(buildJsonObject { put("owner", f); put("at", at); put("payload", payload) })
                        }
                    })
                    put("messages", buildJsonArray {
                        messages.filter { it.to == id }.forEach { m -> add(buildJsonObject { put("id", m.id); put("from", m.from); put("at", m.at); put("payload", m.payload) }) }
                    })
                }
            }
            "shelfmark_delete_account" -> { me(); forget(id); buildJsonObject { put("ok", true) } }
            else -> refuse("missing")
        }
    }
}

/** One simulated phone with its own database and settings, talking to a shared server. */
class Phone(context: Context, folder: TemporaryFolder, val name: String, poster: HttpPoster, config: ServerConfig?, clockDay: () -> Long = { 20_000 }) {
    val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    val db = AppDatabase.inMemory(context)
    val settings = SettingsRepository(PreferenceDataStoreFactory.create(scope = scope) { java.io.File(folder.root, "${name}_${UUID.randomUUID()}.preferences_pb") })
    val library = LibraryRepository(db, CoverStore(context))
    val social = SocialRepository(db, settings)
    val server = ServerSync(db, settings, social, config, poster, today = clockDay)
    val id: String get() = runBlocking { settings.ensureUserId() }

    init {
        runBlocking { settings.setProfileName(name) }
    }

    fun close() {
        db.close()
        scope.cancel()
    }
}

/** The story of two friends, told once and run against whatever server [poster] reaches. */
abstract class ServerStory {
    @get:Rule val folder = TemporaryFolder()
    protected val context: Context get() = ApplicationProvider.getApplicationContext()
    protected abstract val poster: HttpPoster
    protected abstract val config: ServerConfig
    private val phones = ArrayList<Phone>()

    protected fun phone(name: String, day: () -> Long = { 20_000 }) = Phone(context, folder, name, poster, config, day).also { phones += it }

    @After fun closePhones() {
        // Leaves a real server as it was found.
        phones.forEach { runBlocking { runCatching { it.server.disconnect() } }; it.close() }
    }

    @Test fun twoFriendsShareLibrariesAndLendABook() = runBlocking {
        val anna = phone("Anna")
        val ben = phone("Ben")
        // Nothing happens before somebody connects.
        assertEquals(SyncResult.Off, anna.server.sync())

        val emma = anna.library.addBook(Book(title = "Emma", authors = "Jane Austen", status = ReadingStatus.READ, rating = 4.5f, lendable = true))
        anna.library.addBook(Book(title = "Persuasion", authors = "Jane Austen", lendable = false))
        assertTrue(anna.server.connect() is SyncResult.Done)
        val annaCode = anna.settings.current().friendCode
        assertTrue("code: $annaCode", Regex("[A-HJ-NP-Z2-9]{10}").matches(annaCode))
        assertTrue(anna.settings.current().online)

        ben.library.addBook(Book(title = "Dune", authors = "Frank Herbert"))
        assertTrue(ben.server.connect() is SyncResult.Done)

        // Ben types in Anna's code, the way people do.
        val typed = annaCode.lowercase().chunked(5).joinToString(" - ")
        assertEquals("Anna", ben.server.addFriend(typed).getOrThrow())
        val annaAtBen = ben.social.friends.first().single()
        assertEquals("Anna", annaAtBen.friend.name)
        assertTrue(annaAtBen.friend.online)
        assertEquals(2, annaAtBen.bookCount)
        val emmaAtBen = ben.social.friendBooks(anna.id).first().first { it.title == "Emma" }
        assertTrue(emmaAtBen.available)
        assertEquals(4.5f, emmaAtBen.rating)

        // Anna did nothing, and has Ben as a friend all the same.
        assertTrue(anna.server.sync() is SyncResult.Done)
        val benAtAnna = anna.social.friends.first().single()
        assertEquals("Ben", benAtAnna.friend.name)
        assertEquals(1, benAtAnna.bookCount)
        assertTrue(anna.server.canReach(ben.id))

        // Ben asks for Emma. No file, no messenger.
        assertTrue(ben.server.send(anna.id, ben.social.createRequest(emmaAtBen, "Bitte!")))
        val arrived = anna.server.sync() as SyncResult.Done
        assertEquals("Emma", arrived.requests.single().bookTitle)
        assertEquals("Ben", arrived.requests.single().fromName)
        val request = anna.social.requests.first().single()
        assertTrue(request.incoming)
        assertEquals("Bitte!", request.note)
        // The server hands a message over once.
        assertTrue((anna.server.sync() as SyncResult.Done).requests.isEmpty())
        assertEquals(1, anna.social.requests.first().size)

        // Anna says yes. Her copy is marked as lent, and Ben learns both things.
        assertTrue(anna.server.send(ben.id, anna.social.answerRequest(request.id, true)!!))
        assertEquals("Ben", anna.library.getBook(emma)!!.lentTo)
        val news = ben.server.sync() as SyncResult.Done
        assertTrue(news.answers.single().accepted)
        assertEquals(LendStatus.ACCEPTED, ben.social.requests.first().single().status)
        assertFalse(ben.social.friendBooks(anna.id).first().first { it.title == "Emma" }.available)
        assertTrue((ben.server.sync() as SyncResult.Done).answers.isEmpty())

        // Wrong codes are told apart.
        assertEquals("unknown_code", (ben.server.addFriend("ZZZZZ-ZZZZZ").exceptionOrNull() as ServerException).reason)
        assertEquals("own_code", (ben.server.addFriend(ben.settings.current().friendCode).exceptionOrNull() as ServerException).reason)

        // A new code replaces the old one.
        val fresh = anna.server.newCode()!!
        assertNotEquals(annaCode, fresh)
        assertEquals(fresh, anna.settings.current().friendCode)

        // Ben ends the friendship. It ends for Anna too.
        assertTrue(ben.server.removeFriend(anna.id))
        assertTrue(ben.social.friends.first().isEmpty())
        anna.server.sync()
        assertTrue(anna.social.friends.first().isEmpty())
        assertFalse(anna.server.canReach(ben.id))

        // Leaving takes everything off the server.
        assertTrue(anna.server.disconnect())
        assertFalse(anna.settings.current().online)
        assertEquals("", anna.settings.current().friendCode)
        assertEquals(SyncResult.Off, anna.server.sync())
        assertEquals("unknown_code", (ben.server.addFriend(fresh).exceptionOrNull() as ServerException).reason)
    }

    @Test fun aStrangerLearnsNothing() = runBlocking {
        val anna = phone("Anna")
        val cleo = phone("Cleo")
        anna.library.addBook(Book(title = "Emma"))
        anna.server.connect()
        cleo.server.connect()
        // Without the code Cleo sees nobody, and cannot write to Anna.
        assertTrue(cleo.social.friends.first().isEmpty())
        val api = ServerApi(config, poster)
        val refused = runCatching { api.send(cleo.id, cleo.settings.current().serverSecret, anna.id, ShareCodec.encodeElement(Envelope(type = Envelope.TYPE_REQUEST))) }
        assertEquals("not_friends", (refused.exceptionOrNull() as ServerException).reason)
        // Knowing somebody's id is not enough to be them.
        val imposter = runCatching { api.sync(anna.id, "a-secret-that-is-long-enough-but-wrong", emptyMap()) }
        assertEquals("forbidden", (imposter.exceptionOrNull() as ServerException).reason)
    }
}

@RunWith(RobolectricTestRunner::class)
class ServerSyncTest : ServerStory() {
    private val server = FakeServer()
    override val poster: HttpPoster get() = server
    override val config = ServerConfig("https://example.supabase.co", "sb_publishable_test")

    @Test fun theLibraryIsOnlySentWhenItChanged() = runBlocking {
        val anna = phone("Anna")
        val bookId = anna.library.addBook(Book(title = "Emma"))
        anna.server.connect()
        assertEquals(1, server.calls["shelfmark_publish"])
        anna.server.sync()
        anna.server.sync()
        assertEquals(1, server.calls["shelfmark_publish"])
        assertEquals(1, server.calls["shelfmark_register"])
        anna.library.modify(bookId) { it.copy(rating = 5f) }
        anna.server.sync()
        assertEquals(2, server.calls["shelfmark_publish"])
        // Sharing less is a change too, and a new name registers again.
        anna.settings.setShareOptions(status = true, ratings = false)
        anna.server.sync()
        assertEquals(3, server.calls["shelfmark_publish"])
        anna.settings.setProfileName("Anna B.")
        anna.server.sync()
        assertEquals(2, server.calls["shelfmark_register"])
    }

    @Test fun withoutReceptionThingsWaitAndGoOutLater() = runBlocking {
        val anna = phone("Anna")
        val ben = phone("Ben")
        anna.library.addBook(Book(title = "Emma", lendable = true))
        anna.server.connect()
        ben.server.connect()
        ben.server.addFriend(anna.settings.current().friendCode).getOrThrow()
        val emma = ben.social.friendBooks(anna.id).first().single()

        server.offline = true
        assertFalse(ben.server.send(anna.id, ben.social.createRequest(emma, "")))
        assertEquals(1, ben.server.waiting.first())
        assertEquals(ServerSync.NETWORK, ben.server.status.value.error)
        assertEquals(SyncResult.Failed(ServerSync.NETWORK), ben.server.sync())
        assertEquals(0, server.waitingFor(anna.id))
        // Without reception a friend on the server cannot be removed either, and stays.
        assertFalse(ben.server.removeFriend(anna.id))
        assertEquals(1, ben.social.friends.first().size)
        assertEquals("network", (ben.server.addFriend("ABCDE-FGHJK").exceptionOrNull() as ServerException).reason)
        assertFalse(ben.server.disconnect())
        assertTrue(ben.settings.current().online)

        server.offline = false
        assertTrue(ben.server.sync() is SyncResult.Done)
        assertEquals(0, ben.server.waiting.first())
        assertNull(ben.server.status.value.error)
        assertEquals(1, server.waitingFor(anna.id))
        assertEquals(1, (anna.server.sync() as SyncResult.Done).requests.size)
        assertEquals(0, server.waitingFor(anna.id))
    }

    @Test fun theDailyCheckRunsOnceADay() = runBlocking {
        var day = 20_000L
        val anna = phone("Anna") { day }
        // The check does not wait for the user to connect, and tells the server nothing about them.
        assertEquals(SyncResult.Off, anna.server.dailyCheck())
        assertEquals(1, server.calls["shelfmark_ping"])
        assertFalse(server.knows(anna.id))
        anna.server.dailyCheck()
        assertEquals(1, server.calls["shelfmark_ping"])
        day++
        // A day without reception is made up for as soon as there is some.
        server.offline = true
        anna.server.dailyCheck()
        server.offline = false
        assertEquals(1, server.calls["shelfmark_ping"])
        anna.server.dailyCheck()
        assertEquals(2, server.calls["shelfmark_ping"])
        // Once connected, the check also brings friends up to date.
        anna.server.connect()
        day++
        assertTrue(anna.server.dailyCheck() is SyncResult.Done)
        assertEquals(3, server.calls["shelfmark_ping"])
    }

    @Test fun aProfileTheServerForgotIsCreatedAgain() = runBlocking {
        val anna = phone("Anna")
        anna.library.addBook(Book(title = "Emma"))
        anna.server.connect()
        server.forget(anna.id)
        assertTrue(anna.server.sync() is SyncResult.Done)
        assertTrue(server.knows(anna.id))
        assertEquals(2, server.calls["shelfmark_publish"])
    }

    @Test fun nobodyCanSpeakInAnotherName() = runBlocking {
        val anna = phone("Anna")
        val ben = phone("Ben")
        val mallory = phone("Mallory")
        anna.library.addBook(Book(title = "Emma", lendable = true))
        listOf(anna, ben, mallory).forEach { it.server.connect() }
        ben.server.addFriend(anna.settings.current().friendCode).getOrThrow()
        mallory.server.addFriend(ben.settings.current().friendCode).getOrThrow()

        // Mallory uploads a "library" that claims to be Anna's, and a request in Anna's name.
        val api = ServerApi(config, server)
        val secret = mallory.settings.current().serverSecret
        val forged = anna.social.exportLibrary(includeStatus = true, includeRatings = true).let { it.copy(library = it.library!!.copy(books = emptyList())) }
        api.publish(mallory.id, secret, ShareCodec.encodeElement(forged))
        val emma = ben.library.addBook(Book(title = "Dune", lendable = true))
        val fake = anna.social.createRequest(
            ch.schmidtbit.shelfmark.data.model.FriendBook(friendId = ben.id, remoteId = emma, title = "Dune"), "",
        )
        api.send(mallory.id, secret, ben.id, ShareCodec.encodeElement(fake))

        val result = ben.server.sync() as SyncResult.Done
        assertTrue(result.requests.isEmpty())
        assertTrue(ben.social.requests.first().isEmpty())
        // Anna's shelf at Ben's is untouched, and the bogus message is gone from the server.
        assertEquals(1, ben.social.friends.first().first { it.friend.id == anna.id }.bookCount)
        assertEquals(0, server.waitingFor(ben.id))
    }

    @Test fun keysOfBothKindsAreSentTheWayTheServerWantsThem() = runBlocking {
        val modern = ServerConfig.of("https://abc.supabase.co/", " sb_publishable_xyz ")!!
        assertEquals("https://abc.supabase.co/rest/v1/rpc/shelfmark_ping", modern.rpc("shelfmark_ping"))
        assertEquals(mapOf("apikey" to "sb_publishable_xyz"), modern.headers())
        // The older kind of key is a token and also goes into the Authorization header.
        val legacy = ServerConfig.of("https://abc.supabase.co", "eyJhbGciOi.payload.signature")!!
        assertEquals("Bearer eyJhbGciOi.payload.signature", legacy.headers()["Authorization"])
        assertNull(ServerConfig.of("", "key"))
        assertNull(ServerConfig.of("https://abc.supabase.co", ""))
        assertNull(ServerConfig.of("abc.supabase.co", "key"))

        // A project without the Shelfmark functions, and a wrong key, are told apart.
        val missing = runCatching { ServerApi(modern, HttpPoster { _, _, _ -> HttpAnswer(404, """{"code":"PGRST202","message":"Could not find the function"}""") }).ping() }
        assertEquals("setup", (missing.exceptionOrNull() as ServerException).reason)
        val denied = runCatching { ServerApi(modern, HttpPoster { _, _, _ -> HttpAnswer(401, """{"message":"Invalid API key"}""") }).ping() }
        assertEquals("key", (denied.exceptionOrNull() as ServerException).reason)
        val broken = runCatching { ServerApi(modern, HttpPoster { _, _, _ -> HttpAnswer(500, "<html>oops</html>") }).ping() }
        assertEquals("http_500", (broken.exceptionOrNull() as ServerException).reason)
    }

    @Test fun noServerMeansNoServer() = runBlocking {
        val lonely = Phone(context, folder, "Lonely", server, config = null)
        try {
            assertEquals(SyncResult.Failed(ServerSync.NO_SERVER), lonely.server.connect())
            assertEquals(SyncResult.Off, lonely.server.dailyCheck())
            assertTrue(server.calls.isEmpty())
            // A server typed into the settings is used instead of a built-in one.
            lonely.settings.setServer("https://own.example.org/", "sb_publishable_own")
            assertEquals(ServerConfig("https://own.example.org", "sb_publishable_own"), lonely.server.config())
            assertTrue(lonely.server.connect() is SyncResult.Done)
        } finally {
            lonely.close()
        }
    }
}

/**
 * The same story against the real SQL of supabase/schema.sql, through a real HTTP
 * connection. Runs only when a server is named:
 * SHELFMARK_SERVER_URL=http://127.0.0.1:54330 SHELFMARK_SERVER_KEY=... (see supabase/dev_server.py).
 */
@RunWith(RobolectricTestRunner::class)
class LiveServerTest : ServerStory() {
    private val url = System.getenv("SHELFMARK_SERVER_URL").orEmpty()
    override val poster: HttpPoster = OkHttpPoster(OkHttpClient())
    override val config = ServerConfig(url, System.getenv("SHELFMARK_SERVER_KEY").orEmpty())

    @org.junit.Before fun onlyWithAServer() = assumeTrue("set SHELFMARK_SERVER_URL to run", url.isNotBlank())

    @Test fun theServerAnswersTheDailyCheck() = runBlocking {
        ServerApi(config, poster).ping()
    }
}
