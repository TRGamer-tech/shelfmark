@file:OptIn(ExperimentalMaterial3Api::class)

package ch.schmidtbit.shelfmark.ui.friends

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.ArrowForward
import androidx.compose.material.icons.rounded.FileOpen
import androidx.compose.material.icons.rounded.MoreVert
import androidx.compose.material.icons.rounded.Person
import androidx.compose.material.icons.rounded.Share
import androidx.compose.material3.Badge
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import android.widget.Toast
import androidx.compose.foundation.layout.RowScope
import androidx.compose.material.icons.rounded.Cloud
import ch.schmidtbit.shelfmark.R
import ch.schmidtbit.shelfmark.data.model.Friend
import ch.schmidtbit.shelfmark.data.model.FriendWithCount
import ch.schmidtbit.shelfmark.data.repo.Settings
import ch.schmidtbit.shelfmark.ui.LocalContainer
import ch.schmidtbit.shelfmark.ui.LocalImporter
import ch.schmidtbit.shelfmark.ui.components.ConfirmDelete
import ch.schmidtbit.shelfmark.ui.components.SectionCard
import ch.schmidtbit.shelfmark.ui.components.SectionTitle
import ch.schmidtbit.shelfmark.ui.lists.NameDialog
import java.text.DateFormat
import java.util.Date

/**
 * The account, what friends may see, the loans, and the friends themselves. A shelf can
 * also be shown to somebody without an account: it travels as a small file through whatever
 * messenger they already use. Borrowing needs both sides signed in.
 */
@Composable
fun FriendsScreen(onOpenFriend: (String) -> Unit, onLoans: () -> Unit, onOpenBook: (Long) -> Unit) {
    val container = LocalContainer.current
    val importer = LocalImporter.current
    val context = LocalContext.current
    val settings by container.settings.settings.collectAsStateWithLifecycle(initialValue = Settings())
    val friends by container.social.friends.collectAsStateWithLifecycle(initialValue = emptyList())
    val loans by container.social.loans.collectAsStateWithLifecycle(initialValue = emptyList())
    val library by container.library.books.collectAsStateWithLifecycle(initialValue = emptyList())
    var askName by remember { mutableStateOf(false) }
    var removing by remember { mutableStateOf<Friend?>(null) }
    var shareAfterName by remember { mutableStateOf(false) }
    // The card for the server only shows where there is a server to talk to.
    val hasServer = container.server.available

    val openFile = rememberLauncherForActivityResult(ActivityResultContracts.GetContent()) { uri -> if (uri != null) importer.open(uri) }

    fun shareLibrary() {
        container.launch {
            val envelope = container.social.exportLibrary(settings.shareStatus, settings.shareRatings)
            val name = container.settings.current().profileName
            importer.share(
                envelope,
                baseName = context.getString(R.string.share_library_file, name),
                subject = context.getString(R.string.share_library_subject, name),
                message = context.getString(R.string.share_library_message, name),
            )
        }
    }

    Scaffold(
        topBar = { TopAppBar(title = { Text(stringResource(R.string.tab_friends), style = MaterialTheme.typography.headlineSmall) }) },
    ) { padding ->
        LazyColumn(Modifier.fillMaxSize().padding(padding).testTag("friends"), contentPadding = PaddingValues(bottom = 32.dp)) {
            // Always the first item, even when empty: an item that appears above the top
            // later would stay out of sight, because the list holds on to what it shows.
            item(key = "online") { if (hasServer) AccountCard(settings) }
            item(key = "share") {
                SectionCard(stringResource(R.string.friends_share_title)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Icon(Icons.Rounded.Person, contentDescription = null, tint = MaterialTheme.colorScheme.primary)
                        Spacer(Modifier.width(10.dp))
                        Text(
                            settings.profileName.ifBlank { stringResource(R.string.friends_no_name) },
                            style = MaterialTheme.typography.titleMedium,
                            modifier = Modifier.weight(1f),
                        )
                        TextButton(onClick = { shareAfterName = false; askName = true }, modifier = Modifier.testTag("editName")) {
                            Text(stringResource(R.string.friends_change_name))
                        }
                    }
                    ToggleRow(stringResource(R.string.friends_share_status), stringResource(R.string.friends_share_status_hint), settings.shareStatus, "shareStatus") {
                        container.launch { container.settings.setShareOptions(it, settings.shareRatings) }
                    }
                    ToggleRow(stringResource(R.string.friends_share_ratings), stringResource(R.string.friends_share_ratings_hint), settings.shareRatings, "shareRatings") {
                        container.launch { container.settings.setShareOptions(settings.shareStatus, it) }
                    }
                    Spacer(Modifier.height(8.dp))
                    // Once connected to the server, the file is the way for friends who are not.
                    val shareByFile: @Composable (@Composable RowScope.() -> Unit) -> Unit = { content ->
                        val click = { if (settings.profileName.isBlank()) { shareAfterName = true; askName = true } else shareLibrary() }
                        if (settings.signedIn) OutlinedButton(onClick = click, modifier = Modifier.fillMaxWidth().testTag("shareLibrary"), content = content)
                        else Button(onClick = click, modifier = Modifier.fillMaxWidth().testTag("shareLibrary"), content = content)
                    }
                    shareByFile {
                        Icon(Icons.Rounded.Share, contentDescription = null, modifier = Modifier.size(18.dp))
                        Spacer(Modifier.width(8.dp))
                        Text(stringResource(R.string.friends_share_button))
                    }
                    Text(
                        stringResource(if (settings.signedIn) R.string.friends_share_explain_online else R.string.friends_share_explain),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.padding(top = 8.dp),
                    )
                }
            }

            // What waits for a tap of the reader's own stands right here. Everything else is one tap away.
            val waiting = loans.filter { it.waitsForMe }
            if (waiting.isNotEmpty()) {
                item(key = "waitingTitle") { SectionTitle(stringResource(R.string.loans_waiting)) }
                items(waiting, key = { "loan${it.id}" }) { loan ->
                    val book = bookOfLoan(loan, library)
                    LoanCard(loan, onOpenBook = book?.let { { onOpenBook(it.id) } })
                }
            }
            item(key = "allLoans") {
                Card(
                    onClick = onLoans,
                    colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainer),
                    modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 6.dp).testTag("allLoans"),
                ) {
                    Row(Modifier.padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
                        Text(stringResource(R.string.loans_title), style = MaterialTheme.typography.titleMedium, modifier = Modifier.weight(1f))
                        if (waiting.isNotEmpty()) Badge { Text(waiting.size.toString()) }
                        Spacer(Modifier.width(8.dp))
                        Icon(Icons.AutoMirrored.Rounded.ArrowForward, contentDescription = null)
                    }
                }
            }

            item(key = "friendsTitle") {
                Row(Modifier.fillMaxWidth().padding(end = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                    SectionTitle(stringResource(R.string.friends_libraries), Modifier.weight(1f))
                    TextButton(onClick = { openFile.launch("*/*") }, modifier = Modifier.testTag("openFile")) {
                        Icon(Icons.Rounded.FileOpen, contentDescription = null)
                        Spacer(Modifier.width(4.dp))
                        Text(stringResource(R.string.friends_open_file))
                    }
                }
            }
            if (friends.isEmpty()) {
                item(key = "noFriends") {
                    Text(
                        stringResource(R.string.friends_empty),
                        style = MaterialTheme.typography.bodyLarge,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp),
                    )
                }
            }
            items(friends, key = { it.friend.id }) { friend ->
                FriendCard(
                    friend,
                    onClick = { onOpenFriend(friend.friend.id) },
                    onRemove = { removing = friend.friend },
                )
            }
        }
    }

    removing?.let { friend ->
        ConfirmDelete(
            title = stringResource(R.string.friends_remove_title, friend.name),
            text = stringResource(R.string.friends_remove_text),
            confirm = stringResource(R.string.friends_remove),
            onDismiss = { removing = null },
        ) {
            removing = null
            container.launch {
                if (!container.server.removeFriend(friend.id)) Toast.makeText(context, R.string.server_error_network, Toast.LENGTH_LONG).show()
            }
        }
    }

    if (askName) {
        NameDialog(stringResource(R.string.friends_name_title), settings.profileName, { askName = false }) { name ->
            askName = false
            container.launch {
                container.settings.setProfileName(name)
                if (shareAfterName) shareLibrary()
            }
        }
    }
}

@Composable
fun ToggleRow(title: String, hint: String, checked: Boolean, tag: String, onChange: (Boolean) -> Unit) {
    Row(Modifier.fillMaxWidth().padding(vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f)) {
            Text(title, style = MaterialTheme.typography.bodyLarge)
            Text(hint, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        Switch(checked = checked, onCheckedChange = onChange, modifier = Modifier.testTag(tag))
    }
}

@Composable
private fun FriendCard(item: FriendWithCount, onClick: () -> Unit, onRemove: () -> Unit) {
    var menu by remember { mutableStateOf(false) }
    Card(
        onClick = onClick,
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainer),
        modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 6.dp).testTag("friendCard"),
    ) {
        Row(Modifier.padding(start = 16.dp, top = 12.dp, bottom = 12.dp, end = 4.dp), verticalAlignment = Alignment.CenterVertically) {
            Icon(Icons.Rounded.Person, contentDescription = null, tint = MaterialTheme.colorScheme.primary, modifier = Modifier.size(32.dp))
            Spacer(Modifier.width(14.dp))
            Column(Modifier.weight(1f)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(item.friend.name, style = MaterialTheme.typography.titleMedium)
                    if (item.friend.online) {
                        Spacer(Modifier.width(6.dp))
                        Icon(Icons.Rounded.Cloud, contentDescription = stringResource(R.string.server_friend_online), tint = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.size(16.dp).testTag("friendOnline"))
                    }
                }
                Text(
                    pluralStringResource(R.plurals.book_count, item.bookCount, item.bookCount) +
                        // A friend through the server is always up to date, a date says nothing there.
                        if (item.friend.online || item.friend.sharedAt <= 0) "" else " · " +
                            stringResource(R.string.friends_shared_on, DateFormat.getDateInstance(DateFormat.MEDIUM).format(Date(item.friend.sharedAt))),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            Box {
                IconButton(onClick = { menu = true }) { Icon(Icons.Rounded.MoreVert, contentDescription = stringResource(R.string.action_more)) }
                DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                    DropdownMenuItem(text = { Text(stringResource(R.string.friends_remove)) }, onClick = { menu = false; onRemove() })
                }
            }
        }
    }
}
