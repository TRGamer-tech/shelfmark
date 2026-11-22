@file:OptIn(ExperimentalLayoutApi::class)

package ch.schmidtbit.shelfmark.ui.library

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.KeyboardArrowLeft
import androidx.compose.material.icons.automirrored.rounded.KeyboardArrowRight
import androidx.compose.material.icons.rounded.Delete
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import ch.schmidtbit.shelfmark.ui.components.labelRes
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import ch.schmidtbit.shelfmark.R
import ch.schmidtbit.shelfmark.data.model.OrnamentKind
import ch.schmidtbit.shelfmark.ui.LocalContainer
import ch.schmidtbit.shelfmark.ui.components.OrnamentView


/** Choose what stands between the books of one shelf, and where. */
@Composable
fun OrnamentDialog(shelfKey: String, shelfName: String, bookCount: Int, onDismiss: () -> Unit) {
    val container = LocalContainer.current
    val all by container.library.ornaments.collectAsStateWithLifecycle(initialValue = emptyList())
    val mine = all.filter { it.shelfKey == shelfKey }.sortedBy { it.position }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(stringResource(R.string.ornament_dialog_title, shelfName)) },
        text = {
            Column(Modifier.verticalScroll(rememberScrollState())) {
                Text(stringResource(R.string.ornament_add), style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
                FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp), modifier = Modifier.padding(top = 8.dp)) {
                    OrnamentKind.entries.forEach { kind ->
                        val name = stringResource(kind.labelRes())
                        Box(
                            Modifier
                                .width(54.dp)
                                .height(54.dp)
                                // New ornaments go to the end of the shelf and can be moved from there.
                                .clickable(onClickLabel = stringResource(R.string.ornament_add), role = Role.Button) { container.launch { container.library.addOrnament(shelfKey, kind, bookCount) } }
                                .semantics { contentDescription = name }
                                .testTag("addOrnament_${kind.name}"),
                            contentAlignment = Alignment.BottomCenter,
                        ) {
                            OrnamentView(kind, scale = 0.6f)
                        }
                    }
                }
                if (mine.isNotEmpty()) {
                    Text(
                        stringResource(R.string.ornament_on_shelf),
                        style = MaterialTheme.typography.labelLarge,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.padding(top = 16.dp),
                    )
                }
                mine.forEach { ornament ->
                    Row(Modifier.fillMaxWidth().testTag("ornamentRow"), verticalAlignment = Alignment.CenterVertically) {
                        Box(Modifier.width(40.dp), contentAlignment = Alignment.Center) { OrnamentView(ornament.kind, scale = 0.45f) }
                        Column(Modifier.weight(1f).padding(start = 8.dp)) {
                            Text(stringResource(ornament.kind.labelRes()), style = MaterialTheme.typography.bodyLarge)
                            Text(
                                if (ornament.position <= 0) stringResource(R.string.ornament_at_start)
                                else pluralStringResource(R.plurals.ornament_after, ornament.position.coerceAtMost(bookCount), ornament.position.coerceAtMost(bookCount)),
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                        IconButton(
                            onClick = { container.launch { container.library.moveOrnament(ornament, ornament.position.coerceAtMost(bookCount) - 1) } },
                            enabled = ornament.position > 0,
                        ) { Icon(Icons.AutoMirrored.Rounded.KeyboardArrowLeft, contentDescription = stringResource(R.string.ornament_move_left)) }
                        IconButton(
                            onClick = { container.launch { container.library.moveOrnament(ornament, ornament.position + 1) } },
                            enabled = ornament.position < bookCount,
                        ) { Icon(Icons.AutoMirrored.Rounded.KeyboardArrowRight, contentDescription = stringResource(R.string.ornament_move_right)) }
                        IconButton(onClick = { container.launch { container.library.deleteOrnament(ornament.id) } }) {
                            Icon(Icons.Rounded.Delete, contentDescription = stringResource(R.string.action_delete))
                        }
                    }
                }
            }
        },
        confirmButton = { TextButton(onClick = onDismiss, modifier = Modifier.testTag("ornamentDone")) { Text(stringResource(R.string.action_ok)) } },
    )
}
