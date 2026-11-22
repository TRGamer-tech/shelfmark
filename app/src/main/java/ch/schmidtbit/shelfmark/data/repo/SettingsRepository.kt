package ch.schmidtbit.shelfmark.data.repo

import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.intPreferencesKey
import androidx.datastore.preferences.core.stringPreferencesKey
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import java.util.UUID

enum class ThemeMode { SYSTEM, LIGHT, DARK }

/** How the library is drawn: covers on shelf boards, spines side by side, or a plain list. */
enum class ViewMode { COVERS, SPINES, LIST }

enum class SortOrder { ADDED, TITLE, AUTHOR, RATING }

data class Settings(
    val theme: ThemeMode = ThemeMode.SYSTEM,
    val viewMode: ViewMode = ViewMode.COVERS,
    val sort: SortOrder = SortOrder.ADDED,
    val profileName: String = "",
    /** Stable random id that identifies this library to friends. Empty until first needed. */
    val userId: String = "",
    val shareStatus: Boolean = true,
    val shareRatings: Boolean = true,
    val googleBooksKey: String = "",
    /** Books the user wants to finish per year, 0 = no goal. */
    val yearlyGoal: Int = 0,
)

class SettingsRepository(private val store: DataStore<Preferences>) {
    val settings: Flow<Settings> = store.data.map { p ->
        Settings(
            theme = p[THEME].toEnum(ThemeMode.SYSTEM),
            viewMode = p[VIEW].toEnum(ViewMode.COVERS),
            sort = p[SORT].toEnum(SortOrder.ADDED),
            profileName = p[NAME].orEmpty(),
            userId = p[USER_ID].orEmpty(),
            shareStatus = p[SHARE_STATUS] ?: true,
            shareRatings = p[SHARE_RATINGS] ?: true,
            googleBooksKey = p[GOOGLE_KEY].orEmpty(),
            yearlyGoal = p[GOAL] ?: 0,
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

    suspend fun setTheme(value: ThemeMode) { store.edit { it[THEME] = value.name } }
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
    suspend fun setYearlyGoal(value: Int) { store.edit { it[GOAL] = value.coerceIn(0, 999) } }

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
        val GOAL = intPreferencesKey("yearly_goal")
    }
}
