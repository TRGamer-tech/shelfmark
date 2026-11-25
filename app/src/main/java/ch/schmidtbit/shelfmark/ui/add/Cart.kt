@file:OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)

package ch.schmidtbit.shelfmark.ui.add

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Check
import androidx.compose.material.icons.rounded.Close
import androidx.compose.material.icons.rounded.DeleteSweep
import androidx.compose.material.icons.rounded.Tune
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Checkbox
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.addPathNodes
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import ch.schmidtbit.shelfmark.R
import ch.schmidtbit.shelfmark.data.cart.Cart
import ch.schmidtbit.shelfmark.data.cart.CartItem
import ch.schmidtbit.shelfmark.data.cart.CartSettings
import ch.schmidtbit.shelfmark.data.cart.ShelfCheck
import ch.schmidtbit.shelfmark.data.model.Ownership
import ch.schmidtbit.shelfmark.data.model.Shelf
import ch.schmidtbit.shelfmark.ui.LocalContainer
import ch.schmidtbit.shelfmark.ui.components.BackButton
import ch.schmidtbit.shelfmark.ui.components.BookCover
import ch.schmidtbit.shelfmark.ui.coverModelOf
import ch.schmidtbit.shelfmark.ui.edit.StatusChips
import ch.schmidtbit.shelfmark.ui.labelRes

// The screens of the book cart (data/cart): the bar that says it holds books, the button
// that puts a search result on it, and the cart itself, where the books are set and shelved.

/** A library's book cart: two posts, a shelf with three books on it, and wheels. The website draws the same. */
val CartIcon: ImageVector by lazy {
    ImageVector.Builder(name = "BookCart", defaultWidth = 24.dp, defaultHeight = 24.dp, viewportWidth = 24f, viewportHeight = 24f)
        .addPath(
            addPathNodes("M3 3h2v13h14V3h2v15H3zM7 6h2.5v9H7zM10.5 4h3v11h-3zM14.5 7H17v8h-2.5zM6.5 19a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3zM17.5 19a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3z"),
            fill = SolidColor(Color.Black),
        )
        .build()
}

/** While the cart holds books, the screens for adding them say so at the bottom, with the way to it. */
@Composable
fun CartBar(onOpen: () -> Unit, modifier: Modifier = Modifier) {
    val cart by LocalContainer.current.cart.cart.collectAsStateWithLifecycle()
    val count = cart.count
    if (count == 0) return
    Surface(
        shape = RoundedCornerShape(16.dp),
        color = MaterialTheme.colorScheme.secondaryContainer,
        contentColor = MaterialTheme.colorScheme.onSecondaryContainer,
        shadowElevation = 3.dp,
        modifier = modifier.fillMaxWidth().testTag("cartBar"),
    ) {
        Row(Modifier.padding(start = 16.dp, end = 6.dp, top = 4.dp, bottom = 4.dp), verticalAlignment = Alignment.CenterVertically) {
            Icon(CartIcon, contentDescription = null)
            Spacer(Modifier.width(12.dp))
            Text(pluralStringResource(R.plurals.cart_count, count, count), style = MaterialTheme.typography.titleSmall, modifier = Modifier.weight(1f).testTag("cartCount"))
            TextButton(onClick = onOpen, modifier = Modifier.testTag("openCart")) { Text(stringResource(R.string.cart_open)) }
        }
    }
}

/** The button of a search result: on the cart if it is not, off it if it is. */
@Composable
fun CartToggle(on: Boolean, onToggle: () -> Unit, modifier: Modifier = Modifier) {
    FilterChip(
        selected = on,
        onClick = onToggle,
        label = { Text(stringResource(if (on) R.string.cart_on else R.string.cart_put), maxLines = 1) },
        leadingIcon = { Icon(if (on) Icons.Rounded.Check else CartIcon, contentDescription = null, modifier = Modifier.size(18.dp)) },
        modifier = modifier,
    )
}

/**
 * The cart: at the top how its books are shelved, below the books, at the bottom the button
 * that shelves them all. [onShelved] is told how many went onto the shelf.
 */
@Composable
fun CartScreen(onBack: () -> Unit, onShelved: (Int) -> Unit) {
    val container = LocalContainer.current
    val cart by container.cart.cart.collectAsStateWithLifecycle()
    val library by container.library.books.collectAsStateWithLifecycle(initialValue = null)
    val shelves by container.library.shelves.collectAsStateWithLifecycle(initialValue = emptyList())
    val coverDir = container.covers.dir
    val check = remember(library) { library?.let(::ShelfCheck) }
    var editing by rememberSaveable { mutableStateOf<String?>(null) }
    var askClear by remember { mutableStateOf(false) }
    var shelving by remember { mutableStateOf(false) }
    fun change(edit: (Cart) -> Cart) {
        container.launch { container.cart.change(edit) }
    }
    // Until the shelf is known, nothing is said to be on it, and nothing is shelved.
    val toShelve = check?.toShelve(cart)?.size ?: 0

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(stringResource(R.string.cart_title)) },
                navigationIcon = { BackButton(onBack) },
                actions = {
                    if (cart.count > 0) {
                        IconButton(onClick = { askClear = true }, modifier = Modifier.testTag("cartClear")) {
                            Icon(Icons.Rounded.DeleteSweep, contentDescription = stringResource(R.string.cart_clear))
                        }
                    }
                },
            )
        },
        bottomBar = {
            if (toShelve > 0) {
                Surface(tonalElevation = 3.dp) {
                    Button(
                        onClick = {
                            shelving = true
                            container.launch { onShelved(container.shelveCart()) }
                        },
                        enabled = !shelving,
                        modifier = Modifier.fillMaxWidth().navigationBarsPadding().padding(16.dp).testTag("shelveCart"),
                    ) {
                        Text(pluralStringResource(R.plurals.cart_shelve, toShelve, toShelve))
                    }
                }
            }
        },
    ) { padding ->
        if (cart.count == 0) {
            Column(
                Modifier.fillMaxSize().padding(padding).padding(32.dp),
                verticalArrangement = Arrangement.Center,
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                Icon(CartIcon, contentDescription = null, tint = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.size(56.dp))
                Spacer(Modifier.height(16.dp))
                Text(stringResource(R.string.cart_empty), style = MaterialTheme.typography.bodyLarge, color = MaterialTheme.colorScheme.onSurfaceVariant, textAlign = TextAlign.Center, modifier = Modifier.testTag("cartEmpty"))
            }
            return@Scaffold
        }
        LazyColumn(Modifier.fillMaxSize().padding(padding).testTag("cartList"), contentPadding = PaddingValues(bottom = 24.dp)) {
            item(key = "forAll") {
                Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp)) {
                    Text(stringResource(R.string.cart_for_all), style = MaterialTheme.typography.titleMedium, color = MaterialTheme.colorScheme.primary)
                    Spacer(Modifier.height(8.dp))
                    CartSettingsEditor(cart.forAll, shelves, tag = "all") { edit -> change { it.forAll(edit) } }
                    Spacer(Modifier.height(12.dp))
                    Text(stringResource(R.string.cart_each_hint), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
            }
            items(cart.items, key = { it.key }) { item ->
                CartRow(
                    item = item,
                    settings = cart.settingsOf(item),
                    shelves = shelves,
                    cover = coverModelOf(coverDir, item.book),
                    here = check?.alreadyHere(item) == true,
                    onOpen = { editing = item.key },
                    onTakeOff = { change { it.takeOff(item.key) } },
                    onAnyway = { wanted -> change { it.anyway(item.key, wanted) } },
                )
                HorizontalDivider(Modifier.padding(start = 78.dp), color = MaterialTheme.colorScheme.outlineVariant)
            }
        }
    }

    editing?.let { key ->
        val item = cart.items.firstOrNull { it.key == key }
        if (item == null) {
            editing = null
        } else {
            ModalBottomSheet(onDismissRequest = { editing = null }, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)) {
                Column(
                    Modifier
                        .fillMaxWidth()
                        .verticalScroll(rememberScrollState())
                        .navigationBarsPadding()
                        .padding(start = 20.dp, end = 20.dp, bottom = 20.dp)
                        .testTag("cartOne"),
                ) {
                    Text(item.book.title, style = MaterialTheme.typography.titleLarge, maxLines = 3, overflow = TextOverflow.Ellipsis)
                    if (item.book.authors.isNotBlank()) Text(item.book.authors, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    Spacer(Modifier.height(12.dp))
                    CartSettingsEditor(cart.settingsOf(item), shelves, tag = "one") { edit -> change { it.forOne(key, edit) } }
                    Spacer(Modifier.height(12.dp))
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                        if (item.own != null) {
                            TextButton(onClick = { change { it.likeTheRest(key) } }, modifier = Modifier.testTag("likeTheRest")) { Text(stringResource(R.string.cart_like_rest)) }
                        }
                        TextButton(onClick = { editing = null }, modifier = Modifier.testTag("cartOneDone")) { Text(stringResource(R.string.action_ok)) }
                    }
                }
            }
        }
    }

    if (askClear) {
        AlertDialog(
            onDismissRequest = { askClear = false },
            title = { Text(stringResource(R.string.cart_clear_title)) },
            confirmButton = {
                TextButton(onClick = { askClear = false; change { it.emptied() } }, modifier = Modifier.testTag("cartClearConfirm")) { Text(stringResource(R.string.cart_clear)) }
            },
            dismissButton = { TextButton(onClick = { askClear = false }) { Text(stringResource(R.string.action_cancel)) } },
        )
    }
}

/** A book on the cart: what it is, how it will be shelved, whether it is on the shelf already. */
@Composable
private fun CartRow(
    item: CartItem,
    settings: CartSettings,
    shelves: List<Shelf>,
    cover: Any?,
    here: Boolean,
    onOpen: () -> Unit,
    onTakeOff: () -> Unit,
    onAnyway: (Boolean) -> Unit,
) {
    Row(
        Modifier
            .fillMaxWidth()
            .clickable(onClick = onOpen)
            .padding(start = 16.dp, end = 4.dp, top = 10.dp, bottom = 10.dp)
            .testTag("cartItem_${item.key}"),
        verticalAlignment = Alignment.Top,
    ) {
        BookCover(item.book.title, item.book.authors, cover, Modifier.width(48.dp), elevation = 2.dp)
        Spacer(Modifier.width(14.dp))
        Column(Modifier.weight(1f)) {
            Text(item.book.title, style = MaterialTheme.typography.titleMedium, maxLines = 2, overflow = TextOverflow.Ellipsis)
            if (item.book.authors.isNotBlank()) {
                Text(item.book.authors, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
            Spacer(Modifier.height(4.dp))
            // How it goes onto the shelf. A book set apart says so, so that a change for all that passes it by is no surprise.
            Row(verticalAlignment = Alignment.CenterVertically) {
                if (item.own != null) {
                    Icon(Icons.Rounded.Tune, contentDescription = stringResource(R.string.cart_own), tint = MaterialTheme.colorScheme.primary, modifier = Modifier.size(16.dp))
                    Spacer(Modifier.width(4.dp))
                }
                Text(
                    settingsLine(settings, shelves),
                    style = MaterialTheme.typography.labelMedium,
                    color = if (item.own != null) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.testTag("cartSettings_${item.key}"),
                )
            }
            if (here) {
                Spacer(Modifier.height(4.dp))
                Text(stringResource(R.string.cart_already_here), style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.tertiary, modifier = Modifier.testTag("alreadyHere_${item.key}"))
                Row(
                    Modifier.toggleable(value = item.anyway, role = Role.Checkbox, onValueChange = onAnyway).testTag("anyway_${item.key}"),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Checkbox(checked = item.anyway, onCheckedChange = null)
                    Text(stringResource(R.string.cart_anyway), style = MaterialTheme.typography.bodyMedium)
                }
            }
        }
        IconButton(onClick = onTakeOff, modifier = Modifier.testTag("takeOff_${item.key}")) {
            Icon(Icons.Rounded.Close, contentDescription = stringResource(R.string.cart_take_off))
        }
    }
}

/** "Read · Owned · Holiday", in a few words. */
@Composable
private fun settingsLine(settings: CartSettings, shelves: List<Shelf>): String =
    (listOf(stringResource(settings.status.labelRes()), stringResource(settings.ownership.labelRes())) + shelves.filter { it.id in settings.listIds }.map { it.name })
        .joinToString(" · ")

/** How books are shelved: the list, whose they are, and lists of the reader's own, as many as they like. */
@Composable
private fun CartSettingsEditor(settings: CartSettings, shelves: List<Shelf>, tag: String, onChange: ((CartSettings) -> CartSettings) -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Label(stringResource(R.string.edit_add_to))
        StatusChips(settings.status, tag = "${tag}_status") { status -> onChange { it.withStatus(status) } }
        Label(stringResource(R.string.book_section_ownership))
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Ownership.entries.forEach { ownership ->
                FilterChip(
                    selected = settings.ownership == ownership,
                    onClick = { onChange { it.withOwnership(ownership) } },
                    label = { Text(stringResource(ownership.labelRes())) },
                    modifier = Modifier.testTag("${tag}_own_${ownership.name}"),
                )
            }
        }
        if (shelves.isNotEmpty()) {
            Label(stringResource(R.string.book_section_lists))
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                shelves.forEach { shelf ->
                    FilterChip(
                        selected = shelf.id in settings.listIds,
                        onClick = { onChange { it.withList(shelf.id, shelf.id !in it.listIds) } },
                        label = { Text(shelf.name) },
                        modifier = Modifier.testTag("${tag}_list_${shelf.id}"),
                    )
                }
            }
        }
    }
}

@Composable
private fun Label(text: String) {
    Text(text, style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(top = 6.dp))
}
