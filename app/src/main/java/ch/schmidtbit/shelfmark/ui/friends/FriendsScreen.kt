@file:OptIn(ExperimentalMaterial3Api::class)

package ch.schmidtbit.shelfmark.ui.friends

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
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
import ch.schmidtbit.shelfmark.R
import ch.schmidtbit.shelfmark.data.model.FriendWithCount
import ch.schmidtbit.shelfmark.data.model.LendRequest
import ch.schmidtbit.shelfmark.data.model.LendStatus
import ch.schmidtbit.shelfmark.data.repo.Settings
import ch.schmidtbit.shelfmark.ui.LocalContainer
import ch.schmidtbit.shelfmark.ui.LocalImporter
import ch.schmidtbit.shelfmark.ui.components.SectionCard
import ch.schmidtbit.shelfmark.ui.components.SectionTitle
import ch.schmidtbit.shelfmark.ui.lists.NameDialog
import java.text.DateFormat
import java.util.Date

/**
 * Sharing works without a server: the library travels as a small file through whatever
 * messenger the friends already use, and so do borrow requests and their answers.
 */
@Composable
fun FriendsScreen(onOpenFriend: (String) -> Unit, onRequests: () -> Unit) {
    val container = LocalContainer.current
    val importer = LocalImporter.current
    val context = LocalContext.current
    val settings by container.settings.settings.collectAsStateWithLifecycle(initialValue = Settings())
    val friends by container.social.friends.collectAsStateWithLifecycle(initialValue = emptyList())
    val requests by container.social.requests.collectAsStateWithLifecycle(initialValue = emptyList())
    var askName by remember { mutableStateOf(false) }
    var shareAfterName by remember { mutableStateOf(false) }

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
        LazyColumn(Modifier.fillMaxSize().padding(padding), contentPadding = PaddingValues(bottom = 32.dp)) {
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
                    Button(
                        onClick = { if (settings.profileName.isBlank()) { shareAfterName = true; askName = true } else shareLibrary() },
                        modifier = Modifier.fillMaxWidth().testTag("shareLibrary"),
                    ) {
                        Icon(Icons.Rounded.Share, contentDescription = null, modifier = Modifier.size(18.dp))
                        Spacer(Modifier.width(8.dp))
                        Text(stringResource(R.string.friends_share_button))
                    }
                    Text(
                        stringResource(R.string.friends_share_explain),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.padding(top = 8.dp),
                    )
                }
            }

            val pending = requests.filter { it.incoming && it.status == LendStatus.PENDING }
            if (pending.isNotEmpty()) {
                item(key = "pendingTitle") { SectionTitle(stringResource(R.string.requests_waiting)) }
                items(pending, key = { "req${it.id}" }) { request ->
                    IncomingRequestCard(request, onAnswer = { accept -> importer.answer(request.id, accept) })
                }
            }
            item(key = "allRequests") {
                Card(
                    onClick = onRequests,
                    colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainer),
                    modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 6.dp).testTag("allRequests"),
                ) {
                    Row(Modifier.padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
                        Text(stringResource(R.string.requests_title), style = MaterialTheme.typography.titleMedium, modifier = Modifier.weight(1f))
                        if (requests.isNotEmpty()) Badge { Text(requests.size.toString()) }
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
                FriendCard(friend, onClick = { onOpenFriend(friend.friend.id) }, onRemove = { container.launch { container.social.deleteFriend(friend.friend.id) } })
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
private fun ToggleRow(title: String, hint: String, checked: Boolean, tag: String, onChange: (Boolean) -> Unit) {
    Row(Modifier.fillMaxWidth().padding(vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f)) {
            Text(title, style = MaterialTheme.typography.bodyLarge)
            Text(hint, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        Switch(checked = checked, onCheckedChange = onChange, modifier = Modifier.testTag(tag))
    }
}

@Composable
fun IncomingRequestCard(request: LendRequest, onAnswer: (Boolean) -> Unit) {
    Card(
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.primaryContainer),
        modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 6.dp).testTag("incomingRequest"),
    ) {
        Column(Modifier.padding(16.dp)) {
            Text(
                stringResource(R.string.request_question, request.peerName.ifBlank { stringResource(R.string.friends_someone) }, request.bookTitle),
                style = MaterialTheme.typography.titleMedium,
            )
            if (request.note.isNotBlank()) Text("„${request.note}“", style = MaterialTheme.typography.bodyMedium, modifier = Modifier.padding(top = 4.dp))
            Spacer(Modifier.height(12.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                OutlinedButton(onClick = { onAnswer(false) }, modifier = Modifier.weight(1f).testTag("answerNo")) { Text(stringResource(R.string.action_no)) }
                Button(onClick = { onAnswer(true) }, modifier = Modifier.weight(1f).testTag("answerYes")) { Text(stringResource(R.string.action_yes)) }
            }
        }
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
                Text(item.friend.name, style = MaterialTheme.typography.titleMedium)
                Text(
                    pluralStringResource(R.plurals.book_count, item.bookCount, item.bookCount) + " · " +
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
