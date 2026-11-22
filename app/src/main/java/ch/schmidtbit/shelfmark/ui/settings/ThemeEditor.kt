package ch.schmidtbit.shelfmark.ui.settings

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Slider
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import ch.schmidtbit.shelfmark.R
import ch.schmidtbit.shelfmark.data.repo.CustomTheme
import java.util.UUID

/** "#1F1A17" for a colour, the way people write them. */
fun hexOf(argb: Int): String = "#%06X".format(argb and 0xFFFFFF)

/** Reads "#1F1A17" or "1f1a17". Returns null for anything else. */
fun parseHex(text: String): Int? {
    val digits = text.trim().removePrefix("#")
    if (digits.length != 6 || digits.any { it !in "0123456789abcdefABCDEF" }) return null
    return (0xFF000000 or digits.toLong(16)).toInt()
}

/** Build a theme of one's own from four colours: background, cards, accent and text. */
@Composable
fun ThemeEditorDialog(existing: CustomTheme?, onDismiss: () -> Unit, onSave: (CustomTheme) -> Unit, onDelete: (() -> Unit)?) {
    // A new theme starts from the warm dark default, so there is something to change.
    var name by remember { mutableStateOf(existing?.name.orEmpty()) }
    var background by remember { mutableIntStateOf(existing?.background ?: 0xFF1F1A17.toInt()) }
    var card by remember { mutableIntStateOf(existing?.card ?: 0xFF2C2622.toInt()) }
    var accent by remember { mutableIntStateOf(existing?.accent ?: 0xFFE5873F.toInt()) }
    var text by remember { mutableIntStateOf(existing?.text ?: 0xFFF0EAE4.toInt()) }
    var picking by remember { mutableStateOf<Int?>(null) }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(stringResource(if (existing == null) R.string.theme_new else R.string.theme_edit)) },
        text = {
            Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedTextField(name, { name = it.take(24) }, label = { Text(stringResource(R.string.lists_name)) }, singleLine = true, modifier = Modifier.fillMaxWidth().testTag("themeName"))
                // A small preview of how the four colours work together.
                Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(Color(background)).padding(12.dp).testTag("themePreview")) {
                    Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(8.dp)).background(Color(card)).padding(10.dp)) {
                        Text(name.ifBlank { stringResource(R.string.theme_new) }, color = Color(text), style = MaterialTheme.typography.titleMedium)
                        Text(stringResource(R.string.theme_preview_text), color = Color(text).copy(alpha = 0.7f), style = MaterialTheme.typography.bodySmall)
                        Spacer(Modifier.height(6.dp))
                        Box(Modifier.width(72.dp).height(8.dp).clip(RoundedCornerShape(4.dp)).background(Color(accent)))
                    }
                }
                ColourRow(stringResource(R.string.theme_background), background, "colourBackground") { picking = 0 }
                ColourRow(stringResource(R.string.theme_card), card, "colourCard") { picking = 1 }
                ColourRow(stringResource(R.string.theme_accent), accent, "colourAccent") { picking = 2 }
                ColourRow(stringResource(R.string.theme_text), text, "colourText") { picking = 3 }
            }
        },
        confirmButton = {
            TextButton(
                enabled = name.isNotBlank(),
                onClick = { onSave(CustomTheme(existing?.id ?: UUID.randomUUID().toString(), name.trim(), background, card, accent, text)) },
                modifier = Modifier.testTag("themeSave"),
            ) { Text(stringResource(R.string.action_save)) }
        },
        dismissButton = {
            Row {
                if (onDelete != null) TextButton(onClick = onDelete) { Text(stringResource(R.string.action_delete)) }
                TextButton(onClick = onDismiss) { Text(stringResource(R.string.action_cancel)) }
            }
        },
    )

    picking?.let { which ->
        val current = listOf(background, card, accent, text)[which]
        ColourPickerDialog(current, onDismiss = { picking = null }) { chosen ->
            when (which) {
                0 -> background = chosen
                1 -> card = chosen
                2 -> accent = chosen
                else -> text = chosen
            }
            picking = null
        }
    }
}

@Composable
private fun ColourRow(label: String, argb: Int, tag: String, onClick: () -> Unit) {
    Row(Modifier.fillMaxWidth().clickable(onClick = onClick).padding(vertical = 6.dp).testTag(tag), verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.size(32.dp).clip(CircleShape).background(Color(argb)).border(1.dp, MaterialTheme.colorScheme.outline, CircleShape))
        Spacer(Modifier.width(12.dp))
        Text(label, style = MaterialTheme.typography.bodyLarge, modifier = Modifier.weight(1f))
        Text(hexOf(argb), style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

/** Hue, saturation and brightness sliders, plus a field for those who know their hex codes. */
@Composable
fun ColourPickerDialog(initial: Int, onDismiss: () -> Unit, onPick: (Int) -> Unit) {
    val start = remember { FloatArray(3).also { android.graphics.Color.colorToHSV(initial, it) } }
    var hue by remember { mutableFloatStateOf(start[0]) }
    var saturation by remember { mutableFloatStateOf(start[1]) }
    var value by remember { mutableFloatStateOf(start[2]) }
    val argb = android.graphics.Color.HSVToColor(floatArrayOf(hue, saturation, value))
    var hex by remember { mutableStateOf(hexOf(initial)) }

    fun sync() { hex = hexOf(android.graphics.Color.HSVToColor(floatArrayOf(hue, saturation, value))) }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(stringResource(R.string.theme_pick_colour)) },
        text = {
            Column {
                Box(Modifier.fillMaxWidth().height(56.dp).clip(RoundedCornerShape(12.dp)).background(Color(argb)).border(1.dp, MaterialTheme.colorScheme.outline, RoundedCornerShape(12.dp)))
                Text(stringResource(R.string.theme_hue), style = MaterialTheme.typography.labelMedium, modifier = Modifier.padding(top = 12.dp))
                Slider(hue, { hue = it; sync() }, valueRange = 0f..360f, modifier = Modifier.testTag("sliderHue"))
                Text(stringResource(R.string.theme_saturation), style = MaterialTheme.typography.labelMedium)
                Slider(saturation, { saturation = it; sync() }, modifier = Modifier.testTag("sliderSaturation"))
                Text(stringResource(R.string.theme_brightness), style = MaterialTheme.typography.labelMedium)
                Slider(value, { value = it; sync() }, modifier = Modifier.testTag("sliderBrightness"))
                OutlinedTextField(
                    value = hex,
                    onValueChange = { typed ->
                        hex = typed.take(7)
                        parseHex(typed)?.let { parsed ->
                            val hsv = FloatArray(3).also { android.graphics.Color.colorToHSV(parsed, it) }
                            hue = hsv[0]; saturation = hsv[1]; value = hsv[2]
                        }
                    },
                    label = { Text(stringResource(R.string.theme_hex)) },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth().testTag("colourHex"),
                )
            }
        },
        confirmButton = { TextButton(onClick = { onPick(argb) }, modifier = Modifier.testTag("colourOk")) { Text(stringResource(R.string.action_ok)) } },
        dismissButton = { TextButton(onClick = onDismiss) { Text(stringResource(R.string.action_cancel)) } },
    )
}
