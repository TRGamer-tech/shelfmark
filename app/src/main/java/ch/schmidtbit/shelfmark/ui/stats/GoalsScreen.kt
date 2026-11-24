@file:OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)

package ch.schmidtbit.shelfmark.ui.stats

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
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
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Add
import androidx.compose.material.icons.rounded.Delete
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExtendedFloatingActionButton
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import ch.schmidtbit.shelfmark.R
import ch.schmidtbit.shelfmark.data.model.Goal
import ch.schmidtbit.shelfmark.data.model.GoalKind
import ch.schmidtbit.shelfmark.data.model.GoalRepeat
import ch.schmidtbit.shelfmark.data.stats.GoalMath
import ch.schmidtbit.shelfmark.data.stats.GoalProgress
import ch.schmidtbit.shelfmark.ui.LocalContainer
import ch.schmidtbit.shelfmark.ui.components.BackButton
import ch.schmidtbit.shelfmark.ui.components.ConfirmDelete
import ch.schmidtbit.shelfmark.ui.components.DayPickerDialog
import ch.schmidtbit.shelfmark.ui.components.SectionCard
import ch.schmidtbit.shelfmark.ui.detail.EmptyHint
import ch.schmidtbit.shelfmark.ui.detail.NumberField
import ch.schmidtbit.shelfmark.ui.theme.LocalShelfColors
import ch.schmidtbit.shelfmark.util.Dates
import java.time.LocalDate
import kotlin.math.ceil

@Composable
private fun GoalKind.unit(count: Int): String = when (this) {
    GoalKind.BOOKS -> pluralStringResource(R.plurals.unit_books, count)
    GoalKind.PAGES -> pluralStringResource(R.plurals.unit_pages_plural, count)
    GoalKind.MINUTES -> pluralStringResource(R.plurals.unit_minutes_plural, count)
}

private fun GoalRepeat.labelRes(): Int = when (this) {
    GoalRepeat.ONCE -> R.string.goal_repeat_once
    GoalRepeat.DAILY -> R.string.goal_repeat_daily
    GoalRepeat.WEEKLY -> R.string.goal_repeat_weekly
    GoalRepeat.MONTHLY -> R.string.goal_repeat_monthly
    GoalRepeat.YEARLY -> R.string.goal_repeat_yearly
}

/** The goal's own name, or a description such as "12 books, every year". */
@Composable
fun goalTitle(goal: Goal): String =
    goal.name.ifBlank { "${goal.target} ${goal.kind.unit(goal.target)}, ${stringResource(goal.repeat.labelRes())}" }

@Composable
fun GoalsScreen(onBack: () -> Unit) {
    val container = LocalContainer.current
    val books by container.library.books.collectAsStateWithLifecycle(initialValue = emptyList())
    val sessions by container.library.sessions.collectAsStateWithLifecycle(initialValue = emptyList())
    val goals by container.library.goals.collectAsStateWithLifecycle(initialValue = null)
    val today = remember { LocalDate.now() }
    val progress = remember(goals, books, sessions) { goals.orEmpty().filter { !it.archived }.map { GoalMath.progress(it, books, sessions, today) } }
    var editing by remember { mutableStateOf<Goal?>(null) }
    var deleting by remember { mutableStateOf<Goal?>(null) }
    deleting?.let { goal ->
        ConfirmDelete(stringResource(R.string.delete_goal_title), onDismiss = { deleting = null }) {
            deleting = null
            container.launch { container.library.deleteGoal(goal.id) }
        }
    }

    Scaffold(
        topBar = { TopAppBar(title = { Text(stringResource(R.string.goals_title)) }, navigationIcon = { BackButton(onBack) }) },
        floatingActionButton = {
            ExtendedFloatingActionButton(
                onClick = {
                    editing = Goal(target = 12, startDay = today.withDayOfYear(1).toEpochDay(), endDay = today.withDayOfYear(today.lengthOfYear()).toEpochDay(), repeat = GoalRepeat.YEARLY)
                },
                icon = { Icon(Icons.Rounded.Add, contentDescription = null) },
                text = { Text(stringResource(R.string.goal_new)) },
                modifier = Modifier.testTag("newGoal"),
            )
        },
    ) { padding ->
        LazyColumn(Modifier.fillMaxSize().padding(padding), contentPadding = PaddingValues(top = 6.dp, bottom = 96.dp)) {
            if (goals != null && progress.isEmpty()) item(key = "empty") { EmptyHint(stringResource(R.string.goals_empty)) }
            items(progress, key = { it.goal.id }) { item ->
                GoalCard(item, onEdit = { editing = item.goal }, onDelete = { deleting = item.goal })
            }
        }
    }

    editing?.let { goal ->
        GoalDialog(goal, onDismiss = { editing = null }) { saved ->
            editing = null
            container.launch { container.library.saveGoal(saved) }
        }
    }
}

@Composable
private fun GoalCard(progress: GoalProgress, onEdit: () -> Unit, onDelete: () -> Unit) {
    val goal = progress.goal
    val colors = LocalShelfColors.current
    SectionCard(null, Modifier.clickable(onClick = onEdit).testTag("goalCard")) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Box(contentAlignment = Alignment.Center) {
                CircularProgressIndicator(
                    progress = { progress.fraction },
                    color = if (progress.reached) colors.good else MaterialTheme.colorScheme.primary,
                    trackColor = MaterialTheme.colorScheme.surfaceContainerHighest,
                    strokeWidth = 7.dp,
                    modifier = Modifier.size(68.dp),
                )
                Text("${(progress.fraction * 100).toInt()}%", style = MaterialTheme.typography.labelLarge)
            }
            Spacer(Modifier.width(16.dp))
            Column(Modifier.weight(1f)) {
                Text(goalTitle(goal), style = MaterialTheme.typography.titleMedium)
                Text(
                    stringResource(R.string.goal_done_of, progress.done, goal.target, goal.kind.unit(goal.target)),
                    style = MaterialTheme.typography.bodyLarge,
                    modifier = Modifier.testTag("goalDone"),
                )
                val status = when {
                    progress.reached -> stringResource(R.string.goal_reached)
                    progress.daysLeft <= 0 -> stringResource(R.string.goal_over)
                    else -> stringResource(if (progress.ahead) R.string.goal_ahead else R.string.goal_behind)
                }
                Text(
                    status,
                    style = MaterialTheme.typography.labelLarge,
                    color = if (progress.reached || progress.ahead) colors.good else colors.spice,
                )
                progress.perDay?.let { perDay ->
                    val hint = if (goal.kind == GoalKind.BOOKS && perDay < 1f) {
                        // "A book every N days" reads better than "0.07 books a day".
                        stringResource(R.string.goal_hint_book_every, (progress.daysLeft / progress.remaining.coerceAtLeast(1)).coerceAtLeast(1))
                    } else {
                        val amount = ceil(perDay).toInt()
                        stringResource(R.string.goal_hint_per_day, amount, goal.kind.unit(amount))
                    }
                    Text(hint, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                Text(
                    stringResource(R.string.goal_period, Dates.format(progress.start), Dates.format(progress.end)) + " · " +
                        pluralStringResource(R.plurals.days_left, progress.daysLeft, progress.daysLeft),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            IconButton(onClick = onDelete, modifier = Modifier.testTag("deleteGoal")) {
                Icon(Icons.Rounded.Delete, contentDescription = stringResource(R.string.action_delete), tint = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
    }
}

@Composable
private fun GoalDialog(goal: Goal, onDismiss: () -> Unit, onSave: (Goal) -> Unit) {
    var name by remember { mutableStateOf(goal.name) }
    var kind by remember { mutableStateOf(goal.kind) }
    var target by remember { mutableStateOf(goal.target.toString()) }
    var repeat by remember { mutableStateOf(goal.repeat) }
    var start by remember { mutableStateOf(goal.startDay) }
    var end by remember { mutableStateOf(goal.endDay) }
    var picking by remember { mutableStateOf(0) }
    val amount = target.toIntOrNull() ?: 0
    val valid = amount > 0 && (repeat != GoalRepeat.ONCE || end >= start)

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(stringResource(if (goal.id == 0L) R.string.goal_new else R.string.goal_edit)) },
        text = {
            Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(stringResource(R.string.goal_what), style = MaterialTheme.typography.labelLarge)
                FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    GoalKind.entries.forEach { k ->
                        FilterChip(selected = kind == k, onClick = { kind = k }, label = { Text(k.unit(2).replaceFirstChar(Char::uppercase)) }, modifier = Modifier.testTag("goalKind_${k.name}"))
                    }
                }
                NumberField(target, { target = it }, stringResource(R.string.goal_target), Modifier.fillMaxWidth(), "goalTarget")
                Text(stringResource(R.string.goal_when), style = MaterialTheme.typography.labelLarge)
                FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    GoalRepeat.entries.forEach { r ->
                        FilterChip(selected = repeat == r, onClick = { repeat = r }, label = { Text(stringResource(r.labelRes())) }, modifier = Modifier.testTag("goalRepeat_${r.name}"))
                    }
                }
                if (repeat == GoalRepeat.ONCE) {
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        TextButton(onClick = { picking = 1 }) { Text(stringResource(R.string.goal_from, Dates.format(start))) }
                        TextButton(onClick = { picking = 2 }) { Text(stringResource(R.string.goal_until, Dates.format(end))) }
                    }
                }
                OutlinedTextField(name, { name = it.take(60) }, label = { Text(stringResource(R.string.goal_name)) }, singleLine = true, modifier = Modifier.fillMaxWidth())
                Spacer(Modifier.height(4.dp))
            }
        },
        confirmButton = {
            TextButton(enabled = valid, onClick = { onSave(goal.copy(name = name.trim(), kind = kind, target = amount, repeat = repeat, startDay = start, endDay = end)) }, modifier = Modifier.testTag("goalSave")) {
                Text(stringResource(R.string.action_save))
            }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text(stringResource(R.string.action_cancel)) } },
    )
    if (picking == 1) DayPickerDialog(start, { picking = 0 }) { picking = 0; if (it != null) start = it }
    if (picking == 2) DayPickerDialog(end, { picking = 0 }) { picking = 0; if (it != null) end = it }
}
