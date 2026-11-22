package ch.schmidtbit.shelfmark.ui.detail

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import ch.schmidtbit.shelfmark.R
import ch.schmidtbit.shelfmark.data.model.Purchase
import ch.schmidtbit.shelfmark.ui.LocalContainer
import ch.schmidtbit.shelfmark.ui.components.DayPickerDialog
import ch.schmidtbit.shelfmark.ui.components.SectionCard
import ch.schmidtbit.shelfmark.util.Dates
import java.util.Currency
import java.util.Locale

/** "14.90 CHF", or just the number when no currency was entered. */
fun formatPrice(price: Double, currency: String): String =
    (String.format(Locale.getDefault(), "%.2f", price) + " " + currency.trim()).trim()

/** The currency of the phone's region, as a sensible first guess. */
private fun localCurrency(): String = runCatching { Currency.getInstance(Locale.getDefault()).currencyCode }.getOrDefault("")

/** What was paid for the book, where and when. A book can have several entries, e.g. a second copy. */
@Composable
fun PurchaseSection(bookId: Long, purchases: List<Purchase>) {
    val container = LocalContainer.current
    var editing by remember { mutableStateOf<Purchase?>(null) }
    SectionCard(stringResource(R.string.purchase_title)) {
        purchases.forEach { purchase ->
            Column(Modifier.fillMaxWidth().clickable { editing = purchase }.padding(vertical = 4.dp)) {
                Text(
                    listOfNotNull(formatPrice(purchase.price, purchase.currency).takeIf { purchase.price > 0 }, purchase.store.takeIf { it.isNotBlank() }).joinToString(" · ")
                        .ifBlank { stringResource(R.string.purchase_title) },
                    style = MaterialTheme.typography.titleMedium,
                )
                Text(
                    listOfNotNull(Dates.format(purchase.day), purchase.note.takeIf { it.isNotBlank() }).joinToString(" · "),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
        TextButton(
            onClick = { editing = Purchase(bookId = bookId, day = Dates.today(), currency = localCurrency()) },
            modifier = Modifier.testTag("addPurchase"),
        ) { Text(stringResource(R.string.purchase_add)) }
    }

    editing?.let { purchase ->
        var price by remember(purchase) { mutableStateOf(purchase.price.takeIf { it > 0 }?.let { String.format(Locale.ROOT, "%.2f", it) }.orEmpty()) }
        var currency by remember(purchase) { mutableStateOf(purchase.currency) }
        var store by remember(purchase) { mutableStateOf(purchase.store) }
        var note by remember(purchase) { mutableStateOf(purchase.note) }
        var day by remember(purchase) { mutableStateOf(purchase.day) }
        var pickingDay by remember { mutableStateOf(false) }
        AlertDialog(
            onDismissRequest = { editing = null },
            title = { Text(stringResource(if (purchase.id == 0L) R.string.purchase_add else R.string.purchase_edit)) },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        OutlinedTextField(
                            value = price,
                            onValueChange = { new -> price = new.filter { it.isDigit() || it == '.' || it == ',' }.take(9) },
                            label = { Text(stringResource(R.string.purchase_price)) },
                            singleLine = true,
                            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                            modifier = Modifier.weight(2f).testTag("purchasePrice"),
                        )
                        OutlinedTextField(
                            value = currency,
                            onValueChange = { currency = it.take(4).uppercase() },
                            label = { Text(stringResource(R.string.purchase_currency)) },
                            singleLine = true,
                            modifier = Modifier.weight(1f),
                        )
                    }
                    OutlinedTextField(
                        value = store,
                        onValueChange = { store = it.take(60) },
                        label = { Text(stringResource(R.string.purchase_store)) },
                        singleLine = true,
                        keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Words),
                        modifier = Modifier.fillMaxWidth().testTag("purchaseStore"),
                    )
                    OutlinedTextField(note, { note = it.take(120) }, label = { Text(stringResource(R.string.quote_note)) }, singleLine = true, modifier = Modifier.fillMaxWidth())
                    TextButton(onClick = { pickingDay = true }) { Text(stringResource(R.string.purchase_date, Dates.format(day))) }
                }
            },
            confirmButton = {
                TextButton(onClick = {
                    editing = null
                    val saved = purchase.copy(price = price.replace(',', '.').toDoubleOrNull() ?: 0.0, currency = currency.trim(), store = store.trim(), note = note.trim(), day = day)
                    container.launch { container.library.savePurchase(saved) }
                }, modifier = Modifier.testTag("purchaseSave")) { Text(stringResource(R.string.action_save)) }
            },
            dismissButton = {
                Row {
                    if (purchase.id != 0L) {
                        TextButton(onClick = {
                            editing = null
                            container.launch { container.library.deletePurchase(purchase.id) }
                        }) { Text(stringResource(R.string.action_delete)) }
                    }
                    TextButton(onClick = { editing = null }) { Text(stringResource(R.string.action_cancel)) }
                }
            },
        )
        if (pickingDay) DayPickerDialog(day, { pickingDay = false }) { picked -> pickingDay = false; if (picked != null) day = picked }
    }
}
