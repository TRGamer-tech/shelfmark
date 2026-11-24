@file:OptIn(ExperimentalMaterial3Api::class)

package ch.schmidtbit.shelfmark.ui.detail

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Pause
import androidx.compose.material.icons.rounded.PlayArrow
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilledIconButton
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import ch.schmidtbit.shelfmark.R
import ch.schmidtbit.shelfmark.data.repo.TimerState
import ch.schmidtbit.shelfmark.ui.LocalContainer
import ch.schmidtbit.shelfmark.ui.components.BackButton
import ch.schmidtbit.shelfmark.ui.components.ConfirmDelete
import kotlinx.coroutines.delay
import kotlin.math.roundToInt

fun formatClock(seconds: Long): String = "%02d:%02d:%02d".format(seconds / 3600, seconds / 60 % 60, seconds % 60)

/** A stopwatch for a reading session. It keeps counting while the app is closed. */
@Composable
fun TimerScreen(bookId: Long, onBack: () -> Unit) {
    val container = LocalContainer.current
    val settings by container.settings.settings.collectAsStateWithLifecycle(initialValue = null)
    val book by remember(bookId) { container.library.book(bookId) }.collectAsStateWithLifecycle(initialValue = null)
    val timer = settings?.timer?.takeIf { it.bookId == bookId }
    // There is one timer. While it holds time for another book, starting it here would drop that time.
    val other = settings?.timer?.takeIf { it.bookId != bookId }
    val otherBook by remember(other?.bookId) { container.library.book(other?.bookId ?: 0) }.collectAsStateWithLifecycle(initialValue = null)
    var askOther by remember { mutableStateOf(false) }
    var now by remember { mutableLongStateOf(System.currentTimeMillis()) }
    var logging by remember { mutableStateOf(false) }

    LaunchedEffect(timer?.running) {
        while (timer?.running == true) {
            now = System.currentTimeMillis()
            delay(500)
        }
    }
    val elapsed = timer?.elapsedSeconds(now) ?: 0

    fun start() {
        container.launch {
            val current = System.currentTimeMillis()
            container.settings.setTimer(TimerState(bookId, runningSince = current, accumulatedSeconds = 0, startedAt = current, startPage = book?.currentPage ?: 0))
        }
    }

    fun toggle() {
        when {
            timer == null && other != null -> askOther = true
            timer == null -> start()
            else -> container.launch {
                val current = System.currentTimeMillis()
                container.settings.setTimer(if (timer.running) timer.copy(runningSince = null, accumulatedSeconds = timer.elapsedSeconds(current)) else timer.copy(runningSince = current))
            }
        }
    }

    if (askOther && other != null) {
        ConfirmDelete(
            title = stringResource(R.string.timer_other_title),
            text = stringResource(R.string.timer_other_text, otherBook?.title.orEmpty(), formatClock(other.elapsedSeconds(System.currentTimeMillis()))),
            confirm = stringResource(R.string.timer_other_confirm),
            onDismiss = { askOther = false },
        ) {
            askOther = false
            start()
        }
    }

    Scaffold(
        topBar = { TopAppBar(title = { Text(stringResource(R.string.timer_title)) }, navigationIcon = { BackButton(onBack) }) },
    ) { padding ->
        Column(
            Modifier.fillMaxSize().padding(padding).padding(24.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center,
        ) {
            Text(book?.title.orEmpty(), style = MaterialTheme.typography.titleLarge, textAlign = TextAlign.Center, maxLines = 2)
            Spacer(Modifier.height(32.dp))
            val accent = MaterialTheme.colorScheme.primary
            val track = MaterialTheme.colorScheme.surfaceContainerHighest
            Box(contentAlignment = Alignment.Center) {
                // The ring completes once a minute, a quiet sign that the clock is running.
                Canvas(Modifier.size(240.dp)) {
                    val stroke = 14.dp.toPx()
                    val inset = stroke / 2
                    val arcSize = Size(size.width - stroke, size.height - stroke)
                    drawArc(track, 0f, 360f, false, Offset(inset, inset), arcSize, style = Stroke(stroke))
                    drawArc(accent, -90f, (elapsed % 60) * 6f, false, Offset(inset, inset), arcSize, style = Stroke(stroke, cap = StrokeCap.Round))
                }
                Text(formatClock(elapsed), style = MaterialTheme.typography.displaySmall, modifier = Modifier.testTag("timerClock"))
            }
            Spacer(Modifier.height(32.dp))
            FilledIconButton(onClick = ::toggle, modifier = Modifier.size(76.dp).testTag("timerToggle")) {
                Icon(
                    if (timer?.running == true) Icons.Rounded.Pause else Icons.Rounded.PlayArrow,
                    contentDescription = stringResource(if (timer?.running == true) R.string.timer_pause else R.string.timer_start),
                    modifier = Modifier.size(40.dp),
                )
            }
            Spacer(Modifier.height(24.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                OutlinedButton(onClick = { container.launch { container.settings.setTimer(null) } }, enabled = timer != null) {
                    Text(stringResource(R.string.timer_discard))
                }
                Button(onClick = { logging = true }, enabled = timer != null && elapsed >= 1, modifier = Modifier.testTag("timerStop")) {
                    Text(stringResource(R.string.timer_stop_and_log))
                }
            }
        }
    }

    val current = book
    if (logging && current != null && timer != null) {
        LogSessionDialog(
            book = current,
            presetMinutes = (elapsed / 60f).roundToInt().coerceAtLeast(1),
            onDismiss = { logging = false },
            onSave = { session ->
                logging = false
                container.launch {
                    container.library.logSession(session.copy(startedAt = timer.startedAt))
                    container.settings.setTimer(null)
                }
                onBack()
            },
        )
    }
}
