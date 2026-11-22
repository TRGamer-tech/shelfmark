@file:OptIn(ExperimentalMaterial3Api::class)

package ch.schmidtbit.shelfmark.ui.stats

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import ch.schmidtbit.shelfmark.R
import ch.schmidtbit.shelfmark.data.stats.GoalMath
import ch.schmidtbit.shelfmark.data.stats.LibraryStats
import ch.schmidtbit.shelfmark.data.stats.StatsCalculator
import ch.schmidtbit.shelfmark.ui.LocalContainer
import ch.schmidtbit.shelfmark.ui.components.SectionCard
import ch.schmidtbit.shelfmark.ui.components.formatDuration
import ch.schmidtbit.shelfmark.ui.formatRating
import ch.schmidtbit.shelfmark.ui.labelRes
import ch.schmidtbit.shelfmark.ui.theme.LocalShelfColors
import ch.schmidtbit.shelfmark.ui.theme.Sans
import java.time.LocalDate
import java.time.Month
import java.time.format.TextStyle
import java.util.Locale

@Composable
fun StatsScreen(onGoals: () -> Unit) {
    val container = LocalContainer.current
    val books by container.library.books.collectAsStateWithLifecycle(initialValue = emptyList())
    val sessions by container.library.sessions.collectAsStateWithLifecycle(initialValue = emptyList())
    val quotes by container.library.quotes.collectAsStateWithLifecycle(initialValue = emptyList())
    val goals by container.library.goals.collectAsStateWithLifecycle(initialValue = emptyList())
    val today = remember { LocalDate.now() }
    val stats = remember(books, sessions, quotes.size) { StatsCalculator.compute(books, sessions, quotes.size, today) }
    val goalProgress = remember(goals, books, sessions) { goals.filter { !it.archived }.map { GoalMath.progress(it, books, sessions, today) } }

    Scaffold(
        topBar = { TopAppBar(title = { Text(stringResource(R.string.tab_stats), style = MaterialTheme.typography.headlineSmall) }) },
    ) { padding ->
        LazyColumn(Modifier.fillMaxSize().padding(padding).testTag("stats"), contentPadding = PaddingValues(bottom = 32.dp)) {
            item(key = "goals") {
                SectionCard(stringResource(R.string.goals_title)) {
                    if (goalProgress.isEmpty()) {
                        Text(stringResource(R.string.goals_none), style = MaterialTheme.typography.bodyLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                    goalProgress.take(3).forEach { progress ->
                        Text(goalTitle(progress.goal), style = MaterialTheme.typography.titleMedium, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            LinearProgressIndicator(progress = { progress.fraction }, modifier = Modifier.weight(1f).height(8.dp))
                            Spacer(Modifier.width(12.dp))
                            Text("${progress.done} / ${progress.goal.target}", style = MaterialTheme.typography.labelLarge)
                        }
                        Spacer(Modifier.height(10.dp))
                    }
                    TextButton(onClick = onGoals, modifier = Modifier.testTag("openGoals")) { Text(stringResource(R.string.goals_manage)) }
                }
            }
            item(key = "year") {
                SectionCard(stringResource(R.string.stats_this_year, stats.thisYear.year)) {
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Tile(stats.thisYear.booksFinished.toString(), stringResource(R.string.stats_books_finished), Modifier.weight(1f), compare(stats.thisYear.booksFinished, stats.lastYear.booksFinished, stats.lastYear.year))
                        Tile(stats.thisYear.pagesRead.toString(), stringResource(R.string.stats_pages), Modifier.weight(1f), compare(stats.thisYear.pagesRead, stats.lastYear.pagesRead, stats.lastYear.year))
                    }
                    Spacer(Modifier.height(8.dp))
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Tile(formatDuration(stats.thisYear.minutesRead), stringResource(R.string.stats_time), Modifier.weight(1f))
                        Tile(stats.thisYear.sessions.toString(), stringResource(R.string.stats_sessions), Modifier.weight(1f))
                    }
                }
            }
            item(key = "streak") {
                SectionCard(stringResource(R.string.stats_streak)) {
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Tile(pluralStringResource(R.plurals.days, stats.currentStreak, stats.currentStreak), stringResource(R.string.stats_streak_current), Modifier.weight(1f))
                        Tile(pluralStringResource(R.plurals.days, stats.bestStreak, stats.bestStreak), stringResource(R.string.stats_streak_best), Modifier.weight(1f))
                    }
                }
            }
            item(key = "months") {
                SectionCard(stringResource(R.string.stats_books_per_month)) {
                    BarChart(stats.thisYear.booksPerMonth, monthLabels())
                    Spacer(Modifier.height(16.dp))
                    Text(stringResource(R.string.stats_pages_per_month).uppercase(), style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    Spacer(Modifier.height(10.dp))
                    BarChart(stats.thisYear.pagesPerMonth, monthLabels())
                }
            }
            item(key = "library") { LibraryCard(stats) }
            if (stats.byFormat.isNotEmpty()) {
                item(key = "formats") {
                    SectionCard(stringResource(R.string.stats_by_format)) {
                        val max = stats.byFormat.maxOf { it.second }
                        stats.byFormat.forEach { (format, count) -> Bar(stringResource(format.labelRes()), count, max) }
                    }
                }
            }
            if (stats.byRating.any { it > 0 }) {
                item(key = "ratings") {
                    SectionCard(stringResource(R.string.stats_by_rating)) {
                        val max = stats.byRating.max()
                        stats.byRating.forEachIndexed { index, count -> Bar("★".repeat(index + 1), count, max, LocalShelfColors.current.star) }
                    }
                }
            }
            if (stats.topAuthors.isNotEmpty()) {
                item(key = "authors") {
                    SectionCard(stringResource(R.string.stats_top_authors)) {
                        val max = stats.topAuthors.maxOf { it.second }
                        stats.topAuthors.forEach { (name, count) -> Bar(name, count, max) }
                    }
                }
            }
            if (stats.topGenres.isNotEmpty()) {
                item(key = "genres") {
                    SectionCard(stringResource(R.string.stats_top_genres)) {
                        val max = stats.topGenres.maxOf { it.second }
                        stats.topGenres.forEach { (name, count) -> Bar(name, count, max) }
                    }
                }
            }
            if (stats.pagesByWeekday.any { it > 0 }) {
                item(key = "weekdays") {
                    SectionCard(stringResource(R.string.stats_by_weekday)) {
                        val labels = (1..7).map { java.time.DayOfWeek.of(it).getDisplayName(TextStyle.SHORT, Locale.getDefault()).take(2) }
                        BarChart(stats.pagesByWeekday, labels)
                    }
                }
            }
        }
    }
}

@Composable
private fun compare(now: Int, before: Int, year: Int): String? =
    if (before > 0) stringResource(R.string.stats_last_year, year, before) else null

@Composable
private fun monthLabels(): List<String> = remember {
    Month.entries.map { it.getDisplayName(TextStyle.NARROW, Locale.getDefault()) }
}

@Composable
private fun LibraryCard(stats: LibraryStats) {
    SectionCard(stringResource(R.string.stats_library)) {
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Tile(stats.totalBooks.toString(), stringResource(R.string.stats_total), Modifier.weight(1f))
            Tile(stats.read.toString(), stringResource(R.string.status_read), Modifier.weight(1f))
            Tile(stats.unread.toString(), stringResource(R.string.status_unread), Modifier.weight(1f))
        }
        Spacer(Modifier.height(8.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Tile(stats.wishlist.toString(), stringResource(R.string.status_wishlist), Modifier.weight(1f))
            Tile(if (stats.averageRating > 0f) formatRating(Math.round(stats.averageRating * 10) / 10f) else "-", stringResource(R.string.stats_average_rating), Modifier.weight(1f))
            Tile(if (stats.averageSpice > 0f) formatRating(Math.round(stats.averageSpice * 10) / 10f) else "-", stringResource(R.string.stats_average_spice), Modifier.weight(1f))
        }
    }
}

@Composable
private fun Tile(value: String, label: String, modifier: Modifier = Modifier, footnote: String? = null) {
    Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainerHighest), modifier = modifier) {
        Column(Modifier.padding(12.dp)) {
            Text(value, style = MaterialTheme.typography.headlineSmall.copy(fontFamily = Sans), color = MaterialTheme.colorScheme.primary, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(label, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 2)
            if (footnote != null) Text(footnote, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1)
        }
    }
}

/** One labelled horizontal bar, used for the rankings. */
@Composable
private fun Bar(label: String, value: Int, max: Int, color: Color = MaterialTheme.colorScheme.primary) {
    Row(Modifier.fillMaxWidth().padding(vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
        Text(label, style = MaterialTheme.typography.bodyMedium, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.width(120.dp))
        LinearProgressIndicator(
            progress = { if (max > 0) value.toFloat() / max else 0f },
            color = color,
            modifier = Modifier.weight(1f).height(10.dp),
        )
        Text(value.toString(), style = MaterialTheme.typography.labelLarge, textAlign = TextAlign.End, modifier = Modifier.width(36.dp))
    }
}

/** Small column chart with a label under each column and the highest value marked. */
@Composable
private fun BarChart(values: List<Int>, labels: List<String>) {
    val color = MaterialTheme.colorScheme.primary
    val track = MaterialTheme.colorScheme.surfaceContainerHighest
    val max = (values.maxOrNull() ?: 0).coerceAtLeast(1)
    Column {
        Text(
            stringResource(R.string.stats_chart_max, values.maxOrNull() ?: 0),
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Canvas(Modifier.fillMaxWidth().height(96.dp).padding(top = 4.dp)) {
            val slot = size.width / values.size
            val barWidth = slot * 0.62f
            values.forEachIndexed { index, value ->
                val left = index * slot + (slot - barWidth) / 2
                val radius = CornerRadius(barWidth / 4, barWidth / 4)
                drawRoundRect(track, Offset(left, 0f), Size(barWidth, size.height), radius)
                if (value > 0) {
                    val height = (size.height * value / max).coerceAtLeast(barWidth / 2)
                    drawRoundRect(color, Offset(left, size.height - height), Size(barWidth, height), radius)
                }
            }
        }
        Row(Modifier.fillMaxWidth().padding(top = 4.dp)) {
            labels.forEach { label ->
                Text(label, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant, textAlign = TextAlign.Center, maxLines = 1, modifier = Modifier.weight(1f))
            }
        }
    }
}
