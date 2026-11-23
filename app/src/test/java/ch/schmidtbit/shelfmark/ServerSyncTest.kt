package ch.schmidtbit.shelfmark

import android.content.Context
import androidx.datastore.preferences.core.PreferenceDataStoreFactory
import androidx.test.core.app.ApplicationProvider
import ch.schmidtbit.shelfmark.data.db.AppDatabase
import ch.schmidtbit.shelfmark.data.model.Book
import ch.schmidtbit.shelfmark.data.model.FriendBook
import ch.schmidtbit.shelfmark.data.model.LendStatus
import ch.schmidtbit.shelfmark.data.model.Quote
import ch.schmidtbit.shelfmark.data.model.ReadingStatus
import ch.schmidtbit.shelfmark.data.repo.BackupManager
import ch.schmidtbit.shelfmark.data.repo.CoverStore
import ch.schmidtbit.shelfmark.data.repo.Keep
import ch.schmidtbit.shelfmark.data.repo.LibraryRepository
import ch.schmidtbit.shelfmark.data.repo.ServerSync
import ch.schmidtbit.shelfmark.data.repo.SettingsRepository
import ch.schmidtbit.shelfmark.data.repo.SocialRepository
import ch.schmidtbit.shelfmark.data.repo.SyncResult
import ch.schmidtbit.shelfmark.data.server.AuthApi
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
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.long
import kotlinx.serialization.json.longOrNull
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
import java.io.File
import java.io.IOException
import java.util.UUID

/**
 * The server, rebuilt in memory with the rules of supabase/schema.sql and of Supabase's
 * sign-in, so the app's side can be tested without a network. [LiveServerTest] runs the
 * same stories against the real SQL.
 */
class FakeServer : HttpPoster {
    private class User(val id: String, val password: String, var confirmed: Boolean)
    private class Profile(var name: String, var code: String)
    private class Message(val id: String, val to: String, val from: String, val payload: JsonElement, val at: Long)
    private class Vault(var revision: Long, var payload: JsonElement)

    private val users = LinkedHashMap<String, User>()
    private val tokens = HashMap<String, Pair<String, Long>>()
    private val refreshTokens = HashMap<String, String>()
    private val profiles = LinkedHashMap<String, Profile>()
    private val friendships = HashSet<Pair<String, String>>()
    private val libraries = HashMap<String, Pair<Long, JsonElement>>()
    private val messages = ArrayList<Message>()
    private val vaults = HashMap<String, Vault>()
    /** Cover photos by their path, "<user id>/<file name>". */
    val pictures = HashMap<String, ByteArray>()
    private var stamp = 1_000L
    private var codes = 0

    /** Set to make every call fail the way a phone without reception does. */
    var offline = false
    /** New accounts have to confirm their address before they can sign in, as on a project that asks for it. */
    var confirmEmail = false
    /** The clock of the server, in milliseconds. Tokens run out by it. */
    var time = 1_795_400_000_000L
    var tokenSeconds = 3600L
    val calls = HashMap<String, Int>()
    /** Where the last sign-up asked the confirmation mail to lead back to, if it named a page. */
    var returnTo: String? = null

    fun knows(email: String): Boolean = users[email.lowercase()]?.let { it.id in profiles } == true
    fun hasAccount(email: String): Boolean = email.lowercase() in users
    fun idOf(email: String): String = users.getValue(email.lowercase()).id
    fun waitingFor(email: String): Int = users[email.lowercase()]?.let { user -> messages.count { it.to == user.id } } ?: 0
    fun revisionOf(email: String): Long = users[email.lowercase()]?.let { vaults[it.id]?.revision } ?: 0
    fun confirm(email: String) { users.getValue(email.lowercase()).confirmed = true }
    /** Ends every sign-in, as changing the password would. */
    fun revokeAll() { tokens.clear(); refreshTokens.clear() }

    private class Refusal(val reason: String) : Exception()
    private class AuthRefusal(val status: Int, val code: String) : Exception()
    private fun refuse(reason: String): Nothing = throw Refusal(reason)

    /** Looks random, but is the same in every run. */
    private fun newCode(): String = java.util.Random(7L + ++codes).let { random -> (1..10).map { "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[random.nextInt(32)] }.joinToString("") }

    private fun session(email: String, user: User): JsonObject {
        val access = "access-" + UUID.randomUUID()
        val refresh = "refresh-" + UUID.randomUUID()
        tokens[access] = user.id to time / 1000 + tokenSeconds
        refreshTokens[refresh] = email
        return buildJsonObject {
            put("access_token", access)
            put("refresh_token", refresh)
            put("expires_in", tokenSeconds)
            put("expires_at", time / 1000 + tokenSeconds)
            put("user", buildJsonObject { put("id", user.id); put("email", email) })
        }
    }

    override suspend fun post(url: String, headers: Map<String, String>, body: String): HttpAnswer {
        if (offline) throw IOException("no connection")
        if (headers["apikey"].isNullOrBlank()) return HttpAnswer(401, """{"message":"No API key found in request"}""")
        val args = Json.parseToJsonElement(body.ifBlank { "{}" }).jsonObject
        fun text(name: String) = (args[name] as? JsonPrimitive)?.content.orEmpty()
        return synchronized(this) {
            try {
                if ("/auth/v1/" in url) return@synchronized auth(url.substringAfter("/auth/v1/"), ::text)
                val function = url.substringAfterLast("/rpc/")
                calls[function] = (calls[function] ?: 0) + 1
                val bearer = headers["Authorization"]?.removePrefix("Bearer ")
                val caller = when {
                    bearer == null || bearer == headers["apikey"] -> null
                    else -> tokens[bearer]?.takeIf { it.second > time / 1000 }?.first
                        ?: return@synchronized HttpAnswer(401, """{"code":"PGRST301","message":"JWT expired"}""")
                }
                HttpAnswer(200, run(function, args, ::text, caller).toString())
            } catch (e: Refusal) {
                when (e.reason) {
                    "missing" -> HttpAnswer(404, """{"code":"PGRST202","message":"Could not find the function"}""")
                    "denied" -> HttpAnswer(401, """{"code":"42501","message":"permission denied for function"}""")
                    else -> HttpAnswer(400, buildJsonObject { put("code", "P0001"); put("message", "shelfmark:" + e.reason) }.toString())
                }
            } catch (e: AuthRefusal) {
                HttpAnswer(e.status, buildJsonObject { put("code", e.status); put("error_code", e.code); put("msg", e.code) }.toString())
            }
        }
    }

    override suspend fun send(method: String, url: String, headers: Map<String, String>, body: ByteArray?): HttpAnswer {
        if (offline) throw IOException("no connection")
        val path = url.substringAfter("/storage/v1/object/shelfmark-covers/", "").ifBlank { return HttpAnswer(404, "{}") }
        val caller = headers["Authorization"]?.removePrefix("Bearer ")?.let { tokens[it] }?.takeIf { it.second > time / 1000 }?.first
        // Everybody writes below a folder named after their own user id, and nowhere else.
        if (caller == null || path.substringBefore('/') != caller) return HttpAnswer(400, """{"statusCode":"403","message":"new row violates row-level security policy"}""")
        if (method == "DELETE") pictures.remove(path) else pictures[path] = body ?: ByteArray(0)
        return HttpAnswer(200, "{}")
    }

    private fun auth(path: String, text: (String) -> String): HttpAnswer {
        calls[path.substringBefore('?')] = (calls[path.substringBefore('?')] ?: 0) + 1
        val email = text("email").trim().lowercase()
        return when {
            path.substringBefore('?') == "signup" -> {
                returnTo = path.substringAfter("redirect_to=", "").takeIf { it.isNotEmpty() }?.let { java.net.URLDecoder.decode(it, "UTF-8") }
                if ("@" !in email) throw AuthRefusal(400, "validation_failed")
                if (text("password").length < 6) throw AuthRefusal(422, "weak_password")
                if (email in users) throw AuthRefusal(422, "user_already_exists")
                val user = User(UUID.randomUUID().toString(), text("password"), confirmed = !confirmEmail)
                users[email] = user
                // With confirmation asked for, Supabase answers with the user and signs nobody in.
                HttpAnswer(200, (if (confirmEmail) buildJsonObject { put("id", user.id); put("email", email) } else session(email, user)).toString())
            }
            path == "token?grant_type=password" -> {
                val user = users[email]?.takeIf { it.password == text("password") } ?: throw AuthRefusal(400, "invalid_credentials")
                if (!user.confirmed) throw AuthRefusal(400, "email_not_confirmed")
                HttpAnswer(200, session(email, user).toString())
            }
            path == "token?grant_type=refresh_token" -> {
                // A refresh token works once: the next sign-in comes with a new one.
                val owner = refreshTokens.remove(text("refresh_token")) ?: throw AuthRefusal(400, "refresh_token_not_found")
                val user = users[owner] ?: throw AuthRefusal(400, "refresh_token_not_found")
                HttpAnswer(200, session(owner, user).toString())
            }
            path == "logout" -> HttpAnswer(204, "")
            path == "recover" -> HttpAnswer(200, "{}")
            else -> HttpAnswer(404, "{}")
        }
    }

    private fun run(function: String, args: JsonObject, text: (String) -> String, caller: String?): JsonElement {
        stamp += 10
        if (function == "shelfmark_ping") return buildJsonObject { put("ok", true); put("schema", 2) }
        // Everything else is for somebody who is signed in.
        val me = caller ?: refuse("denied")
        val profile = profiles.getOrPut(me) { Profile("", newCode()) }
        return when (function) {
            "shelfmark_hello" -> {
                (args["p_name"] as? JsonPrimitive)?.takeIf { it !is JsonNull }?.let { profile.name = it.content }
                buildJsonObject { put("id", me); put("code", profile.code); put("name", profile.name) }
            }
            "shelfmark_new_code" -> { profile.code = newCode(); buildJsonObject { put("code", profile.code) } }
            "shelfmark_add_friend" -> {
                val wanted = text("p_code").uppercase().filter { it.isLetterOrDigit() }
                val friend = profiles.entries.firstOrNull { it.value.code == wanted } ?: refuse("unknown_code")
                if (friend.key == me) refuse("own_code")
                friendships += me to friend.key
                friendships += friend.key to me
                buildJsonObject { put("id", friend.key); put("name", friend.value.name) }
            }
            "shelfmark_remove_friend" -> {
                val other = text("p_friend")
                friendships -= me to other
                friendships -= other to me
                messages.removeAll { (it.to == me && it.from == other) || (it.to == other && it.from == me) }
                buildJsonObject { put("ok", true) }
            }
            "shelfmark_publish" -> { libraries[me] = stamp to args.getValue("p_library"); buildJsonObject { put("at", stamp) } }
            "shelfmark_send" -> {
                if ((me to text("p_to")) !in friendships) refuse("not_friends")
                val message = Message(UUID.randomUUID().toString(), text("p_to"), me, args.getValue("p_payload"), stamp)
                messages += message
                buildJsonObject { put("id", message.id) }
            }
            "shelfmark_sync" -> {
                val ack = (args["p_ack"] as? JsonArray)?.map { it.jsonPrimitive.content }.orEmpty()
                messages.removeAll { it.to == me && it.id in ack }
                val known = (args["p_known"] as? JsonObject).orEmpty()
                val friends = friendships.filter { it.first == me }.map { it.second }.sorted()
                buildJsonObject {
                    put("id", me)
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
                        messages.filter { it.to == me }.forEach { m -> add(buildJsonObject { put("id", m.id); put("from", m.from); put("at", m.at); put("payload", m.payload) }) }
                    })
                }
            }
            "shelfmark_vault_pull" -> {
                val vault = vaults[me]
                val known = (args["p_known"] as? JsonPrimitive)?.longOrNull ?: 0
                buildJsonObject {
                    put("revision", vault?.revision ?: 0)
                    put("at", stamp)
                    put("payload", if (vault == null || vault.revision == known) JsonNull else vault.payload)
                }
            }
            "shelfmark_vault_push" -> {
                val expected = (args["p_expected"] as? JsonPrimitive)?.longOrNull
                val current = vaults[me]?.revision ?: 0
                if (expected != null && expected != current) refuse("conflict")
                vaults[me] = Vault(current + 1, args.getValue("p_payload"))
                buildJsonObject { put("revision", current + 1); put("at", stamp) }
            }
            "shelfmark_delete_account" -> {
                profiles.remove(me)
                vaults.remove(me)
                libraries.remove(me)
                friendships.removeAll { it.first == me || it.second == me }
                messages.removeAll { it.to == me || it.from == me }
                users.entries.removeAll { it.value.id == me }
                tokens.entries.removeAll { it.value.first == me }
                buildJsonObject { put("ok", true); put("login_kept", false) }
            }
            else -> refuse("missing")
        }
    }
}

/** One simulated device with its own database and settings, talking to a shared server. */
class Phone(
    context: Context,
    folder: TemporaryFolder,
    val name: String,
    poster: HttpPoster,
    config: ServerConfig?,
    clockDay: () -> Long = { 20_000 },
    clock: () -> Long = System::currentTimeMillis,
) {
    private val tag = "${name}_${UUID.randomUUID()}"
    val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    val db = AppDatabase.inMemory(context)
    val settings = SettingsRepository(PreferenceDataStoreFactory.create(scope = scope) { File(folder.root, "$tag.preferences_pb") })
    /** Every device keeps its photos in a folder of its own, as real phones do. */
    val covers = object : CoverStore(context) {
        override val dir: File get() = File(folder.root, "$tag.covers").apply { mkdirs() }
    }
    val library = LibraryRepository(db, covers)
    val social = SocialRepository(db, settings)
    val server = ServerSync(db, settings, social, BackupManager(db, covers), covers, config, poster, File(folder.root, "$tag.base.json"), now = clock, today = clockDay)
    /** An address nobody else has, also on a real server that other test runs use. */
    val email = "${name.lowercase()}-${UUID.randomUUID().toString().take(8)}@shelfmark.test"
    val password = "geheim-$name"
    val id: String get() = runBlocking { settings.current().userId }

    init {
        runBlocking { settings.setProfileName(name) }
    }

    suspend fun join(): SyncResult = server.signUp(email, password) ?: error("$name was asked to confirm an e-mail address")
    suspend fun titles(): List<String> = library.allBooks().map { it.title }.sorted()

    fun close() {
        db.close()
        scope.cancel()
    }
}

/** Stories told once and run against whatever server [poster] reaches. */
abstract class ServerStory {
    @get:Rule val folder = TemporaryFolder()
    protected val context: Context get() = ApplicationProvider.getApplicationContext()
    protected abstract val poster: HttpPoster
    protected abstract val config: ServerConfig
    private val phones = ArrayList<Phone>()

    protected fun phone(name: String, day: () -> Long = { 20_000 }, clock: () -> Long = System::currentTimeMillis) =
        Phone(context, folder, name, poster, config, day, clock).also { phones += it }

    /** A second device of the same person: nothing on it yet, signed in to the same account. */
    protected suspend fun secondDevice(of: Phone, name: String): Phone = phone(name).also { device ->
        assertTrue(device.server.signIn(of.email, of.password) is SyncResult.Done)
    }

    @After fun closePhones() {
        // Leaves a real server as it was found.
        phones.forEach { runBlocking { runCatching { it.server.deleteAccount() } }; it.close() }
    }

    @Test fun twoFriendsShareLibrariesAndLendABook() = runBlocking {
        val anna = phone("Anna")
        val ben = phone("Ben")
        // Nothing happens before somebody signs in.
        assertEquals(SyncResult.Off, anna.server.sync())

        val emma = anna.library.addBook(Book(title = "Emma", authors = "Jane Austen", status = ReadingStatus.READ, rating = 4.5f, lendable = true))
        anna.library.addBook(Book(title = "Persuasion", authors = "Jane Austen", lendable = false))
        assertTrue(anna.join() is SyncResult.Done)
        val annaCode = anna.settings.current().friendCode
        assertTrue("code: $annaCode", Regex("[A-HJ-NP-Z2-9]{10}").matches(annaCode))
        assertTrue(anna.settings.current().signedIn)
        assertEquals(anna.email, anna.settings.current().accountEmail)

        ben.library.addBook(Book(title = "Dune", authors = "Frank Herbert"))
        assertTrue(ben.join() is SyncResult.Done)

        // Ben types in Anna's code, the way people do.
        val typed = annaCode.lowercase().chunked(5).joinToString(" - ")
        assertEquals("Anna", ben.server.addFriend(typed).getOrThrow())
        val annaAtBen = ben.social.friends.first().single()
        assertEquals("Anna", annaAtBen.friend.name)
        assertEquals(anna.id, annaAtBen.friend.id)
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

        // Deleting the account takes everything off the server. The books on the phone stay.
        assertTrue(anna.server.deleteAccount())
        assertFalse(anna.settings.current().signedIn)
        assertEquals("", anna.settings.current().friendCode)
        assertEquals(SyncResult.Off, anna.server.sync())
        assertEquals(listOf("Emma", "Persuasion"), anna.titles())
        assertEquals("unknown_code", (ben.server.addFriend(fresh).exceptionOrNull() as ServerException).reason)
        assertEquals(SyncResult.Failed("invalid_credentials"), anna.server.signIn(anna.email, anna.password))
    }

    @Test fun oneLibraryOnEveryDevice() = runBlocking {
        val phone = phone("Anna")
        val emma = phone.library.addBook(Book(title = "Emma", authors = "Jane Austen", pageCount = 474))
        val dune = phone.library.addBook(Book(title = "Dune", authors = "Frank Herbert"))
        val list = phone.library.createShelf("Lieblinge")
        phone.library.setOnShelf(emma, list, true)
        phone.library.saveQuote(Quote(bookId = emma, text = "It is a truth universally acknowledged.", page = 1))
        phone.settings.setShareOptions(status = true, ratings = false)
        assertTrue(phone.join() is SyncResult.Done)

        // A new tablet, the same account: everything is simply there, the name and the settings too.
        val tablet = secondDevice(phone, "Tablet")
        assertEquals(listOf("Dune", "Emma"), tablet.titles())
        assertEquals("Lieblinge", tablet.library.shelves.first().single().name)
        assertEquals(1, tablet.library.links.first().size)
        assertEquals("It is a truth universally acknowledged.", tablet.library.quotes.first().single().quote.text)
        assertEquals("Anna", tablet.settings.current().profileName)
        assertFalse(tablet.settings.current().shareRatings)
        assertEquals(phone.id, tablet.id)

        // A change on the tablet shows up on the phone, without either being asked anything.
        tablet.library.modify(emma) { it.copy(rating = 5f, status = ReadingStatus.READ) }
        assertTrue(tablet.server.sync() is SyncResult.Done)
        assertTrue(phone.server.sync() is SyncResult.Done)
        assertEquals(5f, phone.library.getBook(emma)!!.rating)

        // Both change something while the other is not looking: neither change is lost.
        phone.library.modify(dune) { it.copy(review = "Sand.") }
        val added = phone.library.addBook(Book(title = "Momo", authors = "Michael Ende"))
        tablet.library.modify(emma) { it.copy(review = "Wunderbar.") }
        tablet.library.addBook(Book(title = "Persuasion", authors = "Jane Austen"))
        tablet.library.createShelf("Urlaub")
        assertTrue(tablet.server.sync() is SyncResult.Done)
        assertTrue(phone.server.sync() is SyncResult.Done)
        assertTrue(tablet.server.sync() is SyncResult.Done)
        for (device in listOf(phone, tablet)) {
            assertEquals(device.name, listOf("Dune", "Emma", "Momo", "Persuasion"), device.titles())
            assertEquals(device.name, "Sand.", device.library.getBook(dune)!!.review)
            assertEquals(device.name, "Wunderbar.", device.library.getBook(emma)!!.review)
            assertEquals(device.name, setOf("Lieblinge", "Urlaub"), device.library.shelves.first().map { it.name }.toSet())
            assertEquals(device.name, 1, device.library.quotes.first().size)
        }

        // Deleted on one device, untouched on the other: gone. Deleted here, changed there: it stays.
        phone.library.deleteBook(added)
        tablet.library.modify(dune) { it.copy(rating = 3f) }
        phone.library.deleteBook(dune)
        assertTrue(phone.server.sync() is SyncResult.Done)
        assertTrue(tablet.server.sync() is SyncResult.Done)
        assertTrue(phone.server.sync() is SyncResult.Done)
        for (device in listOf(phone, tablet)) {
            assertEquals(device.name, listOf("Dune", "Emma", "Persuasion"), device.titles())
            assertEquals(device.name, 3f, device.library.getBook(dune)!!.rating)
        }

        // Nothing to do means nothing is sent.
        assertTrue(phone.server.sync() is SyncResult.Done)
        assertTrue(tablet.server.sync() is SyncResult.Done)

        // Signing out leaves the books where they are, and signing in again carries on.
        tablet.server.signOut()
        assertEquals(SyncResult.Off, tablet.server.sync())
        assertEquals(3, tablet.titles().size)
        tablet.library.modify(emma) { it.copy(spice = 2) }
        assertTrue(tablet.server.signIn(phone.email, phone.password) is SyncResult.Done)
        phone.server.sync()
        assertEquals(2, phone.library.getBook(emma)!!.spice)
    }

    @Test fun anAccountAndADeviceThatBothHaveBooksAskWhichCounts() = runBlocking {
        val first = phone("Anna")
        first.library.addBook(Book(title = "Emma"))
        first.library.addBook(Book(title = "Dune"))
        assertTrue(first.join() is SyncResult.Done)

        // Another phone that has been in use for a while signs in to that account.
        val second = phone("Zweit")
        second.library.addBook(Book(title = "Momo"))
        assertEquals(SyncResult.Choose(onAccount = 2, onDevice = 1), second.server.signIn(first.email, first.password))
        // Until that is answered nothing is touched, on either side.
        assertEquals(listOf("Momo"), second.titles())
        assertEquals(SyncResult.Choose(onAccount = 2, onDevice = 1), second.server.sync())
        assertTrue(second.server.choose(Keep.ACCOUNT) is SyncResult.Done)
        assertEquals(listOf("Dune", "Emma"), second.titles())

        // The other answer: this device's library replaces the one on the account.
        val third = phone("Dritt")
        third.library.addBook(Book(title = "Faust"))
        assertTrue(third.server.signIn(first.email, first.password) is SyncResult.Choose)
        assertTrue(third.server.choose(Keep.DEVICE) is SyncResult.Done)
        first.server.sync()
        second.server.sync()
        assertEquals(listOf("Faust"), first.titles())
        assertEquals(listOf("Faust"), second.titles())
    }

    @Test fun signingInGoesWrongInPlainWords() = runBlocking {
        val anna = phone("Anna")
        assertEquals(SyncResult.Failed("invalid_credentials"), anna.server.signIn(anna.email, anna.password))
        assertFalse(anna.settings.current().signedIn)
        assertTrue(anna.join() is SyncResult.Done)
        val other = phone("Doppelt")
        assertEquals(SyncResult.Failed("user_already_exists"), other.server.signUp(anna.email, "ein-anderes-passwort"))
        assertEquals(SyncResult.Failed("invalid_credentials"), other.server.signIn(anna.email, "falsches-passwort"))
        assertFalse(other.settings.current().signedIn)
        assertNull(anna.server.recover(anna.email))
    }

    @Test fun aStrangerLearnsNothing() = runBlocking {
        val anna = phone("Anna")
        val cleo = phone("Cleo")
        anna.library.addBook(Book(title = "Emma"))
        anna.join()
        cleo.join()
        // Without the code Cleo sees nobody, and cannot write to Anna.
        assertTrue(cleo.social.friends.first().isEmpty())
        val asCleo = ServerApi(config, poster, cleo.settings.current().accessToken)
        val refused = runCatching { asCleo.send(anna.id, ShareCodec.encodeElement(Envelope(type = Envelope.TYPE_REQUEST))) }
        assertEquals("not_friends", (refused.exceptionOrNull() as ServerException).reason)
        // Her library is her own: Cleo's is empty of Anna's books, whatever she asks for.
        assertNull(asCleo.vaultPull(0).payload?.toString()?.takeIf { "Emma" in it })
        // Without a sign-in there is no library, no friends, nothing but the daily check.
        val nobody = ServerApi(config, poster)
        nobody.ping()
        assertEquals("signed_out", (runCatching { nobody.vaultPull(0) }.exceptionOrNull() as ServerException).reason)
        val forged = runCatching { ServerApi(config, poster, "not-a-real-token").sync(emptyMap()) }.exceptionOrNull() as ServerException
        assertTrue(forged.reason, forged.reason in setOf("expired", "signed_out", "key"))
    }
}

@RunWith(RobolectricTestRunner::class)
class ServerSyncTest : ServerStory() {
    private val server = FakeServer()
    override val poster: HttpPoster get() = server
    override val config = ServerConfig("https://example.supabase.co", "sb_publishable_test")

    @Test fun nothingIsSentThatDidNotChange() = runBlocking {
        val anna = phone("Anna")
        val bookId = anna.library.addBook(Book(title = "Emma"))
        anna.join()
        assertEquals(1, server.calls["shelfmark_publish"])
        assertEquals(1, server.calls["shelfmark_vault_push"])
        assertEquals(1L, server.revisionOf(anna.email))
        anna.server.sync()
        anna.server.sync()
        assertEquals(1, server.calls["shelfmark_publish"])
        assertEquals(1, server.calls["shelfmark_vault_push"])
        assertEquals(1, server.calls["shelfmark_hello"])
        anna.library.modify(bookId) { it.copy(rating = 5f) }
        anna.server.sync()
        assertEquals(2, server.calls["shelfmark_publish"])
        assertEquals(2L, server.revisionOf(anna.email))
        // Sharing less is a change too, and a new name is told to the server.
        anna.settings.setShareOptions(status = true, ratings = false)
        anna.server.sync()
        assertEquals(3, server.calls["shelfmark_publish"])
        anna.settings.setProfileName("Anna B.")
        anna.server.sync()
        assertEquals(2, server.calls["shelfmark_hello"])
    }

    @Test fun aPhotographedCoverIsSeenOnEveryDevice() = runBlocking {
        val phone = phone("Anna")
        phone.covers.file("mine.jpg").writeBytes(byteArrayOf(1, 2, 3, 4))
        val photographed = phone.library.addBook(Book(title = "Emma", coverPath = "mine.jpg", coverUrl = "https://catalogue.example/emma.jpg"))
        phone.library.addBook(Book(title = "Dune", coverUrl = "https://catalogue.example/dune.jpg"))
        phone.join()

        // The photo was uploaded below the account's own folder, and the book now carries its address.
        val address = config.coverAddress(phone.id + "/mine.jpg")
        assertEquals(address, phone.library.getBook(photographed)!!.coverUrl)
        assertEquals(listOf<Byte>(1, 2, 3, 4), server.pictures.getValue(phone.id + "/mine.jpg").toList())
        // A cover from a catalogue is left alone, and nothing is uploaded twice.
        assertEquals(1, server.pictures.size)
        phone.server.sync()
        assertEquals(1, server.pictures.size)

        // On the tablet the file does not exist. The book shows the picture from its address.
        val tablet = secondDevice(phone, "Tablet")
        val there = tablet.library.getBook(photographed)!!
        assertEquals(address, there.coverUrl)
        assertEquals(address, ch.schmidtbit.shelfmark.ui.coverModelOf(tablet.covers.dir, there))
        assertEquals(phone.covers.file("mine.jpg"), ch.schmidtbit.shelfmark.ui.coverModelOf(phone.covers.dir, phone.library.getBook(photographed)!!))
        tablet.server.sync()
        assertEquals(1, server.pictures.size)

        // A new photo replaces the address. Deleting the account removes the pictures too.
        phone.covers.file("better.jpg").writeBytes(byteArrayOf(9))
        phone.library.modify(photographed) { it.copy(coverPath = "better.jpg") }
        phone.server.sync()
        assertEquals(config.coverAddress(phone.id + "/better.jpg"), phone.library.getBook(photographed)!!.coverUrl)
        assertTrue(phone.server.deleteAccount())
        assertNull(server.pictures[phone.id + "/better.jpg"])
    }

    @Test fun theShelfLooksTheSameEverywhere() = runBlocking {
        val phone = phone("Anna")
        phone.library.addBook(Book(title = "Emma"))
        phone.library.addOrnament("NONE", ch.schmidtbit.shelfmark.data.model.OrnamentKind.CAT, 1)
        phone.settings.setViewMode(ch.schmidtbit.shelfmark.data.repo.ViewMode.SPINES)
        phone.settings.setSort(ch.schmidtbit.shelfmark.data.repo.SortOrder.TITLE)
        phone.settings.setMotion(false)
        phone.settings.setTheme("midnight")
        phone.join()
        val tablet = secondDevice(phone, "Tablet")
        val there = tablet.settings.current()
        assertEquals(ch.schmidtbit.shelfmark.data.repo.ViewMode.SPINES, there.viewMode)
        assertEquals(ch.schmidtbit.shelfmark.data.repo.SortOrder.TITLE, there.sort)
        assertFalse(there.motion)
        assertEquals("midnight", there.theme)
        assertEquals(ch.schmidtbit.shelfmark.data.model.OrnamentKind.CAT, tablet.library.ornaments.first().single().kind)
        // Changing the view on the tablet changes it on the phone.
        tablet.settings.setViewMode(ch.schmidtbit.shelfmark.data.repo.ViewMode.LIST)
        tablet.server.sync()
        phone.server.sync()
        assertEquals(ch.schmidtbit.shelfmark.data.repo.ViewMode.LIST, phone.settings.current().viewMode)
    }

    @Test fun aSignInIsRenewedQuietly() = runBlocking {
        val anna = phone("Anna", clock = { server.time })
        anna.library.addBook(Book(title = "Emma"))
        anna.join()
        val first = anna.settings.current().accessToken
        // An hour later the token has run out. Nobody notices.
        server.time += 2 * 3600_000L
        assertTrue(anna.server.sync() is SyncResult.Done)
        assertNotEquals(first, anna.settings.current().accessToken)
        assertEquals(1, server.calls["token"]?.minus(0)?.coerceAtMost(1))

        // A sign-in that was ended elsewhere (a new password, say) signs this phone out. The books stay.
        server.time += 2 * 3600_000L
        server.revokeAll()
        assertEquals(SyncResult.Off, anna.server.sync())
        assertFalse(anna.settings.current().signedIn)
        assertEquals(listOf("Emma"), anna.titles())
        assertTrue(anna.server.signIn(anna.email, anna.password) is SyncResult.Done)
    }

    @Test fun aNewAccountMayHaveToConfirmItsAddress() = runBlocking {
        server.confirmEmail = true
        val anna = phone("Anna")
        anna.library.addBook(Book(title = "Emma"))
        assertNull(anna.server.signUp(anna.email, anna.password))
        assertFalse(anna.settings.current().signedIn)
        assertEquals(SyncResult.Failed("email_not_confirmed"), anna.server.signIn(anna.email, anna.password))
        server.confirm(anna.email)
        assertTrue(anna.server.signIn(anna.email, anna.password) is SyncResult.Done)
        assertEquals(1L, server.revisionOf(anna.email))
    }

    @Test fun withoutReceptionThingsWaitAndGoOutLater() = runBlocking {
        val anna = phone("Anna")
        val ben = phone("Ben")
        anna.library.addBook(Book(title = "Emma", lendable = true))
        anna.join()
        ben.join()
        ben.server.addFriend(anna.settings.current().friendCode).getOrThrow()
        val emma = ben.social.friendBooks(anna.id).first().single()

        server.offline = true
        assertFalse(ben.server.send(anna.id, ben.social.createRequest(emma, "")))
        assertEquals(1, ben.server.waiting.first())
        assertEquals(ServerSync.NETWORK, ben.server.status.value.error)
        assertEquals(SyncResult.Failed(ServerSync.NETWORK), ben.server.sync())
        assertEquals(0, server.waitingFor(anna.email))
        // Without reception a friend on the server cannot be removed either, and stays.
        assertFalse(ben.server.removeFriend(anna.id))
        assertEquals(1, ben.social.friends.first().size)
        assertEquals("network", (ben.server.addFriend("ABCDE-FGHJK").exceptionOrNull() as ServerException).reason)
        assertFalse(ben.server.deleteAccount())
        assertTrue(ben.settings.current().signedIn)
        assertEquals(SyncResult.Failed(ServerSync.NETWORK), phone("Offline").let { it.server.signIn(anna.email, anna.password) })
        // What was changed without reception waits too.
        ben.library.addBook(Book(title = "Im Funkloch"))

        server.offline = false
        assertTrue(ben.server.sync() is SyncResult.Done)
        assertEquals(0, ben.server.waiting.first())
        assertNull(ben.server.status.value.error)
        assertEquals(1, server.waitingFor(anna.email))
        assertEquals(1, (anna.server.sync() as SyncResult.Done).requests.size)
        assertEquals(0, server.waitingFor(anna.email))
        val tablet = secondDevice(ben, "Tablet")
        assertEquals(listOf("Im Funkloch"), tablet.titles())
        // The request Ben sent is part of his library, so his tablet knows about it too.
        assertEquals(1, tablet.social.requests.first().size)
    }

    @Test fun theDailyCheckRunsOnceADay() = runBlocking {
        var day = 20_000L
        val anna = phone("Anna", day = { day })
        // The check does not wait for anybody to sign in, and tells the server nothing about them.
        assertEquals(SyncResult.Off, anna.server.dailyCheck())
        assertEquals(1, server.calls["shelfmark_ping"])
        assertFalse(server.hasAccount(anna.email))
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
        // Once signed in, the check also brings everything up to date.
        anna.join()
        day++
        assertTrue(anna.server.dailyCheck() is SyncResult.Done)
        assertEquals(3, server.calls["shelfmark_ping"])
    }

    @Test fun nobodyCanSpeakInAnotherName() = runBlocking {
        val anna = phone("Anna")
        val ben = phone("Ben")
        val mallory = phone("Mallory")
        anna.library.addBook(Book(title = "Emma", lendable = true))
        listOf(anna, ben, mallory).forEach { it.join() }
        ben.server.addFriend(anna.settings.current().friendCode).getOrThrow()
        mallory.server.addFriend(ben.settings.current().friendCode).getOrThrow()

        // Mallory uploads a "library" that claims to be Anna's, and a request in Anna's name.
        val asMallory = ServerApi(config, server, mallory.settings.current().accessToken)
        val forged = anna.social.exportLibrary(includeStatus = true, includeRatings = true).let { it.copy(library = it.library!!.copy(books = emptyList())) }
        asMallory.publish(ShareCodec.encodeElement(forged))
        val dune = ben.library.addBook(Book(title = "Dune", lendable = true))
        val fake = anna.social.createRequest(FriendBook(friendId = ben.id, remoteId = dune, title = "Dune"), "")
        asMallory.send(ben.id, ShareCodec.encodeElement(fake))

        val result = ben.server.sync() as SyncResult.Done
        assertTrue(result.requests.isEmpty())
        assertTrue(ben.social.requests.first().isEmpty())
        // Anna's shelf at Ben's is untouched, and the bogus message is gone from the server.
        assertEquals(1, ben.social.friends.first().first { it.friend.id == anna.id }.bookCount)
        assertEquals(0, server.waitingFor(ben.email))
    }

    @Test fun keysOfBothKindsAreSentTheWayTheServerWantsThem() = runBlocking {
        val modern = ServerConfig.of("https://abc.supabase.co/", " sb_publishable_xyz ")!!
        assertEquals("https://abc.supabase.co/rest/v1/rpc/shelfmark_ping", modern.rpc("shelfmark_ping"))
        assertEquals("https://abc.supabase.co/auth/v1/signup", modern.auth("signup"))
        assertEquals("sb_publishable_xyz", modern.headers()["apikey"])
        assertNull(modern.headers()["Authorization"])
        // Somebody who is signed in is named by their token, whatever kind the project key is.
        assertEquals("Bearer my-token", modern.headers("my-token")["Authorization"])
        // The older kind of key is a token itself and stands in while nobody is signed in.
        val legacy = ServerConfig.of("https://abc.supabase.co", "eyJhbGciOi.payload.signature")!!
        assertEquals("Bearer eyJhbGciOi.payload.signature", legacy.headers()["Authorization"])
        assertEquals("Bearer my-token", legacy.headers("my-token")["Authorization"])
        assertNull(ServerConfig.of("", "key"))
        assertNull(ServerConfig.of("https://abc.supabase.co", ""))
        assertNull(ServerConfig.of("abc.supabase.co", "key"))

        // A project without the Shelfmark functions, a wrong key and a broken answer are told apart.
        val missing = runCatching { ServerApi(modern, HttpPoster { _, _, _ -> HttpAnswer(404, """{"code":"PGRST202","message":"Could not find the function"}""") }).ping() }
        assertEquals("setup", (missing.exceptionOrNull() as ServerException).reason)
        val denied = runCatching { ServerApi(modern, HttpPoster { _, _, _ -> HttpAnswer(401, """{"message":"Invalid API key"}""") }).ping() }
        assertEquals("key", (denied.exceptionOrNull() as ServerException).reason)
        val broken = runCatching { ServerApi(modern, HttpPoster { _, _, _ -> HttpAnswer(500, "<html>oops</html>") }).ping() }
        assertEquals("http_500", (broken.exceptionOrNull() as ServerException).reason)
        // Too many attempts is something the user can be told.
        val limited = runCatching { AuthApi(modern, HttpPoster { _, _, _ -> HttpAnswer(429, """{"code":429,"error_code":"over_request_rate_limit","msg":"slow down"}""") }).signIn("a@b.c", "x") }
        assertEquals("over_request_rate_limit", (limited.exceptionOrNull() as ch.schmidtbit.shelfmark.data.server.AuthException).reason)
    }

    @Test fun withoutAServerThereIsNoAccountToHave() = runBlocking {
        val lonely = Phone(context, folder, "Lonely", server, config = null)
        try {
            assertFalse(lonely.server.available)
            assertEquals(SyncResult.Failed(ServerSync.NO_SERVER), lonely.server.signIn("a@b.c", "geheim1"))
            assertEquals(SyncResult.Off, lonely.server.dailyCheck())
            assertTrue(server.calls.isEmpty())
        } finally {
            lonely.close()
        }
    }
}

/**
 * The same stories against the real SQL of supabase/schema.sql and a real sign-in, over
 * HTTP. Runs only when a server is named:
 * SHELFMARK_SERVER_URL=http://127.0.0.1:54330 SHELFMARK_SERVER_KEY=... (see supabase/dev_server.py).
 * Not for a server where new accounts have to confirm their address: these accounts are made up.
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
