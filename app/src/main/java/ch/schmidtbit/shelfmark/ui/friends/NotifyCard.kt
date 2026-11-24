package ch.schmidtbit.shelfmark.ui.friends

import android.Manifest
import android.app.Activity
import android.content.Context
import android.content.ContextWrapper
import android.os.SystemClock
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.core.app.ActivityCompat
import androidx.lifecycle.compose.LifecycleResumeEffect
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import ch.schmidtbit.shelfmark.R
import ch.schmidtbit.shelfmark.ui.LocalContainer
import ch.schmidtbit.shelfmark.work.Notifier

/** No question that Android shows can be answered this fast. An answer that comes sooner came without one. */
private const val NO_DIALOG_MS = 400L

private tailrec fun Context.activity(): Activity? = when (this) {
    is Activity -> this
    is ContextWrapper -> baseContext.activity()
    else -> null
}

/**
 * Says that news from friends will not reach the reader, in the places where they look
 * for such news, and offers the way to change that: Android's own question as long as
 * Android still shows it, otherwise the page of the system settings. Whoever dismissed
 * the question after signing in, or has notifications switched off for the app or for its
 * channel, would otherwise wait for a notification that never comes, without knowing.
 *
 * Nothing is shown to somebody who is not signed in (they get no news), and nothing as
 * soon as notifications can be shown.
 */
@Composable
fun NotificationsCard(modifier: Modifier = Modifier) {
    val container = LocalContainer.current
    val context = LocalContext.current
    val settings by container.settings.settings.collectAsStateWithLifecycle(initialValue = null)
    val current = settings ?: return
    if (!container.server.available || !current.signedIn) return

    var block by remember { mutableStateOf(Notifier.block(context, current.notifyNoDialog)) }
    // Looked at again whenever this comes to the front: the reader may be back from the system settings.
    LifecycleResumeEffect(current.notifyNoDialog) {
        block = Notifier.block(context, current.notifyNoDialog)
        onPauseOrDispose { }
    }
    // Once they can be shown, what was remembered about Android's question is out of date.
    LaunchedEffect(block, current.notifyNoDialog) {
        if (block == Notifier.Block.NONE && current.notifyNoDialog) container.settings.setNotifyNoDialog(false)
    }

    fun openSettings() {
        runCatching { context.startActivity(Notifier.settingsIntent(context)) }
    }

    var askedAt by remember { mutableLongStateOf(0L) }
    val ask = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        // After the first no, Android shows its question once more. After the second it answers
        // no by itself, at once: then the tap has to lead to the settings, or it would do nothing.
        val again = context.activity()?.let { ActivityCompat.shouldShowRequestPermissionRationale(it, Manifest.permission.POST_NOTIFICATIONS) } == true
        val silent = !granted && !again && SystemClock.elapsedRealtime() - askedAt < NO_DIALOG_MS
        if (silent) {
            container.launch { container.settings.setNotifyNoDialog(true) }
            openSettings()
        }
        block = Notifier.block(context, current.notifyNoDialog || silent)
    }

    if (block == Notifier.Block.NONE) return
    Card(
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.tertiaryContainer, contentColor = MaterialTheme.colorScheme.onTertiaryContainer),
        modifier = modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 6.dp).testTag("notifyOff"),
    ) {
        Column(Modifier.padding(start = 16.dp, end = 8.dp, top = 12.dp, bottom = 4.dp)) {
            Text(stringResource(R.string.notify_off_title), style = MaterialTheme.typography.titleMedium)
            Text(stringResource(R.string.notify_off_text), style = MaterialTheme.typography.bodyMedium, modifier = Modifier.padding(top = 2.dp, end = 8.dp))
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                if (block == Notifier.Block.ASK) {
                    TextButton(
                        onClick = {
                            askedAt = SystemClock.elapsedRealtime()
                            // No way to ask on this phone after all: the settings always work.
                            if (runCatching { ask.launch(Manifest.permission.POST_NOTIFICATIONS) }.isFailure) openSettings()
                        },
                        modifier = Modifier.testTag("notifyAllow"),
                    ) { Text(stringResource(R.string.notify_allow)) }
                } else {
                    TextButton(onClick = ::openSettings, modifier = Modifier.testTag("notifyOpenSettings")) { Text(stringResource(R.string.notify_open_settings)) }
                }
            }
        }
    }
}
