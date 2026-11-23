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
import androidx.compose.foundation.text.KeyboardOptions
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
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.saveable.rememberSaveable
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
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.LifecycleResumeEffect
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import ch.schmidtbit.shelfmark.R
import ch.schmidtbit.shelfmark.data.repo.Keep
import ch.schmidtbit.shelfmark.data.repo.Settings
import ch.schmidtbit.shelfmark.data.repo.SyncResult
import ch.schmidtbit.shelfmark.data.server.ServerException
import ch.schmidtbit.shelfmark.data.share.ShareFiles
import ch.schmidtbit.shelfmark.ui.LocalContainer
import ch.schmidtbit.shelfmark.ui.LocalImporter
import ch.schmidtbit.shelfmark.ui.WebsitePage
import ch.schmidtbit.shelfmark.ui.openWebsite
import ch.schmidtbit.shelfmark.ui.components.SectionCard
import ch.schmidtbit.shelfmark.ui.lists.NameDialog
import ch.schmidtbit.shelfmark.work.Notifier
import java.text.DateFormat
import java.util.Date

/** Says in the user's words why signing in or the server did not do what was asked. */
@Composable
fun serverProblem(reason: String): String = stringResource(
    when (reason) {
        "network" -> R.string.server_error_network
        "setup" -> R.string.server_error_setup
        "key" -> R.string.server_error_key
        "unknown_code" -> R.string.server_error_unknown_code
        "own_code" -> R.string.server_error_own_code
        "full" -> R.string.server_error_full
        "no_server" -> R.string.server_error_none
        "signed_out", "expired", "refresh_token_not_found" -> R.string.account_error_signed_out
        "invalid_credentials" -> R.string.account_error_credentials
        "user_already_exists", "email_exists" -> R.string.account_error_exists
        "weak_password" -> R.string.account_error_weak
        "email_not_confirmed" -> R.string.account_error_unconfirmed
        "validation_failed", "email_address_invalid" -> R.string.account_error_email
        // Not the reader's doing: the mail service of the server has sent all it may for now.
        "over_email_send_rate_limit" -> R.string.account_error_mail_limit
        "email_address_not_authorized" -> R.string.account_error_mail_refused
        "over_request_rate_limit" -> R.string.account_error_rate
        "signup_disabled" -> R.string.account_error_closed
        else -> R.string.server_error_other
    },
    reason,
)

/** "ABCDEFGHJK" reads better as "ABCDE-FGHJK". */
fun displayCode(code: String): String = code.chunked(5).joinToString("-")

/**
 * E-mail and password, to sign in or to make an account. One account is what puts the same
 * library on every phone and on the website, and what friends are connected to.
 * [onSignedIn] hears about it once somebody is in, with what the first exchange brought.
 */
@Composable
fun AccountForm(onSignedIn: ((SyncResult) -> Unit)? = null) {
    val container = LocalContainer.current
    val context = LocalContext.current
    var email by rememberSaveable { mutableStateOf("") }
    var password by rememberSaveable { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var problem by remember { mutableStateOf<String?>(null) }
    var notice by remember { mutableStateOf<Int?>(null) }
    // A new account whose owner still has to open the link in the confirmation mail.
    var awaitingConfirmation by rememberSaveable { mutableStateOf(false) }
    val askNotifications = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { }

    /** [quiet] is the try the app makes by itself: it says nothing when it was too early. */
    fun finish(result: SyncResult?, quiet: Boolean = false) {
        busy = false
        when (result) {
            // A new account that has to confirm its address first.
            null -> {
                notice = R.string.account_confirm_email
                awaitingConfirmation = true
            }
            is SyncResult.Failed -> if (!quiet) problem = result.reason
            else -> {
                awaitingConfirmation = false
                notice = null
                container.remember(result)
                password = ""
                // A request from a friend should not have to wait until the app is opened.
                if (Build.VERSION.SDK_INT >= 33 && !Notifier.allowed(context)) {
                    runCatching { askNotifications.launch(Manifest.permission.POST_NOTIFICATIONS) }
                }
                onSignedIn?.invoke(result)
            }
        }
    }

    fun go(create: Boolean) {
        busy = true
        problem = null
        notice = null
        container.launch { finish(if (create) container.server.signUp(email, password) else container.server.signIn(email, password)) }
    }

    // Back from the mail or the browser, where the link was opened: nobody should have to
    // guess that "Sign in" is the next thing to tap. The app tries it by itself.
    val waiting by rememberUpdatedState(awaitingConfirmation && !busy && password.isNotEmpty())
    LifecycleResumeEffect(Unit) {
        if (waiting) {
            busy = true
            container.launch { finish(container.server.signIn(email, password), quiet = true) }
        }
        onPauseOrDispose { }
    }

    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        OutlinedTextField(
            value = email,
            onValueChange = { email = it.trim() },
            label = { Text(stringResource(R.string.account_email)) },
            singleLine = true,
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email, capitalization = KeyboardCapitalization.None, autoCorrectEnabled = false),
            modifier = Modifier.fillMaxWidth().testTag("accountEmail"),
        )
        OutlinedTextField(
            value = password,
            onValueChange = { password = it },
            label = { Text(stringResource(R.string.account_password)) },
            singleLine = true,
            visualTransformation = PasswordVisualTransformation(),
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
            modifier = Modifier.fillMaxWidth().testTag("accountPassword"),
        )
        val ready = !busy && "@" in email && password.length >= 6
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
            Button(onClick = { go(create = false) }, enabled = ready, modifier = Modifier.weight(1f).testTag("signIn")) {
                if (busy) {
                    CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp, color = MaterialTheme.colorScheme.onPrimary)
                    Spacer(Modifier.width(8.dp))
                }
                Text(stringResource(R.string.account_sign_in))
            }
            OutlinedButton(onClick = { go(create = true) }, enabled = ready, modifier = Modifier.weight(1f).testTag("signUp")) {
                Text(stringResource(R.string.account_sign_up))
            }
        }
        TextButton(
            enabled = !busy && "@" in email,
            onClick = {
                busy = true
                problem = null
                container.launch {
                    val failed = container.server.recover(email)
                    busy = false
                    if (failed == null) notice = R.string.account_reset_sent else problem = failed
                }
            },
            modifier = Modifier.testTag("forgotPassword"),
        ) { Text(stringResource(R.string.account_forgot)) }
        AnimatedVisibility(visible = problem != null) {
            Text(serverProblem(problem.orEmpty()), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.error, modifier = Modifier.testTag("accountProblem"))
        }
        // Whoever creates an account should be able to read first what is kept, and where.
        if (container.website.isNotEmpty()) {
            Text(stringResource(R.string.account_privacy_hint), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            TextButton(onClick = { openWebsite(context, container.website, WebsitePage.PRIVACY) }, modifier = Modifier.testTag("accountPrivacy")) {
                Text(stringResource(R.string.legal_privacy))
            }
        }
        notice?.let { Text(stringResource(it), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.primary, modifier = Modifier.testTag("accountNotice")) }
    }
}

/**
 * The top of the friends tab. Signed out it explains what an account is good for and
 * offers to sign in. Signed in it is where the friend code lives.
 */
@Composable
fun AccountCard(settings: Settings) {
    val container = LocalContainer.current
    val importer = LocalImporter.current
    val context = LocalContext.current
    val status by container.server.status.collectAsStateWithLifecycle()
    val waiting by container.server.waiting.collectAsStateWithLifecycle(initialValue = 0)
    var adding by remember { mutableStateOf(false) }
    var askName by remember { mutableStateOf(false) }

    if (!settings.signedIn) {
        SectionCard(stringResource(R.string.account_title), Modifier.testTag("accountCard")) {
            Row(verticalAlignment = Alignment.Top) {
                Icon(Icons.Rounded.Cloud, contentDescription = null, tint = MaterialTheme.colorScheme.primary)
                Spacer(Modifier.width(10.dp))
                Text(stringResource(R.string.account_pitch), style = MaterialTheme.typography.bodyMedium, modifier = Modifier.weight(1f))
            }
            Spacer(Modifier.height(10.dp))
            AccountForm()
        }
        return
    }

    SectionCard(stringResource(R.string.server_title), Modifier.testTag("onlineCard")) {
        Text(stringResource(R.string.server_your_code), style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                // Until the first answer of the server there is no code to show yet.
                if (settings.friendCode.isBlank()) "…" else displayCode(settings.friendCode),
                style = MaterialTheme.typography.headlineSmall.copy(fontFamily = FontFamily.Monospace, fontWeight = FontWeight.Bold, letterSpacing = 1.sp),
                color = MaterialTheme.colorScheme.primary,
                modifier = Modifier.weight(1f).testTag("friendCode"),
            )
            IconButton(enabled = settings.friendCode.isNotBlank(), onClick = {
                context.getSystemService(ClipboardManager::class.java)?.setPrimaryClip(ClipData.newPlainText("Shelfmark", displayCode(settings.friendCode)))
                Toast.makeText(context, R.string.server_code_copied, Toast.LENGTH_SHORT).show()
            }) { Icon(Icons.Rounded.ContentCopy, contentDescription = stringResource(R.string.server_copy_code)) }
            IconButton(enabled = settings.friendCode.isNotBlank(), onClick = {
                ShareFiles.sendText(
                    context,
                    context.getString(R.string.server_code_message, settings.profileName, displayCode(settings.friendCode)),
                    context.getString(R.string.share_chooser),
                )
            }) { Icon(Icons.Rounded.Share, contentDescription = stringResource(R.string.server_share_code)) }
        }
        Text(stringResource(R.string.server_code_hint), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Spacer(Modifier.height(10.dp))
        Button(
            // Friends see a name, so there has to be one before the first friend.
            onClick = { if (settings.profileName.isBlank()) askName = true else adding = true },
            modifier = Modifier.fillMaxWidth().testTag("addFriend"),
        ) {
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
            // Through the importer, so that a request or an answer that just came in is shown at once.
            IconButton(onClick = { importer.refresh(force = true) }, enabled = !status.running, modifier = Modifier.testTag("syncNow")) {
                Icon(Icons.Rounded.Refresh, contentDescription = stringResource(R.string.server_sync_now))
            }
        }
        Text(
            stringResource(R.string.account_signed_in_as, settings.accountEmail),
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.testTag("signedInAs"),
        )
        status.error?.let {
            Text(serverProblem(it), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.error, modifier = Modifier.padding(top = 6.dp).testTag("serverProblem"))
        }
    }

    if (askName) {
        NameDialog(stringResource(R.string.friends_name_title), settings.profileName, { askName = false }) { name ->
            askName = false
            container.launch { container.settings.setProfileName(name) }
            adding = true
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

/** Asks before the account and everything of it on the server is deleted. */
@Composable
fun DeleteAccountDialog(onDismiss: () -> Unit) {
    val container = LocalContainer.current
    val context = LocalContext.current
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(stringResource(R.string.account_delete)) },
        text = { Text(stringResource(R.string.account_delete_text)) },
        confirmButton = {
            TextButton(
                onClick = {
                    onDismiss()
                    container.launch {
                        if (!container.server.deleteAccount()) Toast.makeText(context, R.string.server_error_network, Toast.LENGTH_LONG).show()
                    }
                },
                modifier = Modifier.testTag("deleteAccountConfirm"),
            ) { Text(stringResource(R.string.account_delete_confirm)) }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text(stringResource(R.string.action_cancel)) } },
    )
}

/**
 * An account and a device that both hold books and were never the same library:
 * there is nothing to go by, so the user says which one counts.
 */
@Composable
fun ChooseLibraryDialog(choice: SyncResult.Choose, onDecided: (Keep?) -> Unit) {
    AlertDialog(
        onDismissRequest = { onDecided(null) },
        title = { Text(stringResource(R.string.choose_title)) },
        text = { Text(stringResource(R.string.choose_text, choice.onAccount, choice.onDevice)) },
        confirmButton = {
            Column(horizontalAlignment = Alignment.End) {
                TextButton(onClick = { onDecided(Keep.ACCOUNT) }, modifier = Modifier.testTag("chooseAccount")) { Text(stringResource(R.string.choose_account)) }
                TextButton(onClick = { onDecided(Keep.DEVICE) }, modifier = Modifier.testTag("chooseDevice")) { Text(stringResource(R.string.choose_device)) }
                TextButton(onClick = { onDecided(null) }) { Text(stringResource(R.string.action_later)) }
            }
        },
        modifier = Modifier.testTag("chooseLibrary"),
    )
}
