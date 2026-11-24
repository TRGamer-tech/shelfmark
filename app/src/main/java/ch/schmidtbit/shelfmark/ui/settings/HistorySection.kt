package ch.schmidtbit.shelfmark.ui.settings

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import ch.schmidtbit.shelfmark.R
import ch.schmidtbit.shelfmark.data.repo.History
import ch.schmidtbit.shelfmark.data.server.VaultVersion
import ch.schmidtbit.shelfmark.ui.LocalContainer
import ch.schmidtbit.shelfmark.ui.components.ConfirmDelete
import ch.schmidtbit.shelfmark.ui.components.SectionCard
import ch.schmidtbit.shelfmark.ui.friends.serverProblemRes
import java.text.DateFormat
import java.util.Date

/**
 * The earlier versions of the library that the server kept, and the way back to one of
 * them. The list is asked for when the settings are opened, and again after one was
 * brought back: what was replaced by that is then in it.
 *
 * Bringing one back is done by the server. It reaches this phone through the sync like
 * any change from elsewhere, so nothing here writes over the library by itself.
 */
@Composable
fun HistorySection() {
    val container = LocalContainer.current
    // Null while the server is being asked.
    var history by remember { mutableStateOf<History?>(null) }
    var asked by remember { mutableIntStateOf(0) }
    var wanted by remember { mutableStateOf<VaultVersion?>(null) }
    var busy by remember { mutableStateOf(false) }
    // The moment of the version that is back, in words, or the reason it is not.
    var restored by remember { mutableStateOf<String?>(null) }
    var problem by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(asked) {
        history = null
        history = container.server.history()
    }

    fun moment(version: VaultVersion): String = DateFormat.getDateTimeInstance(DateFormat.MEDIUM, DateFormat.SHORT).format(Date(version.at))

    SectionCard(stringResource(R.string.history_title), Modifier.testTag("historySection")) {
        Text(stringResource(R.string.history_text), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Spacer(Modifier.height(8.dp))
        when (val now = history) {
            null -> LinearProgressIndicator(Modifier.fillMaxWidth().padding(vertical = 8.dp))
            History.Unavailable -> Text(stringResource(R.string.history_unavailable), style = MaterialTheme.typography.bodyMedium, modifier = Modifier.testTag("historyUnavailable"))
            is History.Failed -> {
                Text(stringResource(serverProblemRes(now.reason), now.reason), color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodyMedium)
                TextButton(onClick = { asked++ }, modifier = Modifier.testTag("historyRetry")) { Text(stringResource(R.string.action_retry)) }
            }
            is History.Versions -> {
                if (now.versions.isEmpty()) Text(stringResource(R.string.history_empty), style = MaterialTheme.typography.bodyMedium, modifier = Modifier.testTag("historyEmpty"))
                now.versions.forEach { version ->
                    Row(Modifier.fillMaxWidth().testTag("historyVersion"), verticalAlignment = Alignment.CenterVertically) {
                        Column(Modifier.weight(1f)) {
                            Text(moment(version), style = MaterialTheme.typography.bodyLarge)
                            Text(
                                pluralStringResource(R.plurals.book_count, version.books, version.books),
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                        TextButton(onClick = { wanted = version }, enabled = !busy, modifier = Modifier.testTag("historyRestore")) { Text(stringResource(R.string.history_restore)) }
                    }
                }
            }
        }
        restored?.let { Text(stringResource(R.string.history_restored, it), color = MaterialTheme.colorScheme.primary, modifier = Modifier.padding(top = 4.dp).testTag("historyRestored")) }
        problem?.let { reason ->
            // The one refusal that is about this list: the server tidied the version away in the meantime.
            val text = if (reason == "unknown_version") stringResource(R.string.history_gone) else stringResource(serverProblemRes(reason), reason)
            Text(text, color = MaterialTheme.colorScheme.error, modifier = Modifier.padding(top = 4.dp).testTag("historyProblem"))
        }
    }

    wanted?.let { version ->
        ConfirmDelete(
            title = stringResource(R.string.history_restore_title, moment(version)),
            text = stringResource(R.string.history_restore_text),
            confirm = stringResource(R.string.history_restore),
            onDismiss = { wanted = null },
        ) {
            wanted = null
            busy = true
            restored = null
            problem = null
            // In the app's own scope: leaving the settings must not cut this short half way.
            container.launch {
                val failed = container.server.restoreVersion(version.revision)
                busy = false
                if (failed == null) restored = moment(version) else problem = failed
                asked++
            }
        }
    }
}
