@file:OptIn(ExperimentalMaterial3Api::class)

package ch.schmidtbit.shelfmark.ui.friends

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Delete
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import ch.schmidtbit.shelfmark.R
import ch.schmidtbit.shelfmark.data.model.LendRequest
import ch.schmidtbit.shelfmark.data.model.LendStatus
import ch.schmidtbit.shelfmark.ui.LocalContainer
import ch.schmidtbit.shelfmark.ui.LocalImporter
import ch.schmidtbit.shelfmark.ui.components.BackButton
import ch.schmidtbit.shelfmark.ui.components.SectionCard
import ch.schmidtbit.shelfmark.ui.components.SectionTitle
import ch.schmidtbit.shelfmark.ui.detail.EmptyHint
import ch.schmidtbit.shelfmark.ui.labelRes
import ch.schmidtbit.shelfmark.ui.theme.LocalShelfColors
import java.text.DateFormat
import java.util.Date

/** Every borrow request: the ones friends sent me and the ones I sent. */
@Composable
fun RequestsScreen(onBack: () -> Unit) {
    val container = LocalContainer.current
    val importer = LocalImporter.current
    val context = LocalContext.current
    val requests by container.social.requests.collectAsStateWithLifecycle(initialValue = emptyList())
    val incoming = requests.filter { it.incoming }
    val outgoing = requests.filter { !it.incoming }

    Scaffold(
        topBar = { TopAppBar(title = { Text(stringResource(R.string.requests_title)) }, navigationIcon = { BackButton(onBack) }) },
    ) { padding ->
        LazyColumn(Modifier.fillMaxSize().padding(padding), contentPadding = PaddingValues(bottom = 32.dp)) {
            if (requests.isEmpty()) item(key = "empty") { EmptyHint(stringResource(R.string.requests_empty)) }
            if (incoming.isNotEmpty()) item(key = "inTitle") { SectionTitle(stringResource(R.string.requests_incoming)) }
            items(incoming, key = { it.id }) { request ->
                if (request.status == LendStatus.PENDING) {
                    IncomingRequestCard(request, onAnswer = { accept -> importer.answer(request.id, accept) })
                } else {
                    RequestCard(
                        request = request,
                        headline = stringResource(R.string.request_incoming_line, request.peerName, request.bookTitle),
                        // The answer file can be sent again in case it got lost on the way.
                        actionLabel = stringResource(R.string.request_resend_answer),
                        onAction = { importer.answer(request.id, request.status == LendStatus.ACCEPTED) },
                        onDelete = { container.launch { container.social.deleteRequest(request.id) } },
                    )
                }
            }
            if (outgoing.isNotEmpty()) item(key = "outTitle") { SectionTitle(stringResource(R.string.requests_outgoing)) }
            items(outgoing, key = { it.id }) { request ->
                RequestCard(
                    request = request,
                    headline = stringResource(R.string.request_outgoing_line, request.bookTitle, request.peerName),
                    actionLabel = stringResource(R.string.request_resend).takeIf { request.status == LendStatus.PENDING },
                    onAction = {
                        container.launch {
                            val envelope = container.social.requestEnvelope(request.id) ?: return@launch
                            importer.deliver(
                                request.peerId,
                                envelope,
                                baseName = context.getString(R.string.share_request_file, request.bookTitle),
                                subject = context.getString(R.string.share_request_subject, request.bookTitle),
                                message = context.getString(R.string.share_request_message, request.peerName, request.bookTitle),
                            )
                        }
                    },
                    onDelete = { container.launch { container.social.deleteRequest(request.id) } },
                )
            }
        }
    }
}

@Composable
private fun RequestCard(request: LendRequest, headline: String, actionLabel: String?, onAction: () -> Unit, onDelete: () -> Unit) {
    val colors = LocalShelfColors.current
    SectionCard(null, Modifier.testTag("requestCard")) {
        Row(verticalAlignment = Alignment.Top) {
            Column(Modifier.weight(1f)) {
                Text(headline, style = MaterialTheme.typography.titleMedium)
                Text(
                    stringResource(request.status.labelRes()),
                    style = MaterialTheme.typography.labelLarge,
                    color = when (request.status) {
                        LendStatus.PENDING -> MaterialTheme.colorScheme.onSurfaceVariant
                        LendStatus.ACCEPTED -> colors.good
                        LendStatus.DECLINED -> colors.spice
                    },
                    modifier = Modifier.padding(top = 2.dp).testTag("requestStatus"),
                )
                Text(
                    DateFormat.getDateInstance(DateFormat.MEDIUM).format(Date(request.createdAt)),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                if (request.note.isNotBlank()) Text("„${request.note}“", style = MaterialTheme.typography.bodyMedium, modifier = Modifier.padding(top = 4.dp))
                if (actionLabel != null) TextButton(onClick = onAction, contentPadding = PaddingValues(0.dp)) { Text(actionLabel) }
            }
            IconButton(onClick = onDelete) {
                Icon(Icons.Rounded.Delete, contentDescription = stringResource(R.string.action_delete), tint = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
    }
}
