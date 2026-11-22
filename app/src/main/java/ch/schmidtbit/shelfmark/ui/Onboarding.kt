package ch.schmidtbit.shelfmark.ui

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.MenuBook
import androidx.compose.material3.Button
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import ch.schmidtbit.shelfmark.R
import ch.schmidtbit.shelfmark.data.SampleBooks
import ch.schmidtbit.shelfmark.data.repo.Settings
import ch.schmidtbit.shelfmark.ui.settings.SpeedChips
import ch.schmidtbit.shelfmark.ui.settings.ThemePicker
import ch.schmidtbit.shelfmark.util.Dates

/** Three short pages on first start: who you are, how it should look, how to begin. */
@Composable
fun Onboarding(settings: Settings) {
    val container = LocalContainer.current
    val importer = LocalImporter.current
    var page by rememberSaveable { mutableIntStateOf(0) }
    var name by rememberSaveable { mutableStateOf("") }
    val openBackup = rememberLauncherForActivityResult(ActivityResultContracts.GetContent()) { uri ->
        if (uri != null) {
            importer.open(uri)
            container.launch { container.settings.setOnboarded() }
        }
    }

    fun finish(withSamples: Boolean) = container.launch {
        if (name.isNotBlank()) container.settings.setProfileName(name)
        if (withSamples) SampleBooks.create(Dates.today()).forEach { container.library.addBook(it) }
        container.settings.setOnboarded()
    }

    Column(Modifier.fillMaxSize().safeDrawingPadding().testTag("onboarding")) {
      // The page scrolls, the Back and Next buttons below stay in reach on small screens.
      Column(
        Modifier.weight(1f).fillMaxWidth().verticalScroll(rememberScrollState()).padding(start = 28.dp, end = 28.dp, top = 28.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
      ) {
        when (page) {
            0 -> {
                Icon(Icons.AutoMirrored.Rounded.MenuBook, contentDescription = null, tint = MaterialTheme.colorScheme.primary, modifier = Modifier.size(84.dp))
                Spacer(Modifier.height(20.dp))
                Text(stringResource(R.string.app_name), style = MaterialTheme.typography.displaySmall)
                Spacer(Modifier.height(8.dp))
                Text(stringResource(R.string.onboarding_tagline), style = MaterialTheme.typography.bodyLarge, textAlign = TextAlign.Center, color = MaterialTheme.colorScheme.onSurfaceVariant)
                Spacer(Modifier.height(28.dp))
                OutlinedTextField(
                    value = name,
                    onValueChange = { name = it.take(40) },
                    label = { Text(stringResource(R.string.settings_profile_name)) },
                    supportingText = { Text(stringResource(R.string.settings_profile_hint)) },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
            }
            1 -> {
                Text(stringResource(R.string.onboarding_look), style = MaterialTheme.typography.headlineSmall, textAlign = TextAlign.Center)
                Spacer(Modifier.height(20.dp))
                ThemePicker(settings.theme) { key -> container.launch { container.settings.setTheme(key) } }
                Spacer(Modifier.height(28.dp))
                Text(stringResource(R.string.settings_speed), style = MaterialTheme.typography.titleMedium)
                Text(stringResource(R.string.settings_speed_hint), style = MaterialTheme.typography.bodyMedium, textAlign = TextAlign.Center, color = MaterialTheme.colorScheme.onSurfaceVariant)
                Spacer(Modifier.height(8.dp))
                SpeedChips(settings.minutesPerPage) { container.launch { container.settings.setMinutesPerPage(it) } }
            }
            else -> {
                Text(stringResource(R.string.onboarding_start), style = MaterialTheme.typography.headlineSmall, textAlign = TextAlign.Center)
                Spacer(Modifier.height(24.dp))
                Button(onClick = { finish(withSamples = false) }, modifier = Modifier.fillMaxWidth().testTag("startEmpty")) { Text(stringResource(R.string.onboarding_start_empty)) }
                Spacer(Modifier.height(10.dp))
                OutlinedButton(onClick = { finish(withSamples = true) }, modifier = Modifier.fillMaxWidth().testTag("startSamples")) { Text(stringResource(R.string.onboarding_start_samples)) }
                Spacer(Modifier.height(10.dp))
                OutlinedButton(onClick = { openBackup.launch("*/*") }, modifier = Modifier.fillMaxWidth()) { Text(stringResource(R.string.onboarding_start_import)) }
                Text(stringResource(R.string.settings_backup_import_hint), style = MaterialTheme.typography.bodySmall, textAlign = TextAlign.Center, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(top = 8.dp))
            }
        }
      }
        Row(Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 12.dp), horizontalArrangement = Arrangement.SpaceBetween) {
            TextButton(onClick = { page-- }, enabled = page > 0) { Text(stringResource(R.string.action_back)) }
            if (page < 2) Button(onClick = { page++ }, modifier = Modifier.testTag("onboardingNext")) { Text(stringResource(R.string.action_next)) }
        }
    }
}
