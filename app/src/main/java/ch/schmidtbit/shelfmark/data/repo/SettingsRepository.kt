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
    /** Reading speed in minutes per page, used to estimate the time left in a book. */
    val minutesPerPage: Float = DEFAULT_SPEED,
    /** The first-run introduction has been seen. */
    val onboarded: Boolean = false,
    val timer: TimerState? = null,
    /** Themes the user built from four colours. Selected with the key "custom:" plus the id. */
    val customThemes: List<CustomTheme> = emptyList(),
    /** Gentle movement on the shelf: flickering candles, drifting dust, books settling in. */
    val motion: Boolean = true,
    /** What a friend types in to connect with me. Known once signed in. */
    val friendCode: String = "",
    /** The sign-in: a short-lived token for the server, and the one that gets a new one. Empty when signed out. */
    val accessToken: String = "",
    val refreshToken: String = "",
    /** When the access token stops working, in seconds since 1970. */
    val tokenExpiresAt: Long = 0,
    val accountEmail: String = "",
    /** The name the server was last told. */
    val helloName: String? = null,
    /** Fingerprint of the shared library the server has. */
    val publishedHash: String = "",
    /** Revision of the library on the server that this device last brought itself in step with. 0: never. */
    val vaultRevision: Long = 0,
    /** Fingerprint of the library as it was at that moment, to notice changes made here since. */
    val vaultHash: String = "",
    val lastSyncAt: Long = 0,
    /** Epoch day of the last daily check that keeps the server awake. */
    val lastPingDay: Long = 0,
) {
    val signedIn: Boolean get() = refreshToken.isNotBlank()

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
            friendCode = p[FRIEND_CODE].orEmpty(),
            accessToken = p[ACCESS_TOKEN].orEmpty(),
            refreshToken = p[REFRESH_TOKEN].orEmpty(),
            tokenExpiresAt = p[TOKEN_EXPIRES] ?: 0,
            accountEmail = p[ACCOUNT_EMAIL].orEmpty(),
            helloName = p[HELLO_NAME],
            publishedHash = p[PUBLISHED_HASH].orEmpty(),
            vaultRevision = p[VAULT_REVISION] ?: 0,
            vaultHash = p[VAULT_HASH].orEmpty(),
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

    suspend fun setMotion(value: Boolean) { store.edit { it[MOTION] = value } }

    /**
     * Stores a sign-in. With [userId] given (a fresh sign-in, not a renewed token) the
     * account becomes who this library belongs to, and everything this device remembered
     * about the server is forgotten, because it was about somebody else or nobody.
     */
    suspend fun setSession(accessToken: String, refreshToken: String, expiresAt: Long, email: String, userId: String? = null) {
        store.edit { p ->
            p[ACCESS_TOKEN] = accessToken
            p[REFRESH_TOKEN] = refreshToken
            p[TOKEN_EXPIRES] = expiresAt
            if (email.isNotBlank()) p[ACCOUNT_EMAIL] = email
            if (userId != null) {
                p[USER_ID] = userId
                listOf(FRIEND_CODE, HELLO_NAME, PUBLISHED_HASH, VAULT_HASH, LAST_SYNC).forEach { p.remove(it) }
                p.remove(VAULT_REVISION)
            }
        }
    }

    /**
     * Signs out on this device. The library stays, and so does the memory of which account
     * it was in step with: signing in to the same account again simply carries on.
     */
    suspend fun clearSession() {
        store.edit { p ->
            listOf(ACCESS_TOKEN, REFRESH_TOKEN, ACCOUNT_EMAIL, FRIEND_CODE, HELLO_NAME, PUBLISHED_HASH).forEach { p.remove(it) }
            listOf(TOKEN_EXPIRES, LAST_SYNC).forEach { p.remove(it) }
        }
    }

    suspend fun setHello(name: String, code: String) {
        store.edit { p ->
            p[HELLO_NAME] = name
            p[FRIEND_CODE] = code
        }
    }

    suspend fun setVault(revision: Long, hash: String) {
        store.edit { p ->
            p[VAULT_REVISION] = revision
            p[VAULT_HASH] = hash
        }
    }

    /** The settings that travel with the account. */
    suspend fun applyPrefs(prefs: ch.schmidtbit.shelfmark.data.share.VaultPrefs) {
        store.edit { p ->
            p[NAME] = prefs.profileName
            p[SHARE_STATUS] = prefs.shareStatus
            p[SHARE_RATINGS] = prefs.shareRatings
            p[SPEED] = prefs.minutesPerPage.coerceIn(0.3f, 10f)
            p[THEME] = prefs.theme
            p[CUSTOM_THEMES] = themeJson.encodeToString(ListSerializer(CustomTheme.serializer()), prefs.customThemes)
            // Words this app does not know (from a newer one, say) leave things as they are.
            enumValues<ViewMode>().firstOrNull { it.name == prefs.viewMode }?.let { p[VIEW] = it.name }
            enumValues<SortOrder>().firstOrNull { it.name == prefs.sort }?.let { p[SORT] = it.name }
            p[MOTION] = prefs.motion
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
        val SPEED = floatPreferencesKey("minutes_per_page")
        val ONBOARDED = booleanPreferencesKey("onboarded")
        val TIMER_BOOK = longPreferencesKey("timer_book")
        val TIMER_SINCE = longPreferencesKey("timer_since")
        val TIMER_ACC = longPreferencesKey("timer_accumulated")
        val TIMER_STARTED = longPreferencesKey("timer_started")
        val TIMER_PAGE = intPreferencesKey("timer_page")
        val CUSTOM_THEMES = stringPreferencesKey("custom_themes")
        val MOTION = booleanPreferencesKey("motion")
        val FRIEND_CODE = stringPreferencesKey("friend_code")
        val ACCESS_TOKEN = stringPreferencesKey("access_token")
        val REFRESH_TOKEN = stringPreferencesKey("refresh_token")
        val TOKEN_EXPIRES = longPreferencesKey("token_expires_at")
        val ACCOUNT_EMAIL = stringPreferencesKey("account_email")
        val HELLO_NAME = stringPreferencesKey("hello_name")
        val PUBLISHED_HASH = stringPreferencesKey("published_hash")
        val VAULT_REVISION = longPreferencesKey("vault_revision")
        val VAULT_HASH = stringPreferencesKey("vault_hash")
        val LAST_SYNC = longPreferencesKey("last_sync")
        val LAST_PING = longPreferencesKey("last_ping_day")
        val themeJson = Json { ignoreUnknownKeys = true }
    }
}
