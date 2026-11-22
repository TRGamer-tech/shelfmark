package ch.schmidtbit.shelfmark.ui.nav

import kotlinx.serialization.Serializable

// Top level tabs
@Serializable data object LibraryRoute
@Serializable data object ListsRoute
@Serializable data object StatsRoute
@Serializable data object QuotesRoute
@Serializable data object FriendsRoute

// Everything else
@Serializable data class BookRoute(val id: Long)
/** id = 0 creates a new book, prefilled from the draft the scanner or search left behind. */
@Serializable data class EditRoute(val id: Long = 0)
@Serializable data object ScanRoute
@Serializable data class SearchRoute(val query: String = "")
/** quoteId = 0 creates a new quote, optionally for a given book. */
@Serializable data class QuoteRoute(val quoteId: Long = 0, val bookId: Long = 0)
@Serializable data class TimerRoute(val bookId: Long)
@Serializable data object GoalsRoute
@Serializable data object CalendarRoute
@Serializable data object RecapRoute
@Serializable data object MilestonesRoute
@Serializable data class FriendRoute(val id: String)
@Serializable data object RequestsRoute
@Serializable data object SettingsRoute
