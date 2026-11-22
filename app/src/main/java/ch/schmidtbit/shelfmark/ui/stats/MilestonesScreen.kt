@file:OptIn(ExperimentalMaterial3Api::class)

package ch.schmidtbit.shelfmark.ui.stats

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.MenuBook
import androidx.compose.material.icons.rounded.AutoStories
import androidx.compose.material.icons.rounded.Bookmark
import androidx.compose.material.icons.rounded.Description
import androidx.compose.material.icons.rounded.EmojiEvents
import androidx.compose.material.icons.rounded.FormatQuote
import androidx.compose.material.icons.rounded.LocalFireDepartment
import androidx.compose.material.icons.rounded.RateReview
import androidx.compose.material.icons.rounded.Schedule
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import ch.schmidtbit.shelfmark.R
import ch.schmidtbit.shelfmark.data.stats.Milestone
import ch.schmidtbit.shelfmark.data.stats.MilestoneCategory
import ch.schmidtbit.shelfmark.data.stats.Milestones
import ch.schmidtbit.shelfmark.ui.LocalContainer
import ch.schmidtbit.shelfmark.ui.components.BackButton
import ch.schmidtbit.shelfmark.ui.components.SectionCard
import ch.schmidtbit.shelfmark.ui.components.SectionTitle
import ch.schmidtbit.shelfmark.ui.theme.LocalShelfColors
import ch.schmidtbit.shelfmark.ui.theme.Sans
import ch.schmidtbit.shelfmark.util.Dates
import java.time.LocalDate

private fun MilestoneCategory.labelRes(): Int = when (this) {
    MilestoneCategory.BOOKS -> R.string.milestone_books
    MilestoneCategory.PAGES -> R.string.milestone_pages
    MilestoneCategory.SESSIONS -> R.string.milestone_sessions
    MilestoneCategory.HOURS -> R.string.milestone_hours
    MilestoneCategory.REVIEWS -> R.string.milestone_reviews
    MilestoneCategory.QUOTES -> R.string.milestone_quotes
    MilestoneCategory.STREAK -> R.string.milestone_streak
    MilestoneCategory.LONG_BOOKS -> R.string.milestone_long_books
}

private fun MilestoneCategory.icon(): ImageVector = when (this) {
    MilestoneCategory.BOOKS -> Icons.AutoMirrored.Rounded.MenuBook
    MilestoneCategory.PAGES -> Icons.Rounded.Description
    MilestoneCategory.SESSIONS -> Icons.Rounded.Bookmark
    MilestoneCategory.HOURS -> Icons.Rounded.Schedule
    MilestoneCategory.REVIEWS -> Icons.Rounded.RateReview
    MilestoneCategory.QUOTES -> Icons.Rounded.FormatQuote
    MilestoneCategory.STREAK -> Icons.Rounded.LocalFireDepartment
    MilestoneCategory.LONG_BOOKS -> Icons.Rounded.AutoStories
}

/** How far the reader has come in each discipline, and when the big moments happened. */
@Composable
fun MilestonesScreen(onBack: () -> Unit, onOpenBook: (Long) -> Unit) {
    val container = LocalContainer.current
    val books by container.library.books.collectAsStateWithLifecycle(initialValue = emptyList())
    val sessions by container.library.sessions.collectAsStateWithLifecycle(initialValue = emptyList())
    val quotes by container.library.quotes.collectAsStateWithLifecycle(initialValue = emptyList())
    val milestones = remember(books, sessions, quotes.size) { Milestones.compute(books, sessions, quotes.size, LocalDate.now()) }
    val timeline = remember(books) { Milestones.timeline(books) }

    Scaffold(
        topBar = { TopAppBar(title = { Text(stringResource(R.string.milestones_title)) }, navigationIcon = { BackButton(onBack) }) },
    ) { padding ->
        LazyColumn(Modifier.fillMaxSize().padding(padding).testTag("milestones"), contentPadding = PaddingValues(bottom = 32.dp)) {
            items(milestones, key = { it.category.name }) { MilestoneCard(it) }
            if (timeline.isNotEmpty()) {
                item(key = "timelineTitle") { SectionTitle(stringResource(R.string.milestones_journey)) }
                items(timeline, key = { "${it.category}_${it.tier}" }) { event ->
                    Row(
                        Modifier.fillMaxWidth().clickable(enabled = event.book != null) { event.book?.let { onOpenBook(it.id) } }.padding(horizontal = 16.dp, vertical = 8.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Icon(Icons.Rounded.EmojiEvents, contentDescription = null, tint = LocalShelfColors.current.star)
                        Spacer(Modifier.width(14.dp))
                        Column {
                            Text(
                                stringResource(if (event.category == MilestoneCategory.LONG_BOOKS) R.string.milestone_event_long else R.string.milestone_event_book, event.tier),
                                style = MaterialTheme.typography.titleMedium,
                            )
                            Text(
                                listOfNotNull(event.book?.title, Dates.format(event.day)).joinToString(" · "),
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun MilestoneCard(milestone: Milestone) {
    val gold = LocalShelfColors.current.star
    SectionCard(null, Modifier.testTag("milestone_${milestone.category.name}")) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Icon(milestone.category.icon(), contentDescription = null, tint = MaterialTheme.colorScheme.primary, modifier = Modifier.size(28.dp))
            Spacer(Modifier.width(14.dp))
            Column(Modifier.weight(1f)) {
                Text(stringResource(milestone.category.labelRes()), style = MaterialTheme.typography.titleMedium)
                // One dot per tier, filled once it is reached.
                Row(Modifier.padding(top = 4.dp), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                    milestone.tiers.forEachIndexed { index, _ ->
                        Box(Modifier.size(10.dp).clip(CircleShape).background(if (index < milestone.reached) gold else MaterialTheme.colorScheme.surfaceContainerHighest))
                    }
                }
            }
            Text(milestone.value.toString(), style = MaterialTheme.typography.headlineSmall.copy(fontFamily = Sans), color = MaterialTheme.colorScheme.primary)
        }
        Spacer(Modifier.height(10.dp))
        LinearProgressIndicator(progress = { milestone.progress }, modifier = Modifier.fillMaxWidth().height(6.dp))
        Text(
            milestone.next?.let { stringResource(R.string.milestone_next, it) } ?: stringResource(R.string.milestone_all_done),
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(top = 4.dp),
        )
    }
}
