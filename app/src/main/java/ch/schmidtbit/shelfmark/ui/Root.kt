@file:OptIn(ExperimentalMaterial3Api::class)

package ch.schmidtbit.shelfmark.ui

import android.content.Intent
import android.net.Uri
import androidx.compose.animation.core.tween
import androidx.compose.animation.EnterTransition
import androidx.compose.animation.ExitTransition
import androidx.compose.animation.scaleIn
import androidx.compose.animation.scaleOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import ch.schmidtbit.shelfmark.ui.components.LocalMotion
import ch.schmidtbit.shelfmark.ui.components.systemAnimationsOff
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.consumeWindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.MenuBook
import androidx.compose.material.icons.rounded.BarChart
import androidx.compose.material.icons.rounded.Bookmarks
import androidx.compose.material.icons.rounded.EditNote
import androidx.compose.material.icons.rounded.FormatQuote
import androidx.compose.material.icons.rounded.Group
import androidx.compose.material.icons.rounded.QrCodeScanner
import androidx.compose.material.icons.rounded.Search
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Badge
import androidx.compose.material3.BadgedBox
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.core.content.IntentCompat
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.navigation.NavDestination.Companion.hasRoute
import androidx.navigation.NavGraph.Companion.findStartDestination
import androidx.navigation.NavHostController
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import androidx.navigation.toRoute
import ch.schmidtbit.shelfmark.AppContainer
import ch.schmidtbit.shelfmark.R
import ch.schmidtbit.shelfmark.data.model.Book
import ch.schmidtbit.shelfmark.data.repo.ImportResult
import ch.schmidtbit.shelfmark.data.repo.RejectReason
import ch.schmidtbit.shelfmark.ui.add.ScanScreen
import ch.schmidtbit.shelfmark.ui.add.SearchScreen
import ch.schmidtbit.shelfmark.ui.detail.BookScreen
import ch.schmidtbit.shelfmark.ui.detail.TimerScreen
import ch.schmidtbit.shelfmark.ui.edit.EditScreen
import ch.schmidtbit.shelfmark.ui.friends.FriendLibraryScreen
import ch.schmidtbit.shelfmark.ui.friends.FriendsScreen
import ch.schmidtbit.shelfmark.ui.friends.LoansScreen
import ch.schmidtbit.shelfmark.ui.library.LibraryScreen
import ch.schmidtbit.shelfmark.ui.library.LibraryViewModel
import ch.schmidtbit.shelfmark.ui.lists.ListsScreen
import androidx.lifecycle.compose.LifecycleResumeEffect
import ch.schmidtbit.shelfmark.work.Notifier
import ch.schmidtbit.shelfmark.ui.friends.ChooseLibraryDialog
import ch.schmidtbit.shelfmark.ui.nav.BookRoute
import ch.schmidtbit.shelfmark.ui.nav.CalendarRoute
import ch.schmidtbit.shelfmark.ui.nav.MilestonesRoute
import ch.schmidtbit.shelfmark.ui.nav.RecapRoute
import ch.schmidtbit.shelfmark.ui.nav.EditRoute
import ch.schmidtbit.shelfmark.ui.nav.FriendRoute
import ch.schmidtbit.shelfmark.ui.nav.FriendsRoute
import ch.schmidtbit.shelfmark.ui.nav.GoalsRoute
import ch.schmidtbit.shelfmark.ui.nav.LibraryRoute
import ch.schmidtbit.shelfmark.ui.nav.ListsRoute
import ch.schmidtbit.shelfmark.ui.nav.LoansRoute
import ch.schmidtbit.shelfmark.ui.nav.QuoteRoute
import ch.schmidtbit.shelfmark.ui.nav.QuotesRoute
import ch.schmidtbit.shelfmark.ui.nav.ScanRoute
import ch.schmidtbit.shelfmark.ui.nav.SearchRoute
import ch.schmidtbit.shelfmark.ui.nav.SettingsRoute
import ch.schmidtbit.shelfmark.ui.nav.StatsRoute
import ch.schmidtbit.shelfmark.ui.nav.TimerRoute
import ch.schmidtbit.shelfmark.ui.quotes.QuoteEditScreen
import ch.schmidtbit.shelfmark.ui.quotes.QuotesScreen
import ch.schmidtbit.shelfmark.ui.settings.SettingsScreen
import ch.schmidtbit.shelfmark.ui.stats.CalendarScreen
import ch.schmidtbit.shelfmark.ui.stats.GoalsScreen
import ch.schmidtbit.shelfmark.ui.stats.MilestonesScreen
import ch.schmidtbit.shelfmark.ui.stats.RecapScreen
import ch.schmidtbit.shelfmark.ui.stats.StatsScreen
import ch.schmidtbit.shelfmark.ui.theme.ShelfmarkTheme
import kotlinx.coroutines.flow.MutableStateFlow
import kotlin.reflect.KClass

private const val TRANSITION_MS = 180

private data class TopTab(val route: Any, val type: KClass<*>, val label: Int, val icon: ImageVector, val tag: String)

private val TopTabs = listOf(
    TopTab(LibraryRoute, LibraryRoute::class, R.string.tab_library, Icons.AutoMirrored.Rounded.MenuBook, "tabLibrary"),
    TopTab(ListsRoute, ListsRoute::class, R.string.tab_lists, Icons.Rounded.Bookmarks, "tabLists"),
    TopTab(StatsRoute, StatsRoute::class, R.string.tab_stats, Icons.Rounded.BarChart, "tabStats"),
    TopTab(QuotesRoute, QuotesRoute::class, R.string.tab_quotes, Icons.Rounded.FormatQuote, "tabQuotes"),
    TopTab(FriendsRoute, FriendsRoute::class, R.string.tab_friends, Icons.Rounded.Group, "tabFriends"),
)

/** The whole app: theme, first-run introduction, then the tabs and everything behind them. */
@Composable
fun ShelfmarkRoot(container: AppContainer, incoming: MutableStateFlow<Intent?>) {
    val settings by container.settings.settings.collectAsStateWithLifecycle(initialValue = null)
    val current = settings ?: return
    val context = LocalContext.current
    val importer = remember(container) { ImportController(container, context) }
    CompositionLocalProvider(LocalContainer provides container, LocalImporter provides importer) {
        ShelfmarkTheme(current.theme, current.customThemes) {
            // Movement is the user's choice, and off where the phone has animations switched off.
            CompositionLocalProvider(LocalMotion provides (current.motion && !systemAnimationsOff())) {
                Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
                    if (current.onboarded) MainNav(incoming) else Onboarding(current)
                }
            }
        }
    }
}

@Composable
private fun MainNav(incoming: MutableStateFlow<Intent?>) {
    val motion = LocalMotion.current
    val container = LocalContainer.current
    val importer = LocalImporter.current
    val nav = rememberNavController()
    val libraryViewModel = containerViewModel { LibraryViewModel(it) }
    val entry by nav.currentBackStackEntryAsState()
    val destination = entry?.destination
    // Loans in which the next tap is the reader's own.
    val waitingLoans by container.social.waitingLoans.collectAsStateWithLifecycle(initialValue = 0)
    var adding by rememberSaveable { mutableStateOf(false) }
    val back: () -> Unit = { nav.popBackStack() }

    fun openTab(route: Any) = nav.navigate(route) {
        popUpTo(nav.graph.findStartDestination().id) { saveState = true }
        launchSingleTop = true
        restoreState = true
    }
    // After adding a book the add screens are dropped, so Back leads to the shelf.
    fun openNewBook(id: Long) = nav.navigate(BookRoute(id)) { popUpTo<LibraryRoute>() }
    fun openEditor(draft: Book) {
        container.draft = draft
        nav.navigate(EditRoute())
    }

    Scaffold(
        contentWindowInsets = WindowInsets(0, 0, 0, 0),
        bottomBar = {
            if (TopTabs.any { destination?.hasRoute(it.type) == true }) {
                NavigationBar {
                    TopTabs.forEach { tab ->
                        NavigationBarItem(
                            selected = destination?.hasRoute(tab.type) == true,
                            onClick = { openTab(tab.route) },
                            icon = {
                                if (tab.route == FriendsRoute && waitingLoans > 0) {
                                    BadgedBox(badge = { Badge(Modifier.testTag("loansBadge")) { Text(waitingLoans.toString()) } }) { Icon(tab.icon, contentDescription = null) }
                                } else {
                                    Icon(tab.icon, contentDescription = null)
                                }
                            },
                            label = { Text(stringResource(tab.label), maxLines = 1) },
                            modifier = Modifier.testTag(tab.tag),
                        )
                    }
                }
            }
        },
    ) { padding ->
        // Short fades: during a transition the screen that leaves still covers the new one
        // and takes its taps, so a long crossfade makes buttons feel dead.
        NavHost(
            navController = nav,
            startDestination = LibraryRoute,
            modifier = Modifier.padding(padding).consumeWindowInsets(padding),
            // A new page rises into place, the old one sinks back. A book comes forward
            // out of the shelf (see its route below).
            enterTransition = { fadeIn(tween(TRANSITION_MS)) + if (motion) slideInVertically(tween(TRANSITION_MS)) { it / 36 } else EnterTransition.None },
            exitTransition = { fadeOut(tween(TRANSITION_MS)) },
            popEnterTransition = { fadeIn(tween(TRANSITION_MS)) },
            popExitTransition = { fadeOut(tween(TRANSITION_MS)) + if (motion) slideOutVertically(tween(TRANSITION_MS)) { it / 36 } else ExitTransition.None },
        ) {
            composable<LibraryRoute> {
                LibraryScreen(libraryViewModel, onOpenBook = { nav.navigate(BookRoute(it)) }, onAdd = { adding = true }, onSettings = { nav.navigate(SettingsRoute) })
            }
            composable<ListsRoute> {
                ListsScreen(libraryViewModel) { filter ->
                    libraryViewModel.setFilter(filter)
                    openTab(LibraryRoute)
                }
            }
            composable<StatsRoute> {
                StatsScreen(
                    onGoals = { nav.navigate(GoalsRoute) },
                    onCalendar = { nav.navigate(CalendarRoute) },
                    onRecap = { nav.navigate(RecapRoute) },
                    onMilestones = { nav.navigate(MilestonesRoute) },
                )
            }
            composable<CalendarRoute> { CalendarScreen(onBack = back, onOpenBook = { nav.navigate(BookRoute(it)) }) }
            composable<RecapRoute> { RecapScreen(onBack = back, onOpenBook = { nav.navigate(BookRoute(it)) }) }
            composable<MilestonesRoute> { MilestonesScreen(onBack = back, onOpenBook = { nav.navigate(BookRoute(it)) }) }
            composable<QuotesRoute> { QuotesScreen(onAdd = { nav.navigate(QuoteRoute()) }, onEdit = { nav.navigate(QuoteRoute(quoteId = it)) }) }
            composable<FriendsRoute> {
                FriendsScreen(onOpenFriend = { nav.navigate(FriendRoute(it)) }, onLoans = { nav.navigate(LoansRoute) }, onOpenBook = { nav.navigate(BookRoute(it)) })
            }
            composable<BookRoute>(
                enterTransition = { fadeIn(tween(TRANSITION_MS)) + if (motion) scaleIn(tween(TRANSITION_MS), initialScale = 0.93f) else EnterTransition.None },
                popExitTransition = { fadeOut(tween(TRANSITION_MS)) + if (motion) scaleOut(tween(TRANSITION_MS), targetScale = 0.93f) else ExitTransition.None },
            ) { stackEntry ->
                val route = stackEntry.toRoute<BookRoute>()
                BookScreen(
                    bookId = route.id,
                    onBack = back,
                    onEdit = { nav.navigate(EditRoute(route.id)) },
                    onAddQuote = { nav.navigate(QuoteRoute(bookId = route.id)) },
                    onEditQuote = { nav.navigate(QuoteRoute(quoteId = it)) },
                    onTimer = { nav.navigate(TimerRoute(route.id)) },
                )
            }
            composable<EditRoute> { stackEntry ->
                val route = stackEntry.toRoute<EditRoute>()
                EditScreen(route.id, onBack = back, onSaved = { id -> if (route.id == 0L) openNewBook(id) else nav.popBackStack() })
            }
            composable<ScanRoute> { ScanScreen(onBack = back, onOpenBook = ::openNewBook, onManual = ::openEditor) }
            composable<SearchRoute> { stackEntry ->
                SearchScreen(stackEntry.toRoute<SearchRoute>().query, onBack = back, onOpenBook = ::openNewBook, onManual = ::openEditor, onScan = { nav.navigate(ScanRoute) })
            }
            composable<QuoteRoute> { stackEntry ->
                val route = stackEntry.toRoute<QuoteRoute>()
                QuoteEditScreen(route.quoteId, route.bookId, onBack = back)
            }
            composable<TimerRoute> { stackEntry -> TimerScreen(stackEntry.toRoute<TimerRoute>().bookId, onBack = back) }
            composable<GoalsRoute> { GoalsScreen(onBack = back) }
            composable<FriendRoute> { stackEntry -> FriendLibraryScreen(stackEntry.toRoute<FriendRoute>().id, onBack = back) }
            composable<LoansRoute> { LoansScreen(onBack = back, onOpenBook = { nav.navigate(BookRoute(it)) }) }
            composable<SettingsRoute> { SettingsScreen(onBack = back) }
        }
    }

    if (adding) {
        AddSheet(
            onDismiss = { adding = false },
            onScan = { adding = false; nav.navigate(ScanRoute) },
            onSearch = { adding = false; nav.navigate(SearchRoute()) },
            onManual = { adding = false; openEditor(Book(title = "")) },
        )
    }

    ImportDialogs(nav)

    // Signing in on a device that already has books, with an account that has books too.
    val choice by container.choice.collectAsState()
    choice?.let { open ->
        ChooseLibraryDialog(open) { keep ->
            container.choice.value = null
            if (keep != null) container.launch { container.remember(container.server.choose(keep)) }
        }
    }

    // In front, the app looks at the server right away and then once a minute: the other
    // side of a loan may tap at any time. Out of sight it asks nothing.
    LifecycleResumeEffect(Unit) {
        val watching = container.launch { container.watchServer() }
        onPauseOrDispose { watching.cancel() }
    }

    // Files and text that other apps hand to Shelfmark. The work runs in the app scope:
    // clearing the slot restarts this effect, and that must not cancel a running import.
    val intent by incoming.collectAsState()
    LaunchedEffect(intent) {
        val received = intent ?: return@LaunchedEffect
        incoming.value = null
        fun asQuote(text: String) {
            container.pendingQuoteText = text
            nav.navigate(QuoteRoute())
        }
        when (received.action) {
            Notifier.ACTION_OPEN_LOANS -> nav.navigate(LoansRoute) { launchSingleTop = true }
            Intent.ACTION_VIEW -> received.data?.let(importer::open)
            Intent.ACTION_SEND -> {
                val stream = IntentCompat.getParcelableExtra(received, Intent.EXTRA_STREAM, Uri::class.java)
                val text = received.getStringExtra(Intent.EXTRA_TEXT)
                when {
                    stream != null -> importer.open(stream)
                    // Plain text that is not Shelfmark data is meant as a quote.
                    !text.isNullOrBlank() -> container.launch { if (!importer.openText(text, reportUnknown = false)) asQuote(text) }
                }
            }
            Intent.ACTION_PROCESS_TEXT -> received.getCharSequenceExtra(Intent.EXTRA_PROCESS_TEXT)?.toString()?.takeIf { it.isNotBlank() }?.let(::asQuote)
        }
    }
}

/** The three ways to add a book. */
@Composable
private fun AddSheet(onDismiss: () -> Unit, onScan: () -> Unit, onSearch: () -> Unit, onManual: () -> Unit) {
    ModalBottomSheet(onDismissRequest = onDismiss) {
        Column(Modifier.fillMaxWidth().navigationBarsPadding().padding(bottom = 16.dp)) {
            Text(stringResource(R.string.add_book), style = MaterialTheme.typography.titleLarge, modifier = Modifier.padding(horizontal = 24.dp, vertical = 8.dp))
            AddOption(Icons.Rounded.QrCodeScanner, stringResource(R.string.add_scan), stringResource(R.string.add_scan_hint), "addScan", onScan)
            AddOption(Icons.Rounded.Search, stringResource(R.string.add_search), stringResource(R.string.add_search_hint), "addSearch", onSearch)
            AddOption(Icons.Rounded.EditNote, stringResource(R.string.add_manual), stringResource(R.string.add_manual_hint), "addManual", onManual)
        }
    }
}

@Composable
private fun AddOption(icon: ImageVector, title: String, hint: String, tag: String, onClick: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().clickable(onClick = onClick).padding(horizontal = 24.dp, vertical = 14.dp).testTag(tag),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(icon, contentDescription = null, tint = MaterialTheme.colorScheme.primary)
        Spacer(Modifier.width(20.dp))
        Column {
            Text(title, style = MaterialTheme.typography.titleMedium)
            Text(hint, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

/** Tells the user what an opened file was, and asks where an answer is needed. */
@Composable
private fun ImportDialogs(nav: NavHostController) {
    val container = LocalContainer.current
    val importer = LocalImporter.current
    val outcome = importer.outcome ?: return
    val close = { importer.outcome = null }

    @Composable
    fun info(title: String, text: String, action: String? = null, onAction: () -> Unit = {}) {
        AlertDialog(
            onDismissRequest = close,
            title = { Text(title) },
            text = { Text(text) },
            confirmButton = {
                if (action != null) TextButton(onClick = { close(); onAction() }, modifier = Modifier.testTag("importAction")) { Text(action) }
                else TextButton(onClick = close) { Text(stringResource(R.string.action_ok)) }
            },
            dismissButton = { if (action != null) TextButton(onClick = close) { Text(stringResource(R.string.action_close)) } },
            modifier = Modifier.testTag("importDialog"),
        )
    }

    when (outcome) {
        is ImportOutcome.Done -> when (val result = outcome.result) {
            is ImportResult.LibraryImported -> info(
                stringResource(R.string.import_library_title),
                stringResource(R.string.import_library_text, result.name, pluralStringResource(R.plurals.book_count, result.bookCount, result.bookCount)),
                stringResource(R.string.import_library_open),
            ) { nav.navigate(FriendRoute(result.friendId)) }
            is ImportResult.BackupFound -> close()
            is ImportResult.Rejected -> info(
                stringResource(R.string.import_failed_title),
                stringResource(
                    when (result.reason) {
                        RejectReason.NOT_SHELFMARK -> R.string.import_not_shelfmark
                        RejectReason.OWN_LIBRARY -> R.string.import_own_library
                        RejectReason.NEWER_VERSION -> R.string.import_newer_version
                        RejectReason.OLD_REQUEST -> R.string.import_old_request
                    },
                ),
            )
        }
        is ImportOutcome.ConfirmRestore -> AlertDialog(
            onDismissRequest = close,
            title = { Text(stringResource(R.string.restore_title)) },
            text = {
                Text(
                    stringResource(R.string.restore_text) +
                        (outcome.bookCount?.let { "\n\n" + pluralStringResource(R.plurals.book_count, it, it) } ?: ""),
                )
            },
            confirmButton = { TextButton(onClick = { importer.confirmRestore(outcome) }, modifier = Modifier.testTag("restoreConfirm")) { Text(stringResource(R.string.restore_confirm)) } },
            dismissButton = { TextButton(onClick = close) { Text(stringResource(R.string.action_cancel)) } },
        )
        is ImportOutcome.ConfirmImport -> AlertDialog(
            onDismissRequest = close,
            title = { Text(stringResource(R.string.import_books_title, outcome.plan.source)) },
            text = {
                Text(
                    pluralStringResource(R.plurals.import_new_books, outcome.newBooks, outcome.newBooks) + "\n" +
                        pluralStringResource(R.plurals.import_known_books, outcome.known, outcome.known),
                )
            },
            confirmButton = { TextButton(onClick = { importer.confirmImport(outcome) }, modifier = Modifier.testTag("importConfirm")) { Text(stringResource(R.string.import_books_confirm)) } },
            dismissButton = { TextButton(onClick = close) { Text(stringResource(R.string.action_cancel)) } },
            modifier = Modifier.testTag("importBooksDialog"),
        )
        is ImportOutcome.Imported -> info(
            stringResource(R.string.import_books_done),
            pluralStringResource(R.plurals.import_added, outcome.added, outcome.added) + "\n" +
                pluralStringResource(R.plurals.import_completed, outcome.completed, outcome.completed) + "\n\n" + stringResource(R.string.import_books_covers),
            stringResource(R.string.cover_find_missing),
        ) { container.findMissingCovers() }
        is ImportOutcome.Restored -> info(
            stringResource(R.string.restore_done_title),
            pluralStringResource(R.plurals.book_count, outcome.books, outcome.books),
        )
        ImportOutcome.Unreadable -> info(stringResource(R.string.import_failed_title), stringResource(R.string.import_unreadable))
    }
}
