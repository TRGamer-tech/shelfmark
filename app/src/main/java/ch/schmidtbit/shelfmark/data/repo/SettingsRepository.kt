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
) {
    companion object {
        const val THEME_SYSTEM = "system"
        const val DEFAULT_SPEED = 1.5f
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
    }
}
