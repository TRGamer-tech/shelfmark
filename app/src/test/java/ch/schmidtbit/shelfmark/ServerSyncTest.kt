package ch.schmidtbit.shelfmark

import android.content.Context
import androidx.datastore.preferences.core.PreferenceDataStoreFactory
import androidx.test.core.app.ApplicationProvider
import ch.schmidtbit.shelfmark.data.db.AppDatabase
import ch.schmidtbit.shelfmark.data.model.Book
import ch.schmidtbit.shelfmark.data.model.BookFormat
import ch.schmidtbit.shelfmark.data.model.FriendBook
import ch.schmidtbit.shelfmark.data.model.Loan
import ch.schmidtbit.shelfmark.data.model.LoanAction
import ch.schmidtbit.shelfmark.data.model.LoanNewsKind
import ch.schmidtbit.shelfmark.data.model.LoanRules
import ch.schmidtbit.shelfmark.data.model.LoanState
import ch.schmidtbit.shelfmark.data.model.Ownership
import ch.schmidtbit.shelfmark.data.model.Quote
import ch.schmidtbit.shelfmark.data.model.ReadingStatus
import ch.schmidtbit.shelfmark.data.repo.BackupManager
import ch.schmidtbit.shelfmark.data.repo.CoverStore
import ch.schmidtbit.shelfmark.data.repo.Keep
import ch.schmidtbit.shelfmark.data.repo.LibraryRepository
import ch.schmidtbit.shelfmark.data.repo.LoanBooks
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
import ch.schmidtbit.shelfmark.data.share.ShareCodec
import ch.schmidtbit.shelfmark.ui.friends.loanProblemRes
import ch.schmidtbit.shelfmark.util.Dates
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonArray
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
    private class Vault(var revision: Long, var payload: JsonElement)

    /** A row of shelfmark.loans. */
    private class LoanRow(
        val id: String,
        val lender: String,
        val borrower: String,
        val bookId: Long,
        val book: JsonObject,
        val note: String,
        val askedAt: Long,
        var state: String = "asked",
        var reason: String = "",
        var dueOn: Long? = null,
        var agreedAt: Long? = null,
        var handedAt: Long? = null,
        var receivedAt: Long? = null,
        var givenBackAt: Long? = null,
        var closedAt: Long? = null,
        var updatedAt: Long = askedAt,
        var updatedBy: String? = null,
        var hiddenByLender: Boolean = false,
        var hiddenByBorrower: Boolean = false,
    )

    private val users = LinkedHashMap<String, User>()
    private val tokens = HashMap<String, Pair<String, Long>>()
    private val refreshTokens = HashMap<String, String>()
    private val profiles = LinkedHashMap<String, Profile>()
    private val friendships = HashSet<Pair<String, String>>()
    private val libraries = HashMap<String, Pair<Long, JsonElement>>()
    private val loans = ArrayList<LoanRow>()
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
    /** The server has sent all the mails it may for now: a new account that needs one is refused. */
    var mailsSpent = false
    /** Where the last sign-up asked the confirmation mail to lead back to, if it named a page. */
    var returnTo: String? = null
    /** A project whose schema.sql is the one from before the loans: it has no functions for them, and its sync names none. */
    var beforeLoans = false

    fun knows(email: String): Boolean = users[email.lowercase()]?.let { it.id in profiles } == true
    fun hasAccount(email: String): Boolean = email.lowercase() in users
    fun idOf(email: String): String = users.getValue(email.lowercase()).id
    /** The states of the loans somebody is part of, hidden ones included, in the order they were asked. */
    fun loanStatesOf(email: String): List<String> = users[email.lowercase()]?.let { user -> loans.filter { it.lender == user.id || it.borrower == user.id }.map { it.state } }.orEmpty()
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
                // The mail service that comes with Supabase sends very few mails per hour.
                if (confirmEmail && mailsSpent) throw AuthRefusal(429, "over_email_send_rate_limit")
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

    /** A loan as one of its two sides sees it, like shelfmark.loan_json. */
    private fun loanJson(loan: LoanRow, me: String): JsonObject {
        val peer = if (loan.lender == me) loan.borrower else loan.lender
        return buildJsonObject {
            put("id", loan.id)
            put("role", if (loan.lender == me) "lender" else "borrower")
            put("peer", peer)
            put("peerName", profiles[peer]?.name.orEmpty())
            put("bookId", loan.bookId)
            put("book", loan.book)
            put("note", loan.note)
            put("state", loan.state)
            put("reason", loan.reason)
            put("dueOn", loan.dueOn)
            put("askedAt", loan.askedAt)
            put("agreedAt", loan.agreedAt)
            put("handedAt", loan.handedAt)
            put("receivedAt", loan.receivedAt)
            put("givenBackAt", loan.givenBackAt)
            put("closedAt", loan.closedAt)
            put("updatedAt", loan.updatedAt)
            put("byMe", loan.updatedBy == me)
        }
    }

    /** shelfmark_loan_act: who may take which step, and from where. Everything else is "not_allowed". */
    private fun loanAct(me: String, args: JsonObject, text: (String) -> String, moment: Long): JsonObject {
        val loan = loans.firstOrNull { it.id == text("p_loan") && (it.lender == me || it.borrower == me) } ?: refuse("unknown_loan")
        val lender = loan.lender == me
        val due = (args["p_due"] as? JsonPrimitive)?.longOrNull
        if (due != null && (due < 0 || due > 100_000)) refuse("invalid")
        val reason = text("p_reason").trim().take(200)
        val action = text("p_action")
        if (action == "hide" && loan.state in OVER) {
            if (lender) loan.hiddenByLender = true else loan.hiddenByBorrower = true
            return loanJson(loan, me)
        }
        when {
            lender && action == "agree" && loan.state == "asked" -> {
                // A book can be promised to one person at a time.
                if (loans.any { it.lender == me && it.bookId == loan.bookId && it.id != loan.id && it.state in HOLDING }) refuse("taken")
                loan.state = "agreed"; loan.agreedAt = moment; loan.dueOn = due
                // Whoever else asked for it is told that it went to somebody else.
                loans.filter { it.lender == me && it.bookId == loan.bookId && it.id != loan.id && it.state == "asked" }.forEach {
                    it.state = "declined"; it.reason = "taken"; it.closedAt = moment; it.updatedAt = moment; it.updatedBy = me
                }
            }
            lender && action == "decline" && loan.state == "asked" -> { loan.state = "declined"; loan.reason = reason; loan.closedAt = moment }
            lender && action == "cancel" && loan.state in setOf("agreed", "handed") -> { loan.state = "cancelled"; loan.reason = reason; loan.closedAt = moment }
            lender && action == "hand" && loan.state == "agreed" -> { loan.state = "handed"; loan.handedAt = moment }
            lender && action == "undo_hand" && loan.state == "handed" -> { loan.state = "agreed"; loan.handedAt = null }
            lender && action == "take_back" && loan.state == "given_back" -> { loan.state = "returned"; loan.closedAt = moment }
            lender && action == "not_returned" && loan.state == "given_back" -> { loan.state = "on_loan"; loan.givenBackAt = null }
            lender && action == "close" && loan.state == "on_loan" -> { loan.state = "returned"; loan.closedAt = moment }
            lender && action == "set_due" && loan.state in HOLDING -> loan.dueOn = due
            !lender && action == "withdraw" && loan.state in setOf("asked", "agreed") -> { loan.state = "withdrawn"; loan.closedAt = moment }
            !lender && action == "receive" && loan.state == "handed" -> { loan.state = "on_loan"; loan.receivedAt = moment }
            !lender && action == "not_received" && loan.state == "handed" -> { loan.state = "agreed"; loan.handedAt = null }
            !lender && action == "give_back" && loan.state == "on_loan" -> { loan.state = "given_back"; loan.givenBackAt = moment }
            !lender && action == "undo_give_back" && loan.state == "given_back" -> { loan.state = "on_loan"; loan.givenBackAt = null }
            else -> refuse("not_allowed")
        }
        loan.updatedAt = moment
        loan.updatedBy = me
        return loanJson(loan, me)
    }

    private fun run(function: String, args: JsonObject, text: (String) -> String, caller: String?): JsonElement {
        stamp += 10
        // The moment of this call. Every call has one of its own, as on a server that is not asked twice in a millisecond.
        val moment = time + stamp
        if (function == "shelfmark_ping") {
            // Housekeeping on the way: loans that are over and that both sides have put away.
            loans.removeAll { it.hiddenByLender && it.hiddenByBorrower }
            return buildJsonObject { put("ok", true); put("schema", if (beforeLoans) 2 else 3); put("time", moment) }
        }
        if (beforeLoans && function.startsWith("shelfmark_loan_")) refuse("missing")
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
                // Whoever ends the friendship ends the open questions with it: their own are taken back,
                // the friend's are answered with a no. A book that is reserved or out stays a loan.
                loans.filter { it.state == "asked" && ((it.lender == me && it.borrower == other) || (it.lender == other && it.borrower == me)) }.forEach {
                    it.state = if (it.borrower == me) "withdrawn" else "declined"
                    it.closedAt = moment; it.updatedAt = moment; it.updatedBy = me
                }
                buildJsonObject { put("ok", true) }
            }
            "shelfmark_publish" -> { libraries[me] = stamp to args.getValue("p_library"); buildJsonObject { put("at", stamp) } }
            // The mailbox of the borrow requests is closed. A version of the app from before is told that it is too old.
            "shelfmark_send" -> refuse("outdated")
            "shelfmark_loan_ask" -> {
                val friend = text("p_friend")
                val bookId = (args["p_book"] as? JsonPrimitive)?.longOrNull
                if (friend.isBlank() || bookId == null || friend == me) refuse("invalid")
                if ((me to friend) !in friendships) refuse("not_friends")
                val info = args["p_info"] as? JsonObject ?: JsonObject(emptyMap())
                fun word(name: String, limit: Int) = (info[name] as? JsonPrimitive)?.takeIf { it !is JsonNull }?.content.orEmpty().take(limit)
                val title = word("title", 10_000).trim().take(300)
                if (title.isEmpty()) refuse("invalid")
                // Asking twice for the same book gives back the question that is still open.
                loans.firstOrNull { it.lender == friend && it.borrower == me && it.bookId == bookId && it.state !in OVER }?.let { return loanJson(it, me) }
                // Reserved for somebody, or in somebody's hands.
                if (loans.any { it.lender == friend && it.bookId == bookId && it.state in HOLDING }) refuse("taken")
                if (loans.count { it.borrower == me && it.state == "asked" } >= 50) refuse("full")
                val loan = LoanRow(
                    id = UUID.randomUUID().toString(),
                    lender = friend,
                    borrower = me,
                    bookId = bookId,
                    // Only what is known to be there, and no longer than a book needs.
                    book = buildJsonObject {
                        put("title", title)
                        put("authors", word("authors", 300))
                        put("isbn", word("isbn", 20))
                        put("coverUrl", word("coverUrl", 600))
                        put("pageCount", (word("pageCount", 20).toIntOrNull() ?: 0).coerceIn(0, 100_000))
                        put("format", word("format", 20).ifEmpty { "UNKNOWN" })
                    },
                    note = text("p_note").trim().take(300),
                    askedAt = moment,
                    updatedBy = me,
                )
                loans += loan
                loanJson(loan, me)
            }
            "shelfmark_loan_act" -> loanAct(me, args, text, moment)
            "shelfmark_sync" -> {
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
                    // The newest question first, and nothing the caller has put away.
                    if (!beforeLoans) put("loans", buildJsonArray {
                        loans.filter { (it.lender == me && !it.hiddenByLender) || (it.borrower == me && !it.hiddenByBorrower) }
                            .sortedWith(compareByDescending<LoanRow> { it.askedAt }.thenBy { it.id })
                            .forEach { add(loanJson(it, me)) }
                    })
                    // A leftover of the mailbox, always empty.
                    put("messages", buildJsonArray { })
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
                loans.removeAll { it.lender == me || it.borrower == me }
                users.entries.removeAll { it.value.id == me }
                tokens.entries.removeAll { it.value.first == me }
                buildJsonObject { put("ok", true); put("login_kept", false) }
            }
            else -> refuse("missing")
        }
    }

    private companion object {
        val OVER = setOf("returned", "declined", "withdrawn", "cancelled")
        /** The book is reserved or out. */
        val HOLDING = setOf("agreed", "handed", "on_loan", "given_back")
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
        val arrived = device.server.signIn(of.email, of.password)
        assertTrue(arrived is SyncResult.Done)
        // A device that is new to an account has nothing to compare with: it starts quietly.
        assertTrue((arrived as SyncResult.Done).news.isEmpty())
    }

    /** Signs both up and makes them friends. Afterwards each has what the other shares. */
    protected suspend fun befriend(owner: Phone, vararg others: Phone) {
        if (!owner.settings.current().signedIn) assertTrue(owner.join() is SyncResult.Done)
        for (other in others) {
            if (!other.settings.current().signedIn) assertTrue(other.join() is SyncResult.Done)
            other.server.addFriend(owner.settings.current().friendCode).getOrThrow()
        }
        owner.server.sync()
    }

    protected suspend fun Phone.loans(): List<Loan> = social.loans.first()
    protected suspend fun Phone.loan(): Loan = loans().single()
    protected suspend fun Phone.loan(id: String): Loan = loans().first { it.id == id }
    /** A book as it stands on a friend's shelf. */
    protected suspend fun Phone.onShelfOf(friend: Phone, title: String): FriendBook = social.friendBooks(friend.id).first().first { it.title == title }
    protected suspend fun Phone.news(): List<LoanNewsKind?> = (server.sync() as SyncResult.Done).news.map { it.kind }

    /** Takes a loan from the question to "on loan" by the shortest way, and returns its id. */
    protected suspend fun lend(lender: Phone, borrower: Phone, title: String, due: Long? = null): String {
        assertNull(borrower.server.loanAsk(borrower.onShelfOf(lender, title), ""))
        val id = borrower.loans().first { it.title == title && !it.over }.id
        lender.server.sync()
        assertNull(lender.server.loanAct(id, LoanAction.AGREE, due = due))
        assertNull(lender.server.loanAct(id, LoanAction.HAND))
        borrower.server.sync()
        assertNull(borrower.server.loanAct(id, LoanAction.RECEIVE))
        lender.server.sync()
        return id
    }

    @After fun closePhones() {
        // Leaves a real server as it was found.
        phones.forEach { runBlocking { runCatching { it.server.deleteAccount() } }; it.close() }
    }

    @Test fun twoFriendsFindEachOtherAndSeeEachOthersShelves() = runBlocking {
        val anna = phone("Anna")
        val ben = phone("Ben")
        // Nothing happens before somebody signs in.
        assertEquals(SyncResult.Off, anna.server.sync())

        anna.library.addBook(Book(title = "Emma", authors = "Jane Austen", status = ReadingStatus.READ, rating = 4.5f, lendable = true))
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
        val emmaAtBen = ben.onShelfOf(anna, "Emma")
        assertTrue(emmaAtBen.available)
        assertEquals(4.5f, emmaAtBen.rating)
        assertFalse(ben.onShelfOf(anna, "Persuasion").available)

        // Anna did nothing, and has Ben as a friend all the same.
        assertTrue(anna.server.sync() is SyncResult.Done)
        val benAtAnna = anna.social.friends.first().single()
        assertEquals("Ben", benAtAnna.friend.name)
        assertEquals(1, benAtAnna.bookCount)
        assertTrue(benAtAnna.friend.online)

        // Wrong codes are told apart.
        assertEquals("unknown_code", (ben.server.addFriend("ZZZZZ-ZZZZZ").exceptionOrNull() as ServerException).reason)
        assertEquals("own_code", (ben.server.addFriend(ben.settings.current().friendCode).exceptionOrNull() as ServerException).reason)

        // A new code replaces the old one.
        val fresh = anna.server.newCode()!!
        assertNotEquals(annaCode, fresh)
        assertEquals(fresh, anna.settings.current().friendCode)

        // Questions that nobody answered end with the friendship. Each of the two has one open, and Ben ends it.
        assertNull(ben.server.loanAsk(emmaAtBen, ""))
        assertNull(anna.server.loanAsk(anna.onShelfOf(ben, "Dune"), ""))
        assertTrue(ben.server.removeFriend(anna.id))
        assertTrue(ben.social.friends.first().isEmpty())
        // He who ended it is not told about it: his own question he took back, hers he answered with a no.
        assertTrue(ben.news().isEmpty())
        assertEquals(LoanState.WITHDRAWN, ben.loans().first { it.title == "Emma" }.state)
        assertEquals(LoanState.DECLINED, ben.loans().first { it.title == "Dune" }.state)
        // It ends for Anna too. She hears the no to her question, and that he no longer asks for her book.
        val heard = (anna.server.sync() as SyncResult.Done).news.associate { it.loan.title to it.kind }
        assertEquals(mapOf<String, LoanNewsKind?>("Dune" to LoanNewsKind.DECLINED, "Emma" to LoanNewsKind.WITHDRAWN), heard)
        assertEquals(LoanState.DECLINED, anna.loans().first { it.title == "Dune" }.state)
        assertFalse(anna.loans().first { it.title == "Dune" }.taken)
        assertEquals(LoanState.WITHDRAWN, anna.loans().first { it.title == "Emma" }.state)
        assertTrue(anna.social.friends.first().isEmpty())
        assertEquals("not_friends", ben.server.loanAsk(emmaAtBen, ""))

        // Deleting the account takes everything off the server. The books on the phone stay.
        assertTrue(anna.server.deleteAccount())
        assertFalse(anna.settings.current().signedIn)
        assertEquals("", anna.settings.current().friendCode)
        assertEquals(SyncResult.Off, anna.server.sync())
        assertEquals(listOf("Emma", "Persuasion"), anna.titles())
        assertEquals("unknown_code", (ben.server.addFriend(fresh).exceptionOrNull() as ServerException).reason)
        assertEquals(SyncResult.Failed("invalid_credentials"), anna.server.signIn(anna.email, anna.password))
    }

    @Test fun aBookIsLentFromTheQuestionToTheDayItIsBack() = runBlocking {
        val anna = phone("Anna")
        val ben = phone("Ben")
        val emma = anna.library.addBook(
            Book(title = "Emma", authors = "Jane Austen", isbn = "9780141439587", pageCount = 474, format = BookFormat.PAPERBACK, description = "Handsome, clever, and rich.", lendable = true),
        )
        befriend(anna, ben)

        // Ben asks, with a few words. No file, no messenger.
        assertNull(ben.server.loanAsk(ben.onShelfOf(anna, "Emma"), " Über die Feiertage? "))
        val asked = ben.loan()
        val id = asked.id
        assertEquals(LoanState.ASKED, asked.state)
        assertFalse(asked.lender)
        assertEquals(anna.id, asked.peerId)
        assertEquals("Anna", asked.peerName)
        assertEquals("Über die Feiertage?", asked.note)
        assertTrue(asked.byMe)
        assertEquals(listOf(LoanAction.WITHDRAW), LoanRules.actions(asked))
        // Asking again is the same question, not a second one.
        assertNull(ben.server.loanAsk(ben.onShelfOf(anna, "Emma"), ""))
        assertEquals(id, ben.loan().id)

        // Anna hears of it, once, and it waits for her.
        assertEquals(listOf<LoanNewsKind?>(LoanNewsKind.ASKED), anna.news())
        assertTrue(anna.news().isEmpty())
        val question = anna.loan()
        assertTrue(question.lender)
        assertTrue(question.waitsForMe)
        assertEquals(emma, question.bookId)
        assertEquals("Ben", question.peerName)
        assertEquals("Emma", question.title)
        assertEquals("9780141439587", question.isbn)
        assertEquals(474, question.pageCount)
        assertEquals(BookFormat.PAPERBACK, question.format)
        assertFalse(question.byMe)
        assertEquals(1, anna.social.waitingLoans.first())

        // She says yes, back by a day. The book is reserved: not lent yet, but nobody else can ask for it.
        val due = 20_030L
        assertNull(anna.server.loanAct(id, LoanAction.AGREE, due = due))
        assertEquals(LoanState.AGREED, anna.loan().state)
        assertEquals(0, anna.social.waitingLoans.first())
        assertEquals("", anna.library.getBook(emma)!!.lentTo)
        assertEquals(listOf<LoanNewsKind?>(LoanNewsKind.AGREED), ben.news())
        assertEquals(due, ben.loan().dueOn)
        assertFalse(ben.onShelfOf(anna, "Emma").available)
        assertTrue(ben.titles().isEmpty())

        // Handing over takes both, the lender first.
        assertEquals("not_allowed", ben.server.loanAct(id, LoanAction.RECEIVE))
        assertNull(anna.server.loanAct(id, LoanAction.HAND))
        assertEquals(listOf<LoanNewsKind?>(LoanNewsKind.HANDED), ben.news())
        assertTrue(ben.loan().waitsForMe)
        assertEquals(1, ben.social.waitingLoans.first())
        // Until Ben says that he has it, it is not lent.
        assertEquals("", anna.library.getBook(emma)!!.lentTo)
        assertTrue(ben.titles().isEmpty())
        assertNull(ben.server.loanAct(id, LoanAction.RECEIVE))

        // Now it is on loan, and the books say so on both sides. Ben got a copy on his shelf.
        val onLoan = ben.loan()
        assertEquals(LoanState.ON_LOAN, onLoan.state)
        val copy = ben.library.allBooks().single()
        assertEquals(LoanBooks.loanBookId(id), copy.id)
        assertEquals("Emma", copy.title)
        assertEquals("Jane Austen", copy.authors)
        assertEquals("9780141439587", copy.isbn)
        assertEquals(474, copy.pageCount)
        assertEquals(BookFormat.PAPERBACK, copy.format)
        // What the loan does not say about the book, the friend's shelf does.
        assertEquals("Handsome, clever, and rich.", copy.description)
        assertEquals(Ownership.BORROWED, copy.ownership)
        assertEquals("Anna", copy.borrowedFrom)
        assertEquals(id, copy.loanId)
        assertEquals(ReadingStatus.NONE, copy.status)
        assertEquals(onLoan.receivedAt, copy.addedAt)
        assertEquals(listOf<LoanNewsKind?>(LoanNewsKind.ON_LOAN), anna.news())
        val lent = anna.library.getBook(emma)!!
        assertEquals("Ben", lent.lentTo)
        assertEquals(Dates.dayOf(onLoan.receivedAt!!), lent.lentSince)
        assertEquals(id, lent.loanId)
        // Anna's shelf does not show a borrowed book of Ben's as one of hers to lend.
        anna.server.sync()
        assertFalse(anna.onShelfOf(ben, "Emma").available)

        // Looking again changes nothing, and nothing is saved again.
        val saved = anna.settings.current().vaultRevision to ben.settings.current().vaultRevision
        assertTrue(anna.news().isEmpty())
        assertTrue(ben.news().isEmpty())
        assertEquals(saved, anna.settings.current().vaultRevision to ben.settings.current().vaultRevision)

        // Ben's tablet, the same account: the copy is there, once.
        val tablet = secondDevice(ben, "Tablet")
        assertEquals(copy.id, tablet.library.allBooks().single().id)
        assertEquals(LoanState.ON_LOAN, tablet.loan().state)
        tablet.server.sync()
        ben.server.sync()
        assertEquals(1, ben.library.allBooks().size)
        assertEquals(1, tablet.library.allBooks().size)
        // What he notes in it is his, whatever happens to the loan.
        tablet.library.modify(copy.id) { it.copy(rating = 4f, review = "Gern gelesen.") }
        tablet.server.sync()

        // Anna gives him more time, and then no fixed day at all.
        assertNull(anna.server.loanAct(id, LoanAction.SET_DUE, due = due + 14))
        assertEquals(listOf<LoanNewsKind?>(LoanNewsKind.DUE_CHANGED), ben.news())
        assertEquals(due + 14, ben.loan().dueOn)
        assertNull(anna.server.loanAct(id, LoanAction.SET_DUE, due = null))
        assertEquals(listOf<LoanNewsKind?>(LoanNewsKind.DUE_CHANGED), ben.news())
        assertNull(ben.loan().dueOn)

        // Giving back takes both too, the borrower first.
        assertEquals("not_allowed", anna.server.loanAct(id, LoanAction.TAKE_BACK))
        assertNull(ben.server.loanAct(id, LoanAction.GIVE_BACK))
        assertEquals(LoanState.GIVEN_BACK, ben.loan().state)
        assertEquals(listOf<LoanNewsKind?>(LoanNewsKind.GIVEN_BACK), anna.news())
        assertTrue(anna.loan().waitsForMe)
        // Until Anna says that she has it back, it is lent.
        assertEquals("Ben", anna.library.getBook(emma)!!.lentTo)
        assertEquals(Ownership.BORROWED, ben.library.getBook(copy.id)!!.ownership)
        assertNull(anna.server.loanAct(id, LoanAction.TAKE_BACK))

        // Her book is free again, and friends can ask for it.
        val free = anna.library.getBook(emma)!!
        assertEquals("", free.lentTo)
        assertNull(free.lentSince)
        assertEquals("", free.loanId)
        assertEquals(listOf<LoanNewsKind?>(LoanNewsKind.RETURNED), ben.news())
        assertTrue(ben.onShelfOf(anna, "Emma").available)
        // His copy stays: read, not mine, with everything he noted in it.
        tablet.server.sync()
        for (device in listOf(ben, tablet)) {
            val kept = device.library.getBook(copy.id)!!
            assertEquals(device.name, Ownership.NOT_OWNED, kept.ownership)
            assertEquals(device.name, "Anna", kept.borrowedFrom)
            assertEquals(device.name, id, kept.loanId)
            assertEquals(device.name, 4f, kept.rating)
            assertEquals(device.name, "Gern gelesen.", kept.review)
        }
        assertEquals(listOf(LoanAction.HIDE), LoanRules.actions(ben.loan()))

        // Put away, it is gone for the one who put it away, and the book stays as it is.
        assertNull(ben.server.loanAct(id, LoanAction.HIDE))
        assertTrue(ben.loans().isEmpty())
        anna.server.sync()
        assertEquals(LoanState.RETURNED, anna.loan().state)
        assertEquals(Ownership.NOT_OWNED, ben.library.getBook(copy.id)!!.ownership)
        // And he can ask for it again.
        assertNull(ben.server.loanAsk(ben.onShelfOf(anna, "Emma"), ""))
        assertNotEquals(id, ben.loan().id)
    }

    @Test fun aNoCanSayWhyAndAQuestionOrAYesCanBeTakenBack() = runBlocking {
        val anna = phone("Anna")
        val ben = phone("Ben")
        anna.library.addBook(Book(title = "Emma", authors = "Jane Austen"))
        anna.library.addBook(Book(title = "Persuasion", authors = "Jane Austen"))
        befriend(anna, ben)

        // No, and why.
        assertNull(ben.server.loanAsk(ben.onShelfOf(anna, "Emma"), ""))
        val first = ben.loan().id
        anna.server.sync()
        assertNull(anna.server.loanAct(first, LoanAction.DECLINE, reason = "  Das lese ich gerade selbst. "))
        assertEquals(listOf<LoanNewsKind?>(LoanNewsKind.DECLINED), ben.news())
        val no = ben.loan()
        assertEquals(LoanState.DECLINED, no.state)
        assertEquals("Das lese ich gerade selbst.", no.reason)
        assertFalse(no.taken)
        assertTrue(no.over)

        // The book is still to be had. Ben asks once more, thinks better of it, and takes the question back.
        assertNull(ben.server.loanAsk(ben.onShelfOf(anna, "Emma"), "Und jetzt?"))
        val again = ben.loans()
        assertEquals(2, again.size)
        // The newest question comes first.
        assertEquals(LoanState.ASKED, again.first().state)
        val second = again.first().id
        assertNotEquals(first, second)
        assertEquals(listOf<LoanNewsKind?>(LoanNewsKind.ASKED), anna.news())
        assertNull(ben.server.loanAct(second, LoanAction.WITHDRAW))
        assertEquals(LoanState.WITHDRAWN, ben.loan(second).state)
        assertEquals(listOf<LoanNewsKind?>(LoanNewsKind.WITHDRAWN), anna.news())
        assertEquals(0, anna.social.waitingLoans.first())

        // A yes with no fixed date, and the yes taken back: the book is free again.
        assertNull(ben.server.loanAsk(ben.onShelfOf(anna, "Persuasion"), ""))
        val third = ben.loans().first().id
        anna.server.sync()
        assertNull(anna.server.loanAct(third, LoanAction.AGREE))
        assertEquals(listOf<LoanNewsKind?>(LoanNewsKind.AGREED), ben.news())
        assertNull(ben.loan(third).dueOn)
        assertFalse(ben.onShelfOf(anna, "Persuasion").available)
        assertNull(anna.server.loanAct(third, LoanAction.HAND))
        assertNull(anna.server.loanAct(third, LoanAction.CANCEL, reason = "Ich brauche es doch selbst."))
        assertEquals(listOf<LoanNewsKind?>(LoanNewsKind.CANCELLED), ben.news())
        assertEquals(LoanState.CANCELLED, ben.loan(third).state)
        assertEquals("Ich brauche es doch selbst.", ben.loan(third).reason)
        assertTrue(ben.onShelfOf(anna, "Persuasion").available)

        // None of this moved a book.
        assertTrue(ben.titles().isEmpty())
        assertTrue(anna.library.allBooks().all { it.lentTo.isBlank() && it.loanId.isBlank() })

        // Each side puts away what it has seen enough of.
        ben.loans().forEach { assertNull(ben.server.loanAct(it.id, LoanAction.HIDE)) }
        assertTrue(ben.loans().isEmpty())
        anna.server.sync()
        assertEquals(3, anna.loans().size)
    }

    @Test fun whoAsksSecondIsToldThatTheBookIsTaken() = runBlocking {
        val anna = phone("Anna")
        val ben = phone("Ben")
        val cleo = phone("Cleo")
        anna.library.addBook(Book(title = "Emma", authors = "Jane Austen"))
        befriend(anna, ben, cleo)

        // Two people can ask for one book.
        assertNull(ben.server.loanAsk(ben.onShelfOf(anna, "Emma"), ""))
        assertNull(cleo.server.loanAsk(cleo.onShelfOf(anna, "Emma"), ""))
        val forBen = ben.loan().id
        val forCleo = cleo.loan().id
        assertEquals(listOf<LoanNewsKind?>(LoanNewsKind.ASKED, LoanNewsKind.ASKED), anna.news())
        assertEquals(2, anna.social.waitingLoans.first())

        // Anna says yes to Ben. Cleo is told that it went to somebody else: there is no waiting list.
        assertNull(anna.server.loanAct(forBen, LoanAction.AGREE))
        assertEquals(LoanState.AGREED, anna.loan(forBen).state)
        assertTrue(anna.loan(forCleo).taken)
        assertEquals(0, anna.social.waitingLoans.first())
        assertEquals(listOf<LoanNewsKind?>(LoanNewsKind.TAKEN), cleo.news())
        assertTrue(cleo.loan().taken)
        assertTrue(cleo.loan().over)
        // Her shelf of Anna's books says so, and so does asking again.
        assertFalse(cleo.onShelfOf(anna, "Emma").available)
        assertEquals("taken", cleo.server.loanAsk(cleo.onShelfOf(anna, "Emma"), ""))
        assertEquals(1, cleo.loans().size)
        // What is over cannot be answered any more.
        assertEquals("not_allowed", anna.server.loanAct(forCleo, LoanAction.AGREE))

        // "I handed it over", "I did not get it": back to reserved, and Anna hears it.
        assertNull(anna.server.loanAct(forBen, LoanAction.HAND))
        ben.server.sync()
        assertNull(ben.server.loanAct(forBen, LoanAction.NOT_RECEIVED))
        assertEquals(LoanState.AGREED, ben.loan().state)
        assertNull(ben.loan().handedAt)
        assertEquals(listOf<LoanNewsKind?>(LoanNewsKind.NOT_RECEIVED), anna.news())
        // A tap taken back is news without words: what was said before is no longer so.
        assertNull(anna.server.loanAct(forBen, LoanAction.HAND))
        assertEquals(listOf<LoanNewsKind?>(LoanNewsKind.HANDED), ben.news())
        assertNull(anna.server.loanAct(forBen, LoanAction.UNDO_HAND))
        assertEquals(listOf<LoanNewsKind?>(null), ben.news())
        assertEquals(LoanState.AGREED, ben.loan().state)
        // A book that is reserved has not moved.
        assertTrue(ben.titles().isEmpty())
        assertEquals("", anna.library.allBooks().single().lentTo)
    }

    @Test fun aWishBecomesTheBorrowedCopyAndTheLenderCanCloseALoan() = runBlocking {
        val anna = phone("Anna")
        val ben = phone("Ben")
        val emma = anna.library.addBook(Book(title = "Emma", authors = "Jane Austen", isbn = "9780141439587"))
        val persuasion = anna.library.addBook(Book(title = "Persuasion", authors = "Jane Austen"))
        // Ben has wanted to read Emma for a while.
        val wish = ben.library.addBook(Book(title = "Emma", authors = "Jane Austen", status = ReadingStatus.WISHLIST, ownership = Ownership.NOT_OWNED, tags = "Empfehlung von Clara"))
        befriend(anna, ben)

        // The wish is the copy: no second "Emma" appears.
        val id = lend(anna, ben, "Emma")
        val borrowed = ben.library.allBooks().single()
        assertEquals(wish, borrowed.id)
        assertEquals(Ownership.BORROWED, borrowed.ownership)
        assertEquals("Anna", borrowed.borrowedFrom)
        assertEquals(id, borrowed.loanId)
        assertEquals("Empfehlung von Clara", borrowed.tags)

        // "I gave it back", "I did not get it back": on loan again.
        assertNull(ben.server.loanAct(id, LoanAction.GIVE_BACK))
        anna.server.sync()
        assertNull(anna.server.loanAct(id, LoanAction.NOT_RETURNED))
        assertEquals(listOf<LoanNewsKind?>(LoanNewsKind.NOT_RETURNED), ben.news())
        assertEquals(LoanState.ON_LOAN, ben.loan().state)
        assertNull(ben.loan().givenBackAt)
        assertEquals("Ben", anna.library.getBook(emma)!!.lentTo)
        // "I gave it back" can be taken back as well, and that makes no noise.
        assertNull(ben.server.loanAct(id, LoanAction.GIVE_BACK))
        assertEquals(listOf<LoanNewsKind?>(LoanNewsKind.GIVEN_BACK), anna.news())
        assertNull(ben.server.loanAct(id, LoanAction.UNDO_GIVE_BACK))
        assertEquals(listOf<LoanNewsKind?>(null), anna.news())

        // The book is back on Anna's shelf and Ben never said so: she closes the loan herself.
        assertEquals("not_allowed", anna.server.loanAct(id, LoanAction.TAKE_BACK))
        assertNull(anna.server.loanAct(id, LoanAction.CLOSE))
        assertEquals(LoanState.RETURNED, anna.loan().state)
        assertEquals("", anna.library.getBook(emma)!!.lentTo)
        assertEquals(listOf<LoanNewsKind?>(LoanNewsKind.RETURNED), ben.news())
        val after = ben.library.getBook(wish)!!
        assertEquals(Ownership.NOT_OWNED, after.ownership)
        assertEquals(ReadingStatus.WISHLIST, after.status)
        assertEquals(id, after.loanId)

        // Ben liked the next one so much that he bought it before giving Anna's copy back.
        // What he says about his book is not overruled by the return.
        val next = lend(anna, ben, "Persuasion")
        val second = ben.library.allBooks().first { it.loanId == next }
        assertNull(ben.server.loanAct(next, LoanAction.GIVE_BACK))
        ben.library.modify(second.id) { it.copy(ownership = Ownership.OWNED) }
        anna.server.sync()
        assertNull(anna.server.loanAct(next, LoanAction.TAKE_BACK))
        assertEquals("", anna.library.getBook(persuasion)!!.loanId)
        ben.server.sync()
        assertEquals(Ownership.OWNED, ben.library.getBook(second.id)!!.ownership)
        assertEquals(2, ben.library.allBooks().size)
    }

    @Test fun aBookThatIsDueIsRemindedOfOncePerDayItWasDueOn() = runBlocking {
        var day = 20_000L
        val anna = phone("Anna", day = { day })
        val ben = phone("Ben", day = { day })
        anna.library.addBook(Book(title = "Emma", authors = "Jane Austen"))
        befriend(anna, ben)
        val id = lend(anna, ben, "Emma", due = 20_010)

        // Before the day nobody is reminded of anything.
        day = 20_009
        assertTrue((anna.server.sync() as SyncResult.Done).due.isEmpty())
        assertTrue((ben.server.sync() as SyncResult.Done).due.isEmpty())
        // On the day both are, once.
        day = 20_010
        assertEquals(listOf(id), (ben.server.sync() as SyncResult.Done).due.map { it.id })
        assertEquals(listOf(id), (anna.server.sync() as SyncResult.Done).due.map { it.id })
        assertTrue(ben.loan().dueBy(day))
        assertTrue((ben.server.sync() as SyncResult.Done).due.isEmpty())
        day = 20_015
        assertTrue((ben.server.sync() as SyncResult.Done).due.isEmpty())
        assertTrue((anna.server.sync() as SyncResult.Done).due.isEmpty())

        // Another day is another reminder, when it has come.
        assertNull(anna.server.loanAct(id, LoanAction.SET_DUE, due = 20_020))
        assertTrue((ben.server.sync() as SyncResult.Done).due.isEmpty())
        day = 20_021
        assertEquals(listOf(id), (ben.server.sync() as SyncResult.Done).due.map { it.id })
        assertEquals(listOf(id), (anna.server.sync() as SyncResult.Done).due.map { it.id })
        // Given back but not confirmed, it still counts as out. Once it is back, nothing is due.
        assertNull(ben.server.loanAct(id, LoanAction.GIVE_BACK))
        assertTrue(ben.loan().dueBy(day))
        anna.server.sync()
        assertNull(anna.server.loanAct(id, LoanAction.TAKE_BACK))
        assertFalse(anna.loan().dueBy(day))
        assertTrue((ben.server.sync() as SyncResult.Done).due.isEmpty())
    }

    @Test fun whenTheOtherAccountIsGoneTheBookIsLentOrBorrowedByHand() = runBlocking {
        val anna = phone("Anna")
        val ben = phone("Ben")
        val cleo = phone("Cleo")
        val emma = anna.library.addBook(Book(title = "Emma", authors = "Jane Austen"))
        cleo.library.addBook(Book(title = "Dune", authors = "Frank Herbert"))
        befriend(anna, ben)
        befriend(cleo, anna)
        val lent = lend(anna, ben, "Emma")
        val borrowed = lend(cleo, anna, "Dune")
        val dune = anna.library.allBooks().first { it.loanId == borrowed }
        assertEquals(2, anna.loans().size)

        // Signed out, the loans cannot be read. The books stay as they were.
        anna.server.signOut()
        assertTrue(anna.loans().isEmpty())
        assertEquals("Ben", anna.library.getBook(emma)!!.lentTo)
        assertEquals(Ownership.BORROWED, anna.library.getBook(dune.id)!!.ownership)
        // Signed in again they are back, and none of it is news.
        val back = anna.server.signIn(anna.email, anna.password) as SyncResult.Done
        assertTrue(back.news.isEmpty())
        assertEquals(2, anna.loans().size)
        assertEquals(2, anna.library.allBooks().size)

        // Ben deletes his account, and the loan goes with it. Anna's book is still with him:
        // it stays lent, and from here on she looks after that by hand.
        assertTrue(ben.server.deleteAccount())
        anna.server.sync()
        assertEquals(listOf(borrowed), anna.loans().map { it.id })
        val stillLent = anna.library.getBook(emma)!!
        assertEquals("Ben", stillLent.lentTo)
        assertEquals(lent, stillLent.loanId)
        assertNull(anna.db.social().getLoan(stillLent.loanId))
        assertEquals("unknown_loan", anna.server.loanAct(lent, LoanAction.CLOSE))

        // The same from the other side: Cleo is gone, her book is still on Anna's shelf as borrowed.
        assertTrue(cleo.server.deleteAccount())
        anna.server.sync()
        assertTrue(anna.loans().isEmpty())
        val stillBorrowed = anna.library.getBook(dune.id)!!
        assertEquals(Ownership.BORROWED, stillBorrowed.ownership)
        assertEquals("Cleo", stillBorrowed.borrowedFrom)
        assertNull(anna.db.social().getLoan(stillBorrowed.loanId))
    }

    @Test fun aStepThatNoLongerFitsShowsWhereTheLoanStands() = runBlocking {
        val anna = phone("Anna")
        val ben = phone("Ben")
        val cleo = phone("Cleo")
        val emma = anna.library.addBook(Book(title = "Emma", authors = "Jane Austen"))
        befriend(anna, ben)
        cleo.join()

        // Anna sees the question. Before she answers, Ben takes it back.
        assertNull(ben.server.loanAsk(ben.onShelfOf(anna, "Emma"), ""))
        val id = ben.loan().id
        anna.server.sync()
        assertNull(ben.server.loanAct(id, LoanAction.WITHDRAW))
        assertEquals(LoanState.ASKED, anna.loan().state)
        assertEquals("not_allowed", anna.server.loanAct(id, LoanAction.AGREE))
        // Her phone looked again right away, and shows what became of it.
        assertEquals(LoanState.WITHDRAWN, anna.loan().state)

        // A loan is nobody's business but the two it is between.
        assertEquals("unknown_loan", cleo.server.loanAct(id, LoanAction.HIDE))
        assertEquals("unknown_loan", anna.server.loanAct(UUID.randomUUID().toString(), LoanAction.HIDE))
        // Only friends can ask, and only for a book that has a name.
        assertEquals("not_friends", cleo.server.loanAsk(FriendBook(friendId = anna.id, remoteId = emma, title = "Emma"), ""))
        assertEquals("invalid", ben.server.loanAsk(FriendBook(friendId = anna.id, remoteId = emma, title = " "), ""))
        // A day that is none is refused, and the question stays open.
        assertNull(ben.server.loanAsk(ben.onShelfOf(anna, "Emma"), ""))
        val next = ben.loans().first().id
        anna.server.sync()
        assertEquals("invalid", anna.server.loanAct(next, LoanAction.AGREE, due = -5))
        assertEquals(LoanState.ASKED, anna.loan(next).state)
    }

    @Test fun aVaultFromBeforeTheLoansIsReadWithoutItsRequests() = runBlocking {
        val anna = phone("Anna")
        assertTrue(anna.join() is SyncResult.Done)
        // What a version of the app from before left on the account: a book lent by hand, and the borrow requests.
        val old = Json.parseToJsonElement(
            """{"exportedAt":1,"books":[{"id":7,"title":"Emma","lentTo":"Ben","lentSince":20000}],"shelves":[],"links":[],"quotes":[],
               "requests":[{"id":"req-1","incoming":true,"bookRemoteId":7,"bookTitle":"Emma","peerId":"p","peerName":"Ben","status":"ACCEPTED","createdAt":5,"answeredAt":9}]}""",
        )
        val api = ServerApi(config, poster, anna.settings.current().accessToken)
        api.vaultPush(old, anna.settings.current().vaultRevision)
        assertTrue(anna.server.sync() is SyncResult.Done)
        val emma = anna.library.allBooks().single()
        assertEquals("Emma", emma.title)
        assertEquals("Ben", emma.lentTo)
        assertEquals("", emma.loanId)
        assertTrue(anna.loans().isEmpty())
        // The next save writes the library as it is now: the requests are not carried along.
        anna.library.modify(emma.id) { it.copy(rating = 4f) }
        assertTrue(anna.server.sync() is SyncResult.Done)
        val saved = api.vaultPull(0).payload!!.jsonObject
        assertFalse("requests" in saved)
        assertEquals("Emma", saved.getValue("books").jsonArray.single().jsonObject.getValue("title").jsonPrimitive.content)
    }

    @Test fun aLibraryThisVersionCannotReadIsNeverReplaced() = runBlocking {
        val anna = phone("Anna")
        val emma = anna.library.addBook(Book(title = "Emma"))
        assertTrue(anna.join() is SyncResult.Done)
        val api = ServerApi(config, poster, anna.settings.current().accessToken)
        val strange = listOf(
            // Saved in a format that a newer version introduced.
            """{"format":2,"exportedAt":1,"books":[{"id":1,"title":"Dune"}],"shelves":[],"links":[],"quotes":[]}""",
            // A word this version does not have: it could only drop the book or call it something else.
            """{"exportedAt":1,"books":[{"id":1,"title":"Dune","status":"LISTENING"}],"shelves":[],"links":[],"quotes":[]}""",
            // No library at all.
            """{"exportedAt":1,"books":"all of them"}""",
        ).map { Json.parseToJsonElement(it) }
        var rating = 1f
        for (document in strange) {
            api.vaultPush(document, api.vaultPull(0).revision)
            // Whether or not something changed here in the meantime: the sync stops, and says why.
            for (changedHere in listOf(false, true)) {
                if (changedHere) anna.library.modify(emma) { it.copy(rating = rating++) }
                assertEquals(SyncResult.Failed(ServerSync.UNREADABLE), anna.server.sync())
                assertEquals(ServerSync.UNREADABLE, anna.server.status.value.error)
                // Nothing was written over it, and the library on the phone is what it was.
                assertEquals(document, api.vaultPull(0).payload)
                assertEquals(listOf("Emma"), anna.titles())
            }
            // A device that is new to the account does not take it for an empty library either,
            // whether it has books of its own or none.
            val full = phone("Voll")
            full.library.addBook(Book(title = "Momo"))
            assertEquals(SyncResult.Failed(ServerSync.UNREADABLE), full.server.signIn(anna.email, anna.password))
            assertEquals(SyncResult.Failed(ServerSync.UNREADABLE), full.server.choose(Keep.DEVICE))
            assertEquals(listOf("Momo"), full.titles())
            val empty = phone("Leer")
            assertEquals(SyncResult.Failed(ServerSync.UNREADABLE), empty.server.signIn(anna.email, anna.password))
            assertTrue(empty.titles().isEmpty())
            assertEquals(document, api.vaultPull(0).payload)
            // Signed out again, so that only Anna's phone is left to tidy up after the test.
            full.server.signOut()
            empty.server.signOut()
        }
        assertEquals("This version of Shelfmark cannot read the library on your account: a newer version saved it, or it is damaged. Nothing was changed. Please update the app.", context.getString(loanProblemRes(ServerSync.UNREADABLE), ""))

        // Once there is a library it can read, the phone goes on, and what changed here meanwhile is not lost.
        val readable = Json.parseToJsonElement("""{"exportedAt":1,"books":[{"id":1,"title":"Dune"}],"shelves":[],"links":[],"quotes":[]}""")
        api.vaultPush(readable, api.vaultPull(0).revision)
        assertTrue(anna.server.sync() is SyncResult.Done)
        assertEquals(listOf("Dune", "Emma"), anna.titles())
        assertEquals(rating - 1, anna.library.getBook(emma)!!.rating)
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
        // Without the code Cleo sees nobody, and cannot ask Anna for anything.
        assertTrue(cleo.social.friends.first().isEmpty())
        val asCleo = ServerApi(config, poster, cleo.settings.current().accessToken)
        val refused = runCatching { asCleo.loanAsk(FriendBook(friendId = anna.id, remoteId = 1, title = "Emma"), "") }
        assertEquals("not_friends", (refused.exceptionOrNull() as ServerException).reason)
        assertTrue(asCleo.sync(emptyMap()).loans.isEmpty())
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

    @Test fun withoutReceptionNothingIsLostAndNothingIsPretended() = runBlocking {
        val anna = phone("Anna")
        val ben = phone("Ben")
        anna.library.addBook(Book(title = "Emma", lendable = true))
        befriend(anna, ben)
        val emma = ben.onShelfOf(anna, "Emma")

        server.offline = true
        // A question cannot be put without the server: it says so, and nothing is kept to be sent behind the reader's back.
        assertEquals(ServerSync.NETWORK, ben.server.loanAsk(emma, ""))
        assertTrue(ben.loans().isEmpty())
        assertEquals(SyncResult.Failed(ServerSync.NETWORK), ben.server.sync())
        assertEquals(ServerSync.NETWORK, ben.server.status.value.error)
        // Without reception a friend on the server cannot be removed either, and stays.
        assertFalse(ben.server.removeFriend(anna.id))
        assertEquals(1, ben.social.friends.first().size)
        assertEquals("network", (ben.server.addFriend("ABCDE-FGHJK").exceptionOrNull() as ServerException).reason)
        assertFalse(ben.server.deleteAccount())
        assertTrue(ben.settings.current().signedIn)
        assertEquals(SyncResult.Failed(ServerSync.NETWORK), phone("Offline").let { it.server.signIn(anna.email, anna.password) })
        // What was changed in the library without reception waits.
        ben.library.addBook(Book(title = "Im Funkloch"))

        server.offline = false
        assertTrue(ben.server.sync() is SyncResult.Done)
        assertNull(ben.server.status.value.error)
        assertTrue(server.loanStatesOf(anna.email).isEmpty())
        assertNull(ben.server.loanAsk(emma, ""))
        assertEquals(listOf("asked"), server.loanStatesOf(anna.email))
        // A step that was not taken for want of reception leaves the loan where it was.
        val id = ben.loan().id
        server.offline = true
        assertEquals(ServerSync.NETWORK, ben.server.loanAct(id, LoanAction.WITHDRAW))
        assertEquals(LoanState.ASKED, ben.loan().state)
        server.offline = false
        val tablet = secondDevice(ben, "Tablet")
        assertEquals(listOf("Im Funkloch"), tablet.titles())
        // The loan is on the server, so his tablet knows it without anything having been passed on.
        assertEquals(LoanState.ASKED, tablet.loan().state)
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
        befriend(anna, ben)
        befriend(ben, mallory)

        // Mallory uploads a "library" that claims to be Anna's.
        val asMallory = ServerApi(config, server, mallory.settings.current().accessToken)
        val forged = anna.social.exportLibrary(includeStatus = true, includeRatings = true).let { it.copy(library = it.library!!.copy(books = emptyList())) }
        asMallory.publish(ShareCodec.encodeElement(forged))
        assertTrue(ben.server.sync() is SyncResult.Done)
        // Anna's shelf at Ben's is untouched, and Mallory has not become Anna.
        assertEquals(1, ben.social.friends.first().first { it.friend.id == anna.id }.bookCount)
        assertEquals(0, ben.social.friends.first().first { it.friend.id == mallory.id }.bookCount)

        // A loan between Anna and Ben is theirs. Mallory cannot answer it, in whoever's name.
        assertNull(ben.server.loanAsk(ben.onShelfOf(anna, "Emma"), ""))
        val id = ben.loan().id
        assertEquals("unknown_loan", (runCatching { asMallory.loanAct(id, LoanAction.AGREE) }.exceptionOrNull() as ServerException).reason)
        // And the one who asked cannot say yes for the one who was asked.
        assertEquals("not_allowed", ben.server.loanAct(id, LoanAction.AGREE))
        assertEquals(listOf("asked"), server.loanStatesOf(anna.email))
    }

    @Test fun aServerFromBeforeTheLoansSaysSoInsteadOfBreaking() = runBlocking {
        server.beforeLoans = true
        val anna = phone("Anna")
        val ben = phone("Ben")
        anna.library.addBook(Book(title = "Emma"))
        befriend(anna, ben)
        // Everything that the old server can do still works.
        assertTrue(ben.server.sync() is SyncResult.Done)
        assertTrue(ben.loans().isEmpty())
        // What it cannot do is said as what it is: the server is not ready for this version.
        assertEquals("setup", ben.server.loanAsk(ben.onShelfOf(anna, "Emma"), ""))
        assertEquals("The server is not ready for this version of the app yet.", context.getString(loanProblemRes("setup"), "setup"))
        assertNull(ben.server.status.value.error)
        // Once schema.sql was run there, asking works.
        server.beforeLoans = false
        assertNull(ben.server.loanAsk(ben.onShelfOf(anna, "Emma"), ""))
    }

    @Test fun everyRefusalOfALoanHasWordsOfItsOwn() = runBlocking {
        val reasons = listOf("taken", "not_allowed", "unknown_loan", "invalid", "outdated", "not_friends", "full")
        // What the server says arrives as the reason, whatever the function.
        for (reason in reasons) {
            val refusing = HttpPoster { _, _, _ -> HttpAnswer(400, """{"code":"P0001","message":"shelfmark:$reason"}""") }
            val refused = runCatching { ServerApi(config, refusing, "token").loanAct("loan", LoanAction.AGREE) }.exceptionOrNull() as ServerException
            assertEquals(reason, refused.reason)
        }
        fun words(reason: String) = context.getString(loanProblemRes(reason), reason)
        assertEquals("This book is reserved for somebody else or on loan.", words("taken"))
        assertEquals("That is no longer possible, the loan has moved on. Here is where it stands now.", words("not_allowed"))
        assertEquals("This loan no longer exists.", words("unknown_loan"))
        assertEquals("This version of Shelfmark is too old for its server. Please update the app.", words("outdated"))
        assertEquals("The server is not ready for this version of the app yet.", words("setup"))
        assertEquals("No connection to the server.", words("network"))
        // What has no words of its own is at least named.
        assertEquals("The server reported a problem (invalid).", words("invalid"))
        // An answer that is no loan is not taken for one.
        val odd = HttpPoster { _, _, _ -> HttpAnswer(200, """{"id":"x","role":"lender","state":"something_new","bookId":1}""") }
        assertEquals("bad_answer", (runCatching { ServerApi(config, odd, "token").loanAct("x", LoanAction.HIDE) }.exceptionOrNull() as ServerException).reason)
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
