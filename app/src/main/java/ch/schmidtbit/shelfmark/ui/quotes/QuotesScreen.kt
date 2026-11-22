@file:OptIn(ExperimentalMaterial3Api::class)

package ch.schmidtbit.shelfmark.ui.quotes

import android.content.Intent
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Add
import androidx.compose.material.icons.rounded.Search
import androidx.compose.material.icons.rounded.Share
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExtendedFloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import ch.schmidtbit.shelfmark.R
import ch.schmidtbit.shelfmark.data.model.QuoteWithBook
import ch.schmidtbit.shelfmark.ui.LocalContainer
import ch.schmidtbit.shelfmark.ui.components.SectionCard
import ch.schmidtbit.shelfmark.ui.detail.EmptyHint
import ch.schmidtbit.shelfmark.ui.theme.QuoteStyle

/** Every saved quote, across all books. */
@Composable
fun QuotesScreen(onAdd: () -> Unit, onEdit: (Long) -> Unit) {
    val container = LocalContainer.current
    val context = LocalContext.current
    val quotes by container.library.quotes.collectAsStateWithLifecycle(initialValue = null)
    var query by rememberSaveable { mutableStateOf("") }
    val all = quotes ?: emptyList()
    val visible = remember(all, query) {
        val q = query.trim()
        if (q.isEmpty()) all else all.filter { it.quote.text.contains(q, true) || it.bookTitle.contains(q, true) || it.bookAuthors.contains(q, true) }
    }

    Scaffold(
        topBar = { TopAppBar(title = { Text(stringResource(R.string.tab_quotes), style = MaterialTheme.typography.headlineSmall) }) },
        floatingActionButton = {
            ExtendedFloatingActionButton(
                onClick = onAdd,
                icon = { Icon(Icons.Rounded.Add, contentDescription = null) },
                text = { Text(stringResource(R.string.quote_add)) },
                modifier = Modifier.testTag("newQuote"),
            )
        },
    ) { padding ->
        LazyColumn(Modifier.fillMaxSize().padding(padding), contentPadding = PaddingValues(bottom = 96.dp)) {
            if (all.size > 3) {
                item(key = "search") {
                    OutlinedTextField(
                        value = query,
                        onValueChange = { query = it },
                        placeholder = { Text(stringResource(R.string.quote_search_hint)) },
                        leadingIcon = { Icon(Icons.Rounded.Search, contentDescription = null) },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 4.dp),
                    )
                }
            }
            if (quotes != null && all.isEmpty()) item(key = "empty") { EmptyHint(stringResource(R.string.quote_empty)) }
            items(visible, key = { it.quote.id }) { item ->
                QuoteCard(item, onClick = { onEdit(item.quote.id) }, onShare = {
                    val text = "„${item.quote.text}“\n${item.bookAuthors.ifBlank { null }?.let { "$it, " }.orEmpty()}${item.bookTitle}"
                    val send = Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, text)
                    context.startActivity(Intent.createChooser(send, null))
                })
            }
        }
    }
}

@Composable
private fun QuoteCard(item: QuoteWithBook, onClick: () -> Unit, onShare: () -> Unit) {
    SectionCard(null, Modifier.clickable(onClick = onClick)) {
        Text("„" + item.quote.text + "“", style = QuoteStyle)
        Row(Modifier.fillMaxWidth().padding(top = 6.dp), verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text(item.bookTitle, style = MaterialTheme.typography.titleSmall, color = MaterialTheme.colorScheme.primary, maxLines = 1)
                val line = listOfNotNull(
                    item.bookAuthors.takeIf { it.isNotBlank() },
                    item.quote.page.takeIf { it > 0 }?.let { stringResource(R.string.quote_page, it) },
                ).joinToString(" · ")
                if (line.isNotBlank()) Text(line, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1)
            }
            IconButton(onClick = onShare) {
                Icon(Icons.Rounded.Share, contentDescription = stringResource(R.string.action_share), tint = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
    }
}
