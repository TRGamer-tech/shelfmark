package ch.schmidtbit.shelfmark.ui.friends

import android.Manifest
import android.content.ClipData
import android.content.ClipboardManager
import android.os.Build
import android.widget.Toast
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Cloud
import androidx.compose.material.icons.rounded.ContentCopy
import androidx.compose.material.icons.rounded.PersonAdd
import androidx.compose.material.icons.rounded.Refresh
import androidx.compose.material.icons.rounded.Share
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
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
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import ch.schmidtbit.shelfmark.R
import ch.schmidtbit.shelfmark.data.repo.Settings
import ch.schmidtbit.shelfmark.data.repo.SyncResult
import ch.schmidtbit.shelfmark.data.server.ServerException
import ch.schmidtbit.shelfmark.data.share.ShareFiles
import ch.schmidtbit.shelfmark.ui.LocalContainer
import ch.schmidtbit.shelfmark.ui.components.SectionCard
import ch.schmidtbit.shelfmark.ui.lists.NameDialog
import ch.schmidtbit.shelfmark.work.Notifier
import java.text.DateFormat
import java.util.Date

/** Says in the user's words why the server did not do what was asked. */
@Composable
fun serverProblem(reason: String): String = stringResource(
    when (reason) {
        "network" -> R.string.server_error_network
        "setup" -> R.string.server_error_setup
        "key" -> R.string.server_error_key
        "unknown_code" -> R.string.server_error_unknown_code
        "own_code" -> R.string.server_error_own_code
        "full" -> R.string.server_error_full
        "forbidden" -> R.string.server_error_forbidden
        "no_server" -> R.string.server_error_none
        else -> R.string.server_error_other
    },
    reason,
)

/** "ABCDEFGHJK" reads better as "ABCDE-FGHJK". */
fun displayCode(code: String): String = code.chunked(5).joinToString("-")

/**
 * The way to friends without sending files: connect once, hand out a code, and from then
 * on libraries and borrow requests find their way by themselves.
 */
@Composable
fun OnlineCard(settings: Settings) {
    val container = LocalContainer.current
    val context = LocalContext.current
    val status by container.server.status.collectAsStateWithLifecycle()
    val waiting by container.server.waiting.collectAsStateWithLifecycle(initialValue = 0)
    var busy by remember { mutableStateOf(false) }
    var problem by remember { mutableStateOf<String?>(null) }
    var askName by remember { mutableStateOf(false) }
    var adding by remember { mutableStateOf(false) }
    val askNotifications = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { }

    fun connect() {
        busy = true
        problem = null
        container.launch {
            val result = container.server.connect()
            busy = false
            problem = (result as? SyncResult.Failed)?.reason
            // A request from a friend should not have to wait until the app is opened.
            if (result is SyncResult.Done && Build.VERSION.SDK_INT >= 33 && !Notifier.allowed(context)) {
                runCatching { askNotifications.launch(Manifest.permission.POST_NOTIFICATIONS) }
            }
        }
    }

    // Between "connect" and the first answer of the server there is no code to show yet.
    val connected = settings.online && settings.friendCode.isNotBlank()
    SectionCard(stringResource(R.string.server_title), Modifier.testTag("onlineCard")) {
        if (!connected) {
            Row(verticalAlignment = Alignment.Top) {
                Icon(Icons.Rounded.Cloud, contentDescription = null, tint = MaterialTheme.colorScheme.primary)
                Spacer(Modifier.width(10.dp))
                Text(stringResource(R.string.server_pitch), style = MaterialTheme.typography.bodyMedium, modifier = Modifier.weight(1f))
            }
            Spacer(Modifier.height(10.dp))
            Button(
                onClick = { if (settings.profileName.isBlank()) askName = true else connect() },
                enabled = !busy && !settings.online,
                modifier = Modifier.fillMaxWidth().testTag("connectOnline"),
            ) {
                if (busy || settings.online) {
                    CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp, color = MaterialTheme.colorScheme.onPrimary)
                    Spacer(Modifier.width(8.dp))
                }
                Text(stringResource(R.string.server_connect))
            }
        } else {
            Text(stringResource(R.string.server_your_code), style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    displayCode(settings.friendCode),
                    style = MaterialTheme.typography.headlineSmall.copy(fontFamily = FontFamily.Monospace, fontWeight = FontWeight.Bold, letterSpacing = 1.sp),
                    color = MaterialTheme.colorScheme.primary,
                    modifier = Modifier.weight(1f).testTag("friendCode"),
                )
                IconButton(onClick = {
                    context.getSystemService(ClipboardManager::class.java)?.setPrimaryClip(ClipData.newPlainText("Shelfmark", displayCode(settings.friendCode)))
                    Toast.makeText(context, R.string.server_code_copied, Toast.LENGTH_SHORT).show()
                }) { Icon(Icons.Rounded.ContentCopy, contentDescription = stringResource(R.string.server_copy_code)) }
                IconButton(onClick = {
                    ShareFiles.sendText(
                        context,
                        context.getString(R.string.server_code_message, settings.profileName, displayCode(settings.friendCode)),
                        context.getString(R.string.share_chooser),
                    )
                }) { Icon(Icons.Rounded.Share, contentDescription = stringResource(R.string.server_share_code)) }
            }
            Text(stringResource(R.string.server_code_hint), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Spacer(Modifier.height(10.dp))
            Button(onClick = { adding = true }, modifier = Modifier.fillMaxWidth().testTag("addFriend")) {
                Icon(Icons.Rounded.PersonAdd, contentDescription = null, modifier = Modifier.size(18.dp))
                Spacer(Modifier.width(8.dp))
                Text(stringResource(R.string.server_add_friend))
            }
            Row(Modifier.fillMaxWidth().padding(top = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text(
                        when {
                            status.running -> stringResource(R.string.server_syncing)
                            settings.lastSyncAt > 0 -> stringResource(R.string.server_last_sync, DateFormat.getDateTimeInstance(DateFormat.SHORT, DateFormat.SHORT).format(Date(settings.lastSyncAt)))
                            else -> stringResource(R.string.server_never_synced)
                        },
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    if (waiting > 0) {
                        Text(pluralStringResource(R.plurals.server_waiting, waiting, waiting), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
                IconButton(onClick = { container.launch { container.refreshFriends(force = true) } }, enabled = !status.running, modifier = Modifier.testTag("syncNow")) {
                    Icon(Icons.Rounded.Refresh, contentDescription = stringResource(R.string.server_sync_now))
                }
            }
        }
        val shown = problem ?: status.error
        AnimatedVisibility(visible = shown != null) {
            Text(
                serverProblem(shown.orEmpty()),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.error,
                modifier = Modifier.padding(top = 6.dp).testTag("serverProblem"),
            )
        }
    }

    if (askName) {
        NameDialog(stringResource(R.string.friends_name_title), settings.profileName, { askName = false }) { name ->
            askName = false
            container.launch {
                container.settings.setProfileName(name)
                connect()
            }
        }
    }
    if (adding) AddFriendDialog(onDismiss = { adding = false })
}

@Composable
private fun AddFriendDialog(onDismiss: () -> Unit) {
    val container = LocalContainer.current
    val context = LocalContext.current
    var code by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var problem by remember { mutableStateOf<String?>(null) }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(stringResource(R.string.server_add_friend)) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(stringResource(R.string.server_add_friend_text), style = MaterialTheme.typography.bodyMedium)
                OutlinedTextField(
                    value = code,
                    onValueChange = { code = it.uppercase().take(16); problem = null },
                    label = { Text(stringResource(R.string.server_code_label)) },
                    singleLine = true,
                    isError = problem != null,
                    keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Characters, autoCorrectEnabled = false),
                    modifier = Modifier.fillMaxWidth().testTag("friendCodeField"),
                )
                problem?.let { Text(serverProblem(it), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.error, modifier = Modifier.testTag("friendCodeProblem")) }
            }
        },
        confirmButton = {
            TextButton(
                enabled = !busy && code.count { it.isLetterOrDigit() } >= 10,
                onClick = {
                    busy = true
                    container.launch {
                        val result = container.server.addFriend(code)
                        busy = false
                        result.onSuccess { name ->
                            Toast.makeText(context, context.getString(R.string.server_friend_added, name.ifBlank { context.getString(R.string.friends_someone) }), Toast.LENGTH_LONG).show()
                            onDismiss()
                        }.onFailure { problem = (it as? ServerException)?.reason ?: "network" }
                    }
                },
                modifier = Modifier.testTag("friendCodeAdd"),
            ) { Text(stringResource(R.string.server_add_confirm)) }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text(stringResource(R.string.action_cancel)) } },
    )
}

/** Asks before the profile and the shared library are taken off the server. */
@Composable
fun DisconnectDialog(onDismiss: () -> Unit) {
    val container = LocalContainer.current
    val context = LocalContext.current
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(stringResource(R.string.server_disconnect)) },
        text = { Text(stringResource(R.string.server_disconnect_text)) },
        confirmButton = {
            TextButton(
                onClick = {
                    onDismiss()
                    container.launch {
                        if (!container.server.disconnect()) Toast.makeText(context, R.string.server_error_network, Toast.LENGTH_LONG).show()
                    }
                },
                modifier = Modifier.testTag("disconnectConfirm"),
            ) { Text(stringResource(R.string.server_disconnect_confirm)) }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text(stringResource(R.string.action_cancel)) } },
    )
}

/** A button the size of a line of text, used where a second, quieter action is offered. */
@Composable
fun QuietButton(text: String, tag: String, onClick: () -> Unit) {
    OutlinedButton(onClick = onClick, modifier = Modifier.fillMaxWidth().testTag(tag)) { Text(text) }
}
