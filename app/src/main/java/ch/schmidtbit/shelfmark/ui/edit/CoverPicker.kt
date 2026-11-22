@file:OptIn(ExperimentalLayoutApi::class)

package ch.schmidtbit.shelfmark.ui.edit

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import coil3.compose.AsyncImage
import ch.schmidtbit.shelfmark.R
import ch.schmidtbit.shelfmark.ui.LocalContainer
import java.util.Locale

/** Looks for covers of a book in every catalogue and lets the user pick the right one. */
@Composable
fun CoverPickerDialog(title: String, authors: String, isbn: String, onDismiss: () -> Unit, onPick: (String) -> Unit) {
    val container = LocalContainer.current
    var found by remember { mutableStateOf<List<String>?>(null) }
    LaunchedEffect(title, authors, isbn) {
        found = runCatching { container.coverFinder.candidates(title, authors, isbn, Locale.getDefault().language.ifBlank { "en" }) }.getOrDefault(emptyList())
    }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(stringResource(R.string.cover_search)) },
        text = {
            val covers = found
            when {
                covers == null -> Box(Modifier.fillMaxWidth().padding(24.dp), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
                covers.isEmpty() -> Text(stringResource(R.string.cover_none_found), style = MaterialTheme.typography.bodyLarge)
                else -> Column(Modifier.verticalScroll(rememberScrollState())) {
                    Text(stringResource(R.string.cover_pick), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    FlowRow(horizontalArrangement = Arrangement.spacedBy(10.dp), verticalArrangement = Arrangement.spacedBy(10.dp), modifier = Modifier.padding(top = 10.dp)) {
                        covers.forEachIndexed { index, url ->
                            AsyncImage(
                                model = url,
                                contentDescription = null,
                                contentScale = ContentScale.Crop,
                                modifier = Modifier
                                    .width(84.dp)
                                    .aspectRatio(2f / 3f)
                                    .clip(RoundedCornerShape(4.dp))
                                    .clickable { onPick(url) }
                                    .testTag("coverCandidate$index"),
                            )
                        }
                    }
                }
            }
        },
        confirmButton = {},
        dismissButton = { TextButton(onClick = onDismiss) { Text(stringResource(R.string.action_cancel)) } },
    )
}
