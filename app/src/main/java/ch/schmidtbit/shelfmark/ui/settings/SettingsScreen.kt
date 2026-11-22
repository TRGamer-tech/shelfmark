@file:OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)

package ch.schmidtbit.shelfmark.ui.settings

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatDelegate
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.core.os.LocaleListCompat
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import ch.schmidtbit.shelfmark.BuildConfig
import ch.schmidtbit.shelfmark.R
import ch.schmidtbit.shelfmark.data.repo.CustomTheme
import ch.schmidtbit.shelfmark.data.repo.Settings
import ch.schmidtbit.shelfmark.ui.LocalContainer
import ch.schmidtbit.shelfmark.ui.LocalImporter
import ch.schmidtbit.shelfmark.ui.components.BackButton
import ch.schmidtbit.shelfmark.ui.components.SectionCard
import ch.schmidtbit.shelfmark.ui.theme.ThemePreset
import ch.schmidtbit.shelfmark.ui.theme.ThemePresets
import ch.schmidtbit.shelfmark.ui.theme.toPreset
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext
import java.time.LocalDate
import kotlin.math.abs

/** Reading speeds on offer, in pages per hour. Stored as minutes per page. */
val SpeedPresets = listOf(20, 30, 40, 50, 65)

@Composable
fun SettingsScreen(onBack: () -> Unit) {
    val container = LocalContainer.current
    val importer = LocalImporter.current
    val context = LocalContext.current
    val settings by container.settings.settings.collectAsStateWithLifecycle(initialValue = Settings())
    var exported by remember { mutableStateOf(false) }
    var themeEditorOpen by remember { mutableStateOf(false) }
    var editingTheme by remember { mutableStateOf<CustomTheme?>(null) }
    val coverJob by container.coverJob.collectAsStateWithLifecycle()

    val saveBackup = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("application/zip")) { uri ->
        if (uri != null) container.launch {
            withContext(Dispatchers.IO) { context.contentResolver.openOutputStream(uri)?.use { container.backup.export(it) } }
            exported = true
        }
    }
    val openBackup = rememberLauncherForActivityResult(ActivityResultContracts.GetContent()) { uri -> if (uri != null) importer.open(uri) }

    Scaffold(
        topBar = { TopAppBar(title = { Text(stringResource(R.string.settings_title)) }, navigationIcon = { BackButton(onBack) }) },
    ) { padding ->
        Column(Modifier.fillMaxSize().padding(padding).verticalScroll(rememberScrollState()).padding(bottom = 32.dp)) {
            SectionCard(stringResource(R.string.settings_language)) {
                val current = AppCompatDelegate.getApplicationLocales().toLanguageTags().substringBefore('-')
                FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    listOf("" to stringResource(R.string.settings_language_system), "de" to "Deutsch", "en" to "English").forEach { (tag, label) ->
                        FilterChip(
                            selected = current == tag,
                            onClick = { AppCompatDelegate.setApplicationLocales(if (tag.isEmpty()) LocaleListCompat.getEmptyLocaleList() else LocaleListCompat.forLanguageTags(tag)) },
                            label = { Text(label) },
                            modifier = Modifier.testTag("lang_$tag"),
                        )
                    }
                }
            }
            SectionCard(stringResource(R.string.settings_theme)) {
                ThemePicker(settings.theme, settings.customThemes, onEdit = { editingTheme = it; themeEditorOpen = true }) { key -> container.launch { container.settings.setTheme(key) } }
                TextButton(onClick = { editingTheme = null; themeEditorOpen = true }, modifier = Modifier.testTag("newTheme")) { Text(stringResource(R.string.theme_new)) }
            }
            SectionCard(stringResource(R.string.settings_speed)) {
                Text(stringResource(R.string.settings_speed_hint), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                Spacer(Modifier.height(8.dp))
                SpeedChips(settings.minutesPerPage) { container.launch { container.settings.setMinutesPerPage(it) } }
            }
            SectionCard(stringResource(R.string.settings_profile)) {
                SavedField(settings.profileName, stringResource(R.string.settings_profile_name), stringResource(R.string.settings_profile_hint), "profileName") {
                    container.settings.setProfileName(it)
                }
            }
            SectionCard(stringResource(R.string.settings_catalogue)) {
                Text(stringResource(R.string.settings_catalogue_text), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                Spacer(Modifier.height(8.dp))
                SavedField(settings.googleBooksKey, stringResource(R.string.settings_google_key), stringResource(R.string.settings_google_key_hint), "googleKey") {
                    container.settings.setGoogleBooksKey(it)
                }
            }
            SectionCard(stringResource(R.string.settings_backup)) {
                Text(stringResource(R.string.settings_backup_text), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                Spacer(Modifier.height(12.dp))
                Button(onClick = { exported = false; saveBackup.launch("shelfmark-backup-${LocalDate.now()}.zip") }, modifier = Modifier.fillMaxWidth().testTag("exportBackup")) {
                    Text(stringResource(R.string.settings_backup_export))
                }
                if (exported) Text(stringResource(R.string.settings_backup_done), color = MaterialTheme.colorScheme.primary, modifier = Modifier.padding(top = 4.dp))
                Spacer(Modifier.height(8.dp))
                OutlinedButton(onClick = { openBackup.launch("*/*") }, modifier = Modifier.fillMaxWidth().testTag("importBackup")) {
                    Text(stringResource(R.string.settings_backup_import))
                }
                Text(stringResource(R.string.settings_backup_import_hint), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(top = 8.dp))
            }
            SectionCard(stringResource(R.string.settings_import)) {
                Text(stringResource(R.string.settings_import_text), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                Spacer(Modifier.height(12.dp))
                OutlinedButton(onClick = { openBackup.launch("*/*") }, modifier = Modifier.fillMaxWidth().testTag("importCsv")) {
                    Text(stringResource(R.string.settings_import_button))
                }
                Spacer(Modifier.height(8.dp))
                val progress = coverJob
                OutlinedButton(onClick = { container.findMissingCovers() }, enabled = progress == null, modifier = Modifier.fillMaxWidth().testTag("findCovers")) {
                    Text(if (progress == null) stringResource(R.string.cover_find_missing) else stringResource(R.string.cover_finding, progress.first, progress.second))
                }
            }
            ThemeEditorHost(themeEditorOpen, editingTheme) { themeEditorOpen = false }
            SectionCard(stringResource(R.string.settings_about)) {
                Text("Shelfmark ${BuildConfig.VERSION_NAME}", style = MaterialTheme.typography.titleMedium)
                Text(stringResource(R.string.settings_about_text), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(top = 4.dp))
            }
        }
    }
}

@Composable
private fun ThemeEditorHost(open: Boolean, theme: CustomTheme?, onClose: () -> Unit) {
    if (!open) return
    val container = LocalContainer.current
    ThemeEditorDialog(
        existing = theme,
        onDismiss = onClose,
        onSave = { saved ->
            onClose()
            container.launch {
                container.settings.saveCustomTheme(saved)
                container.settings.setTheme(saved.key)
            }
        },
        onDelete = theme?.let { existing -> { onClose(); container.launch { container.settings.deleteCustomTheme(existing.id) } } },
    )
}

@Composable
fun SpeedChips(minutesPerPage: Float, onPick: (Float) -> Unit) {
    FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        SpeedPresets.forEach { pagesPerHour ->
            val value = 60f / pagesPerHour
            FilterChip(
                selected = abs(minutesPerPage - value) < 0.05f,
                onClick = { onPick(value) },
                label = { Text(stringResource(R.string.settings_speed_pph, pagesPerHour)) },
            )
        }
    }
}

/** A swatch per theme: its background with a dot in its accent colour. */
@Composable
fun ThemePicker(selected: String, custom: List<CustomTheme> = emptyList(), onEdit: ((CustomTheme) -> Unit)? = null, onPick: (String) -> Unit) {
    FlowRow(horizontalArrangement = Arrangement.spacedBy(10.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Swatch(null, stringResource(R.string.settings_theme_system), selected == Settings.THEME_SYSTEM) { onPick(Settings.THEME_SYSTEM) }
        ThemePresets.forEach { preset -> Swatch(preset, preset.name, selected == preset.key) { onPick(preset.key) } }
        // Tapping a theme of one's own selects it, tapping it again opens it for changes.
        custom.forEach { theme ->
            Swatch(theme.toPreset(), theme.name, selected == theme.key) { if (selected == theme.key && onEdit != null) onEdit(theme) else onPick(theme.key) }
        }
    }
}

@Composable
private fun Swatch(preset: ThemePreset?, name: String, selected: Boolean, onClick: () -> Unit) {
    val shape = RoundedCornerShape(12.dp)
    val background = preset?.background ?: MaterialTheme.colorScheme.surfaceContainerHighest
    val text = preset?.text ?: MaterialTheme.colorScheme.onSurface
    val accent = preset?.accent ?: MaterialTheme.colorScheme.primary
    Column(
        Modifier
            .width(92.dp)
            .clip(shape)
            .background(background)
            .border(if (selected) 3.dp else 1.dp, if (selected) accent else MaterialTheme.colorScheme.outlineVariant, shape)
            .clickable(onClick = onClick)
            .padding(10.dp)
            .testTag("theme_${preset?.key ?: "system"}"),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Box(Modifier.size(22.dp).clip(CircleShape).background(accent))
        Spacer(Modifier.height(6.dp))
        Text(name, color = text, style = MaterialTheme.typography.labelMedium, maxLines = 1)
    }
}

/** A single-line text field that stores its value shortly after typing stops. */
@Composable
private fun SavedField(value: String, label: String, hint: String, tag: String, onSave: suspend (String) -> Unit) {
    var text by remember { mutableStateOf(value) }
    var touched by remember { mutableStateOf(false) }
    // The stored value arrives a moment after the screen opens.
    LaunchedEffect(value) { if (!touched) text = value }
    LaunchedEffect(text) {
        if (touched && text != value) {
            delay(500)
            onSave(text)
        }
    }
    OutlinedTextField(
        value = text,
        onValueChange = { touched = true; text = it },
        label = { Text(label) },
        supportingText = { Text(hint) },
        singleLine = true,
        modifier = Modifier.fillMaxWidth().testTag(tag),
    )
}
