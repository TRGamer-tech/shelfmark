@file:OptIn(ExperimentalMaterial3Api::class)

package ch.schmidtbit.shelfmark.ui.stats

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.KeyboardArrowLeft
import androidx.compose.material.icons.automirrored.rounded.KeyboardArrowRight
import androidx.compose.material3.ExperimentalMaterial3Api
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
import androidx.compose.ui.draw.clip
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
import ch.schmidtbit.shelfmark.data.model.Book
import ch.schmidtbit.shelfmark.data.stats.DaySummary
import ch.schmidtbit.shelfmark.data.stats.Insights
import ch.schmidtbit.shelfmark.ui.LocalContainer
import ch.schmidtbit.shelfmark.ui.components.BackButton
import ch.schmidtbit.shelfmark.ui.components.BookCover
import ch.schmidtbit.shelfmark.ui.components.SectionCard
import ch.schmidtbit.shelfmark.ui.components.formatDuration
import ch.schmidtbit.shelfmark.ui.coverModelOf
import ch.schmidtbit.shelfmark.util.Dates
import java.time.DayOfWeek
import java.time.LocalDate
import java.time.YearMonth
import java.time.format.TextStyle
import java.util.Locale

/** A month at a glance: the more was read on a day, the stronger its colour, with the cover of the book. */
@Composable
fun CalendarScreen(onBack: () -> Unit, onOpenBook: (Long) -> Unit) {
    val container = LocalContainer.current
    val books by container.library.books.collectAsStateWithLifecycle(initialValue = emptyList())
    val sessions by container.library.sessions.collectAsStateWithLifecycle(initialValue = emptyList())
    val days = remember(books, sessions) { Insights.days(books, sessions) }
    val byId = remember(books) { books.associateBy { it.id } }
    val today = remember { LocalDate.now() }
    var monthIndex by rememberSaveable { mutableStateOf(today.year * 12 + today.monthValue - 1) }
    var selected by rememberSaveable { mutableStateOf<Long?>(null) }
    val month = YearMonth.of(monthIndex / 12, monthIndex % 12 + 1)

    Scaffold(
        topBar = { TopAppBar(title = { Text(stringResource(R.string.calendar_title)) }, navigationIcon = { BackButton(onBack) }) },
    ) { padding ->
        Column(Modifier.fillMaxSize().padding(padding).verticalScroll(rememberScrollState()).padding(bottom = 32.dp).testTag("calendar")) {
            SectionCard(null) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    IconButton(onClick = { monthIndex--; selected = null }, modifier = Modifier.testTag("calendarPrev")) {
                        Icon(Icons.AutoMirrored.Rounded.KeyboardArrowLeft, contentDescription = stringResource(R.string.calendar_previous))
                    }
                    Text(
                        month.month.getDisplayName(TextStyle.FULL_STANDALONE, Locale.getDefault()).replaceFirstChar(Char::uppercase) + " " + month.year,
                        style = MaterialTheme.typography.titleLarge,
                        textAlign = TextAlign.Center,
                        modifier = Modifier.weight(1f),
                    )
                    IconButton(onClick = { monthIndex++; selected = null }) {
                        Icon(Icons.AutoMirrored.Rounded.KeyboardArrowRight, contentDescription = stringResource(R.string.calendar_next))
                    }
                }
                MonthGrid(month, days, byId, today.toEpochDay(), selected) { selected = if (selected == it) null else it }
                val inMonth = days.values.filter { LocalDate.ofEpochDay(it.day).let { d -> d.year == month.year && d.month == month.month } }
                Text(
                    stringResource(
                        R.string.calendar_month_summary,
                        inMonth.sumOf { it.pages },
                        formatDuration(inMonth.sumOf { it.minutes }),
                        inMonth.flatMap { it.finishedIds }.distinct().size,
                    ),
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(top = 10.dp),
                )
            }
            selected?.let { day ->
                DayCard(day, days[day], byId, onOpenBook)
            }
            SectionCard(stringResource(R.string.calendar_year, month.year)) {
                YearHeatmap(month.year, days)
            }
        }
    }
}

@Composable
private fun MonthGrid(month: YearMonth, days: Map<Long, DaySummary>, books: Map<Long, Book>, today: Long, selected: Long?, onSelect: (Long) -> Unit) {
    val coverDir = LocalContainer.current.covers.dir
    val accent = MaterialTheme.colorScheme.primary
    val first = month.atDay(1)
    val lead = first.dayOfWeek.value - 1   // Monday first
    val max = (1..month.lengthOfMonth()).maxOf { days[month.atDay(it).toEpochDay()]?.amount ?: 0 }.coerceAtLeast(1)
    Row(Modifier.fillMaxWidth().padding(top = 4.dp)) {
        DayOfWeek.entries.forEach { weekday ->
            Text(
                weekday.getDisplayName(TextStyle.SHORT, Locale.getDefault()).take(2),
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                textAlign = TextAlign.Center,
                modifier = Modifier.weight(1f),
            )
        }
    }
    val cells = lead + month.lengthOfMonth()
    for (week in 0 until (cells + 6) / 7) {
        Row(Modifier.fillMaxWidth().padding(top = 4.dp), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
            for (column in 0..6) {
                val number = week * 7 + column - lead + 1
                if (number < 1 || number > month.lengthOfMonth()) {
                    Spacer(Modifier.weight(1f))
                } else {
                    val day = month.atDay(number).toEpochDay()
                    val summary = days[day]
                    val amount = summary?.amount ?: 0
                    val shape = RoundedCornerShape(6.dp)
                    val book = summary?.bookIds?.firstNotNullOfOrNull { books[it] }
                    Box(
                        Modifier
                            .weight(1f)
                            .aspectRatio(0.8f)
                            .clip(shape)
                            .background(if (summary != null) accent.copy(alpha = 0.18f + 0.6f * amount / max) else MaterialTheme.colorScheme.surfaceContainerHighest)
                            .border(
                                if (day == selected) 2.dp else if (day == today) 1.dp else 0.dp,
                                if (day == selected || day == today) accent else Color.Transparent,
                                shape,
                            )
                            .clickable { onSelect(day) }
                            .testTag("day_$number"),
                    ) {
                        if (book != null) {
                            BookCover(book.title, book.authors, coverModelOf(coverDir, book), Modifier.fillMaxSize().padding(3.dp), cornerRadius = 2.dp, elevation = 0.dp, tiny = true)
                        }
                        Text(
                            number.toString(),
                            style = MaterialTheme.typography.labelSmall,
                            color = if (book != null) Color.White else MaterialTheme.colorScheme.onSurface,
                            modifier = Modifier
                                .align(Alignment.TopStart)
                                .padding(2.dp)
                                .then(if (book != null) Modifier.background(Color.Black.copy(alpha = 0.55f), RoundedCornerShape(4.dp)).padding(horizontal = 3.dp) else Modifier),
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun DayCard(day: Long, summary: DaySummary?, books: Map<Long, Book>, onOpenBook: (Long) -> Unit) {
    SectionCard(Dates.format(day), Modifier.testTag("dayCard")) {
        if (summary == null) {
            Text(stringResource(R.string.calendar_nothing), style = MaterialTheme.typography.bodyLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
            return@SectionCard
        }
        Text(
            listOfNotNull(
                summary.pages.takeIf { it > 0 }?.let { pluralStringResource(R.plurals.pages_count, it, it) },
                summary.minutes.takeIf { it > 0 }?.let { formatDuration(it) },
            ).joinToString(" · ").ifBlank { stringResource(R.string.calendar_finished_only) },
            style = MaterialTheme.typography.titleMedium,
            color = MaterialTheme.colorScheme.primary,
        )
        summary.bookIds.mapNotNull { books[it] }.forEach { book ->
            Row(Modifier.fillMaxWidth().clickable { onOpenBook(book.id) }.padding(vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text(book.title, style = MaterialTheme.typography.bodyLarge, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    if (book.authors.isNotBlank()) Text(book.authors, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1)
                }
                if (book.id in summary.finishedIds) {
                    Text(stringResource(R.string.calendar_finished), style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.primary)
                }
            }
        }
    }
}

/** The whole year as small squares, a column per week. */
@Composable
private fun YearHeatmap(year: Int, days: Map<Long, DaySummary>) {
    val accent = MaterialTheme.colorScheme.primary
    val empty = MaterialTheme.colorScheme.surfaceContainerHighest
    val start = LocalDate.of(year, 1, 1)
    val length = start.lengthOfYear()
    val amounts = remember(year, days) { (0 until length).map { days[start.plusDays(it.toLong()).toEpochDay()]?.amount ?: 0 } }
    val max = amounts.max().coerceAtLeast(1)
    val lead = start.dayOfWeek.value - 1
    val weeks = (lead + length + 6) / 7
    Canvas(Modifier.fillMaxWidth().aspectRatio(weeks / 7f)) {
        val cell = size.width / weeks
        val gap = cell * 0.14f
        amounts.forEachIndexed { index, amount ->
            val slot = lead + index
            drawRoundRect(
                color = if (amount > 0) accent.copy(alpha = 0.25f + 0.75f * amount / max) else empty,
                topLeft = Offset((slot / 7) * cell + gap / 2, (slot % 7) * cell + gap / 2),
                size = Size(cell - gap, cell - gap),
                cornerRadius = CornerRadius(cell * 0.2f),
            )
        }
    }
    Row(Modifier.fillMaxWidth().padding(top = 6.dp), verticalAlignment = Alignment.CenterVertically) {
        Text(
            pluralStringResource(R.plurals.reading_days, amounts.count { it > 0 }, amounts.count { it > 0 }),
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.weight(1f),
        )
        Text(stringResource(R.string.calendar_less), style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        listOf(0f, 0.25f, 0.5f, 0.75f, 1f).forEach { level ->
            Box(Modifier.padding(start = 3.dp).width(10.dp).height(10.dp).clip(RoundedCornerShape(2.dp)).background(if (level == 0f) empty else accent.copy(alpha = 0.25f + 0.75f * level)))
        }
        Text(stringResource(R.string.calendar_more), style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(start = 4.dp))
    }
}
