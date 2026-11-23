package ch.schmidtbit.shelfmark.data.repo

import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.floatPreferencesKey
import androidx.datastore.preferences.core.intPreferencesKey
import androidx.datastore.preferences.core.longPreferencesKey
import androidx.datastore.preferences.core.stringPreferencesKey
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.Json
import java.security.SecureRandom
import java.util.UUID

/** How the library is drawn: covers on shelf boards, spines side by side, or a plain list. */
enum class ViewMode { COVERS, SPINES, LIST }

enum class SortOrder { ADDED, TITLE, AUTHOR, RATING }

data class Settings(
    /** "system" follows the phone (Ember in the dark, Paper in the light), otherwise a theme key. */
    val theme: String = THEME_SYSTEM,
    val viewMode: ViewMode = ViewMode.COVERS,
    val sort: SortOrder = SortOrder.ADDED,
    val profileName: String = "",
    /** Stable random id that identifies this library to friends. Empty until first needed. */
    val userId: String = "",
    val shareStatus: Boolean = true,
    val shareRatings: Boolean = true,
    val googleBooksKey: String = "",
    /** Reading speed in minutes per page, used to estimate the time left in a book. */
    val minutesPerPage: Float = DEFAULT_SPEED,
    /** The first-run introduction has been seen. */
    val onboarded: Boolean = false,
    val timer: TimerState? = null,
    /** Themes the user built from four colours. Selected with the key "custom:" plus the id. */
    val customThemes: List<CustomTheme> = emptyList(),
    /** Gentle movement on the shelf: flickering candles, drifting dust, books settling in. */
    val motion: Boolean = true,
    /** A server of one's own instead of the one the app was built for. Both empty means the built-in one. */
    val serverUrl: String = "",
    val serverKey: String = "",
    /** The user chose to share the library through the server. */
    val online: Boolean = false,
    /** What a friend types in to connect with me. Known once connected. */
    val friendCode: String = "",
    /** Proves to the server that this phone is this profile. Never leaves the phone except to the server. */
    val serverSecret: String = "",
    /** Server address and name the profile was last registered with. */
    val registeredAs: String = "",
    /** Fingerprint of the library version the server has. */
    val publishedHash: String = "",
    val lastSyncAt: Long = 0,
    /** Epoch day of the last daily check that keeps the server awake. */
    val lastPingDay: Long = 0,
) {
    companion object {
        const val THEME_SYSTEM = "system"
        const val DEFAULT_SPEED = 1.5f
    }
}

/** A theme made by the user. Colours are ARGB integers. */
@Serializable
data class CustomTheme(
    val id: String,
    val name: String,
    val background: Int,
    val card: Int,
    val accent: Int,
    val text: Int,
) {
    val key: String get() = PREFIX + id

    companion object {
        const val PREFIX = "custom:"
    }
}

/** A running or paused reading timer. It survives closing the app. */
data class TimerState(
    val bookId: Long,
    /** Set while running: when the current run began (epoch ms). */
    val runningSince: Long?,
    /** Seconds collected in earlier runs, before pauses. */
    val accumulatedSeconds: Long,
    val startedAt: Long,
    val startPage: Int,
) {
    fun elapsedSeconds(now: Long = System.currentTimeMillis()): Long =
        accumulatedSeconds + (runningSince?.let { ((now - it) / 1000).coerceAtLeast(0) } ?: 0)

    val running: Boolean get() = runningSince != null
}

class SettingsRepository(private val store: DataStore<Preferences>) {
    val settings: Flow<Settings> = store.data.map { p ->
        Settings(
            theme = p[THEME] ?: Settings.THEME_SYSTEM,
            viewMode = p[VIEW].toEnum(ViewMode.COVERS),
            sort = p[SORT].toEnum(SortOrder.ADDED),
            profileName = p[NAME].orEmpty(),
            userId = p[USER_ID].orEmpty(),
            shareStatus = p[SHARE_STATUS] ?: true,
            shareRatings = p[SHARE_RATINGS] ?: true,
            googleBooksKey = p[GOOGLE_KEY].orEmpty(),
            minutesPerPage = (p[SPEED] ?: Settings.DEFAULT_SPEED).coerceIn(0.3f, 10f),
            onboarded = p[ONBOARDED] ?: false,
            timer = p[TIMER_BOOK]?.let { bookId ->
                TimerState(
                    bookId = bookId,
                    runningSince = p[TIMER_SINCE]?.takeIf { it > 0 },
                    accumulatedSeconds = p[TIMER_ACC] ?: 0,
                    startedAt = p[TIMER_STARTED] ?: 0,
                    startPage = p[TIMER_PAGE] ?: 0,
                )
            },
            customThemes = decodeThemes(p[CUSTOM_THEMES]),
            motion = p[MOTION] ?: true,
            serverUrl = p[SERVER_URL].orEmpty(),
            serverKey = p[SERVER_KEY].orEmpty(),
            online = p[ONLINE] ?: false,
            friendCode = p[FRIEND_CODE].orEmpty(),
            serverSecret = p[SERVER_SECRET].orEmpty(),
            registeredAs = p[REGISTERED_AS].orEmpty(),
            publishedHash = p[PUBLISHED_HASH].orEmpty(),
            lastSyncAt = p[LAST_SYNC] ?: 0,
            lastPingDay = p[LAST_PING] ?: 0,
        )
    }

    suspend fun current(): Settings = settings.first()

    /** Returns the profile id, creating it on first use. */
    suspend fun ensureUserId(): String {
        var id = ""
        store.edit { p ->
            id = p[USER_ID].orEmpty().ifBlank { UUID.randomUUID().toString() }
            p[USER_ID] = id
        }
        return id
    }

    /** Returns the secret that proves this phone's identity to the server, creating it on first use. */
    suspend fun ensureServerSecret(): String {
        var secret = ""
        store.edit { p ->
            secret = p[SERVER_SECRET].orEmpty().ifBlank {
                val bytes = ByteArray(32).also { SecureRandom().nextBytes(it) }
                bytes.joinToString("") { "%02x".format(it) }
            }
            p[SERVER_SECRET] = secret
        }
        return secret
    }

    suspend fun setMotion(value: Boolean) { store.edit { it[MOTION] = value } }

    /** Points the app at another server. The link to the old one is forgotten. */
    suspend fun setServer(url: String, key: String) {
        store.edit { p ->
            p[SERVER_URL] = url.trim().trimEnd('/')
            p[SERVER_KEY] = key.trim()
            p[ONLINE] = false
            listOf(FRIEND_CODE, REGISTERED_AS, PUBLISHED_HASH).forEach { p.remove(it) }
        }
    }

    suspend fun setOnline(value: Boolean) {
        store.edit { p ->
            p[ONLINE] = value
            if (!value) listOf(FRIEND_CODE, REGISTERED_AS, PUBLISHED_HASH, LAST_SYNC).forEach { p.remove(it) }
        }
    }

    suspend fun setRegistered(registeredAs: String, code: String) {
        store.edit { p ->
            p[REGISTERED_AS] = registeredAs
            p[FRIEND_CODE] = code
        }
    }

    suspend fun setFriendCode(code: String) { store.edit { it[FRIEND_CODE] = code } }
    suspend fun setPublishedHash(hash: String) { store.edit { it[PUBLISHED_HASH] = hash } }
    suspend fun setLastSync(at: Long) { store.edit { it[LAST_SYNC] = at } }
    suspend fun setLastPingDay(day: Long) { store.edit { it[LAST_PING] = day } }

    suspend fun setTheme(key: String) { store.edit { it[THEME] = key } }
    suspend fun setViewMode(value: ViewMode) { store.edit { it[VIEW] = value.name } }
    suspend fun setSort(value: SortOrder) { store.edit { it[SORT] = value.name } }
    suspend fun setProfileName(value: String) { store.edit { it[NAME] = value.trim() } }
    suspend fun setShareOptions(status: Boolean, ratings: Boolean) {
        store.edit {
            it[SHARE_STATUS] = status
            it[SHARE_RATINGS] = ratings
        }
    }
    suspend fun setGoogleBooksKey(value: String) { store.edit { it[GOOGLE_KEY] = value.trim() } }
    suspend fun setMinutesPerPage(value: Float) { store.edit { it[SPEED] = value.coerceIn(0.3f, 10f) } }
    suspend fun setOnboarded() { store.edit { it[ONBOARDED] = true } }

    /** Adds the theme, or replaces the one with the same id. */
    suspend fun saveCustomTheme(theme: CustomTheme) {
        store.edit { p ->
            val themes = decodeThemes(p[CUSTOM_THEMES]).filter { it.id != theme.id } + theme
            p[CUSTOM_THEMES] = themeJson.encodeToString(ListSerializer(CustomTheme.serializer()), themes)
        }
    }

    suspend fun deleteCustomTheme(id: String) {
        store.edit { p ->
            val themes = decodeThemes(p[CUSTOM_THEMES]).filter { it.id != id }
            p[CUSTOM_THEMES] = themeJson.encodeToString(ListSerializer(CustomTheme.serializer()), themes)
            if (p[THEME] == CustomTheme.PREFIX + id) p[THEME] = Settings.THEME_SYSTEM
        }
    }

    suspend fun setTimer(timer: TimerState?) {
        store.edit { p ->
            if (timer == null) {
                listOf(TIMER_BOOK, TIMER_SINCE, TIMER_ACC, TIMER_STARTED).forEach { p.remove(it) }
                p.remove(TIMER_PAGE)
            } else {
                p[TIMER_BOOK] = timer.bookId
                p[TIMER_SINCE] = timer.runningSince ?: 0
                p[TIMER_ACC] = timer.accumulatedSeconds
                p[TIMER_STARTED] = timer.startedAt
                p[TIMER_PAGE] = timer.startPage
            }
        }
    }

    private fun decodeThemes(text: String?): List<CustomTheme> =
        text?.let { runCatching { themeJson.decodeFromString(ListSerializer(CustomTheme.serializer()), it) }.getOrNull() }.orEmpty()

    private inline fun <reified T : Enum<T>> String?.toEnum(default: T): T =
        this?.let { name -> enumValues<T>().firstOrNull { it.name == name } } ?: default

    private companion object {
        val THEME = stringPreferencesKey("theme")
        val VIEW = stringPreferencesKey("view_mode")
        val SORT = stringPreferencesKey("sort")
        val NAME = stringPreferencesKey("profile_name")
        val USER_ID = stringPreferencesKey("user_id")
        val SHARE_STATUS = booleanPreferencesKey("share_status")
        val SHARE_RATINGS = booleanPreferencesKey("share_ratings")
        val GOOGLE_KEY = stringPreferencesKey("google_books_key")
        val SPEED = floatPreferencesKey("minutes_per_page")
        val ONBOARDED = booleanPreferencesKey("onboarded")
        val TIMER_BOOK = longPreferencesKey("timer_book")
        val TIMER_SINCE = longPreferencesKey("timer_since")
        val TIMER_ACC = longPreferencesKey("timer_accumulated")
        val TIMER_STARTED = longPreferencesKey("timer_started")
        val TIMER_PAGE = intPreferencesKey("timer_page")
        val CUSTOM_THEMES = stringPreferencesKey("custom_themes")
        val MOTION = booleanPreferencesKey("motion")
        val SERVER_URL = stringPreferencesKey("server_url")
        val SERVER_KEY = stringPreferencesKey("server_key")
        val ONLINE = booleanPreferencesKey("online")
        val FRIEND_CODE = stringPreferencesKey("friend_code")
        val SERVER_SECRET = stringPreferencesKey("server_secret")
        val REGISTERED_AS = stringPreferencesKey("registered_as")
        val PUBLISHED_HASH = stringPreferencesKey("published_hash")
        val LAST_SYNC = longPreferencesKey("last_sync")
        val LAST_PING = longPreferencesKey("last_ping_day")
        val themeJson = Json { ignoreUnknownKeys = true }
    }
}
