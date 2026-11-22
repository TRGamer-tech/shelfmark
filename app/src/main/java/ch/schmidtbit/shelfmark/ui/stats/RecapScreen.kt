@file:OptIn(ExperimentalMaterial3Api::class)

package ch.schmidtbit.shelfmark.ui.stats

import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.KeyboardArrowLeft
import androidx.compose.material.icons.automirrored.rounded.KeyboardArrowRight
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
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
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import ch.schmidtbit.shelfmark.R
import ch.schmidtbit.shelfmark.data.stats.Insights
import ch.schmidtbit.shelfmark.data.stats.ReaderType
import ch.schmidtbit.shelfmark.data.stats.Recap
import ch.schmidtbit.shelfmark.data.stats.TimeOfDay
import ch.schmidtbit.shelfmark.ui.LocalContainer
import ch.schmidtbit.shelfmark.ui.components.BackButton
import ch.schmidtbit.shelfmark.ui.components.BookCover
import ch.schmidtbit.shelfmark.ui.components.RatingBar
import ch.schmidtbit.shelfmark.ui.components.SectionCard
import ch.schmidtbit.shelfmark.ui.components.formatDuration
import ch.schmidtbit.shelfmark.ui.coverModelOf
import ch.schmidtbit.shelfmark.ui.formatRating
import ch.schmidtbit.shelfmark.ui.theme.Sans
import ch.schmidtbit.shelfmark.util.Dates
import java.time.DayOfWeek
import java.time.LocalDate
import java.time.YearMonth
import java.time.format.TextStyle
import java.util.Locale

private fun ReaderType.titleRes(): Int = when (this) {
    ReaderType.QUIET_SHELF -> R.string.reader_quiet
    ReaderType.WEEKEND_READER -> R.string.reader_weekend
    ReaderType.EARLY_BIRD -> R.string.reader_early
    ReaderType.AFTERNOON_ESCAPIST -> R.string.reader_afternoon
    ReaderType.EVENING_UNWINDER -> R.string.reader_evening
    ReaderType.NIGHT_OWL -> R.string.reader_night
}

private fun ReaderType.textRes(): Int = when (this) {
    ReaderType.QUIET_SHELF -> R.string.reader_quiet_text
    ReaderType.WEEKEND_READER -> R.string.reader_weekend_text
    ReaderType.EARLY_BIRD -> R.string.reader_early_text
    ReaderType.AFTERNOON_ESCAPIST -> R.string.reader_afternoon_text
    ReaderType.EVENING_UNWINDER -> R.string.reader_evening_text
    ReaderType.NIGHT_OWL -> R.string.reader_night_text
}

private fun TimeOfDay.labelRes(): Int = when (this) {
    TimeOfDay.MORNING -> R.string.time_morning
    TimeOfDay.AFTERNOON -> R.string.time_afternoon
    TimeOfDay.EVENING -> R.string.time_evening
    TimeOfDay.NIGHT -> R.string.time_night
}

/** Looks back at one month or one year: what was read, how much, and when. */
@Composable
fun RecapScreen(onBack: () -> Unit, onOpenBook: (Long) -> Unit) {
    val container = LocalContainer.current
    val books by container.library.books.collectAsStateWithLifecycle(initialValue = emptyList())
    val sessions by container.library.sessions.collectAsStateWithLifecycle(initialValue = emptyList())
    val purchases by container.library.purchases.collectAsStateWithLifecycle(initialValue = emptyList())
    val today = remember { LocalDate.now() }
    var yearly by rememberSaveable { mutableStateOf(false) }
    var monthIndex by rememberSaveable { mutableStateOf(today.year * 12 + today.monthValue - 1) }
    val month = YearMonth.of(monthIndex / 12, monthIndex % 12 + 1)
    val from = if (yearly) LocalDate.of(month.year, 1, 1) else month.atDay(1)
    val to = if (yearly) LocalDate.of(month.year, 12, 31) else month.atEndOfMonth()
    val recap = remember(books, sessions, purchases, from, to) { Insights.recap(books, sessions, purchases, from, to) }
    val coverDir = container.covers.dir

    Scaffold(
        topBar = { TopAppBar(title = { Text(stringResource(R.string.recap_title)) }, navigationIcon = { BackButton(onBack) }) },
    ) { padding ->
        Column(Modifier.fillMaxSize().padding(padding).verticalScroll(rememberScrollState()).padding(bottom = 32.dp).testTag("recap")) {
            Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                FilterChip(selected = !yearly, onClick = { yearly = false }, label = { Text(stringResource(R.string.recap_month)) })
                FilterChip(selected = yearly, onClick = { yearly = true }, label = { Text(stringResource(R.string.recap_year)) }, modifier = Modifier.testTag("recapYear"))
            }
            SectionCard(null) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    IconButton(onClick = { monthIndex -= if (yearly) 12 else 1 }) {
                        Icon(Icons.AutoMirrored.Rounded.KeyboardArrowLeft, contentDescription = stringResource(R.string.calendar_previous))
                    }
                    Text(
                        if (yearly) month.year.toString()
                        else month.month.getDisplayName(TextStyle.FULL_STANDALONE, Locale.getDefault()).replaceFirstChar(Char::uppercase) + " " + month.year,
                        style = MaterialTheme.typography.headlineSmall,
                        textAlign = TextAlign.Center,
                        modifier = Modifier.weight(1f),
                    )
                    IconButton(onClick = { monthIndex += if (yearly) 12 else 1 }) {
                        Icon(Icons.AutoMirrored.Rounded.KeyboardArrowRight, contentDescription = stringResource(R.string.calendar_next))
                    }
                }
                Text(stringResource(recap.readerType.titleRes()), style = MaterialTheme.typography.titleLarge, color = MaterialTheme.colorScheme.primary, modifier = Modifier.padding(top = 8.dp))
                Text(stringResource(recap.readerType.textRes()), style = MaterialTheme.typography.bodyLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            SectionCard(stringResource(R.string.recap_numbers)) {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Number(recap.finished.size.toString(), stringResource(R.string.stats_books_finished), Modifier.weight(1f))
                    Number(recap.pages.toString(), stringResource(R.string.stats_pages), Modifier.weight(1f))
                    Number(formatDuration(recap.minutes), stringResource(R.string.stats_time), Modifier.weight(1f))
                }
                Spacer(Modifier.height(8.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Number(recap.sessions.toString(), stringResource(R.string.stats_sessions), Modifier.weight(1f))
                    Number(recap.readingDays.toString(), stringResource(R.string.recap_reading_days), Modifier.weight(1f))
                    Number(pluralStringResource(R.plurals.days, recap.bestStreak, recap.bestStreak), stringResource(R.string.stats_streak_best), Modifier.weight(1f))
                }
            }
            if (recap.finished.isNotEmpty()) {
                SectionCard(stringResource(R.string.recap_finished)) {
                    Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        recap.finished.forEach { book ->
                            BookCover(book.title, book.authors, coverModelOf(coverDir, book), Modifier.width(76.dp).clickable { onOpenBook(book.id) })
                        }
                    }
                }
            }
            Highlights(recap, onOpenBook)
            if (recap.topAuthors.isNotEmpty() || recap.topGenres.isNotEmpty()) {
                SectionCard(stringResource(R.string.recap_favourites)) {
                    if (recap.topAuthors.isNotEmpty()) Fact(stringResource(R.string.stats_top_authors), recap.topAuthors.joinToString(", ") { "${it.first} (${it.second})" })
                    if (recap.topGenres.isNotEmpty()) Fact(stringResource(R.string.stats_top_genres), recap.topGenres.joinToString(", ") { "${it.first} (${it.second})" })
                }
            }
            if (recap.spent.isNotEmpty()) {
                SectionCard(stringResource(R.string.recap_spent)) {
                    recap.spent.forEach { (currency, amount) ->
                        Text(String.format(Locale.getDefault(), "%.2f %s", amount, currency).trim(), style = MaterialTheme.typography.titleLarge.copy(fontFamily = Sans), color = MaterialTheme.colorScheme.primary)
                    }
                }
            }
        }
    }
}

@Composable
private fun Highlights(recap: Recap, onOpenBook: (Long) -> Unit) {
    if (recap.bestRated == null && recap.longest == null && recap.bestDay == null && recap.favouriteWeekday == null) return
    SectionCard(stringResource(R.string.recap_highlights)) {
        recap.bestRated?.let { book ->
            Row(Modifier.fillMaxWidth().clickable { onOpenBook(book.id) }.padding(vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text(stringResource(R.string.recap_best_rated), style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    Text(book.title, style = MaterialTheme.typography.titleMedium, maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
                RatingBar(book.rating, starSize = 16.dp)
            }
        }
        recap.longest?.let { book ->
            Fact(stringResource(R.string.recap_longest), book.title + " (" + pluralStringResource(R.plurals.pages_count, book.pageCount, book.pageCount) + ")") { onOpenBook(book.id) }
        }
        recap.bestDay?.let { day ->
            Fact(stringResource(R.string.recap_best_day), Dates.format(day.day) + ": " + if (day.pages > 0) pluralStringResource(R.plurals.pages_count, day.pages, day.pages) else formatDuration(day.minutes))
        }
        if (recap.averageRating > 0f) Fact(stringResource(R.string.stats_average_rating), formatRating(Math.round(recap.averageRating * 10) / 10f))
        recap.favouriteWeekday?.let { Fact(stringResource(R.string.recap_favourite_weekday), DayOfWeek.of(it).getDisplayName(TextStyle.FULL_STANDALONE, Locale.getDefault()).replaceFirstChar(Char::uppercase)) }
        recap.favouriteTime?.let { Fact(stringResource(R.string.recap_favourite_time), stringResource(it.labelRes())) }
    }
}

@Composable
private fun Fact(label: String, value: String, onClick: (() -> Unit)? = null) {
    Column(Modifier.fillMaxWidth().then(if (onClick != null) Modifier.clickable(onClick = onClick) else Modifier).padding(vertical = 4.dp)) {
        Text(label, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Text(value, style = MaterialTheme.typography.titleMedium)
    }
}

@Composable
private fun Number(value: String, label: String, modifier: Modifier = Modifier) {
    Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainerHighest), modifier = modifier) {
        Column(Modifier.padding(10.dp)) {
            // "12 h 35 min" has to fit where "4" does, so long values are set smaller.
            Text(
                value,
                style = MaterialTheme.typography.titleLarge.copy(fontFamily = Sans, fontSize = if (value.length > 7) 16.sp else 22.sp),
                color = MaterialTheme.colorScheme.primary,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            Text(label, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 2)
        }
    }
}
