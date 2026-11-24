@file:OptIn(ExperimentalMaterial3Api::class)

package ch.schmidtbit.shelfmark.ui.components

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.ArrowBack
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.DatePicker
import androidx.compose.material3.DatePickerDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberDatePickerState
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import ch.schmidtbit.shelfmark.R
import ch.schmidtbit.shelfmark.util.Dates

@Composable
fun BackButton(onBack: () -> Unit) {
    IconButton(onClick = onBack) {
        Icon(Icons.AutoMirrored.Rounded.ArrowBack, contentDescription = stringResource(R.string.action_back))
    }
}

/**
 * Asks before something is deleted that one tap would otherwise take away for good. The
 * same dialog everywhere, so that it reads the same and the button sits in the same place.
 */
@Composable
fun ConfirmDelete(
    title: String,
    onDismiss: () -> Unit,
    text: String = stringResource(R.string.delete_no_undo),
    confirm: String = stringResource(R.string.action_delete),
    onConfirm: () -> Unit,
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(title) },
        text = { Text(text) },
        confirmButton = { TextButton(onClick = onConfirm, modifier = Modifier.testTag("confirmDeleteYes")) { Text(confirm) } },
        dismissButton = { TextButton(onClick = onDismiss, modifier = Modifier.testTag("confirmDeleteNo")) { Text(stringResource(R.string.action_cancel)) } },
        modifier = Modifier.testTag("confirmDelete"),
    )
}

/** Asks before a form is left with something typed into it that is not saved. */
@Composable
fun DiscardDialog(onKeep: () -> Unit, onDiscard: () -> Unit) {
    AlertDialog(
        onDismissRequest = onKeep,
        title = { Text(stringResource(R.string.discard_title)) },
        text = { Text(stringResource(R.string.discard_text)) },
        confirmButton = { TextButton(onClick = onDiscard, modifier = Modifier.testTag("discardYes")) { Text(stringResource(R.string.action_discard)) } },
        dismissButton = { TextButton(onClick = onKeep, modifier = Modifier.testTag("discardNo")) { Text(stringResource(R.string.action_keep_editing)) } },
        modifier = Modifier.testTag("discardDialog"),
    )
}

/** A titled card, the building block of the detail pages. */
@Composable
fun SectionCard(
    title: String?,
    modifier: Modifier = Modifier,
    content: @Composable ColumnScope.() -> Unit,
) {
    Card(
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainer),
        modifier = modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 6.dp),
    ) {
        Column(Modifier.padding(16.dp)) {
            if (title != null) {
                Text(
                    title.uppercase(),
                    style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(bottom = 10.dp),
                )
            }
            content()
        }
    }
}

/** Date picker working in epoch days. [onPick] receives null when the date is cleared. */
@Composable
fun DayPickerDialog(initial: Long?, onDismiss: () -> Unit, onPick: (Long?) -> Unit) {
    val state = rememberDatePickerState(initialSelectedDateMillis = Dates.toUtcMillis(initial ?: Dates.today()))
    DatePickerDialog(
        onDismissRequest = onDismiss,
        confirmButton = {
            TextButton(onClick = { onPick(state.selectedDateMillis?.let(Dates::fromUtcMillis)) }) {
                Text(stringResource(R.string.action_ok))
            }
        },
        dismissButton = {
            if (initial != null) {
                TextButton(onClick = { onPick(null) }) { Text(stringResource(R.string.action_clear)) }
            }
            TextButton(onClick = onDismiss) { Text(stringResource(R.string.action_cancel)) }
        },
    ) {
        DatePicker(state = state)
    }
}

/** "3 h 20 min" or "45 min". */
@Composable
fun formatDuration(minutes: Int): String {
    val h = minutes / 60
    val m = minutes % 60
    return if (h > 0) stringResource(R.string.duration_h_min, h, m) else stringResource(R.string.duration_min, m)
}
