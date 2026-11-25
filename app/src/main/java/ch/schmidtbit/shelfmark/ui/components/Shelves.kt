package ch.schmidtbit.shelfmark.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.KeyboardArrowRight
import androidx.compose.material.icons.rounded.LocalFlorist
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.ui.res.stringResource
import ch.schmidtbit.shelfmark.R
import ch.schmidtbit.shelfmark.data.model.OrnamentKind
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.TransformOrigin
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.layout
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import ch.schmidtbit.shelfmark.ui.theme.Serif
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Constraints
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import ch.schmidtbit.shelfmark.data.model.BookFormat
import ch.schmidtbit.shelfmark.ui.theme.LocalShelfColors
import kotlin.math.absoluteValue

/** Anything that can stand on a shelf: one of my books or a friend's. */
data class ShelfItem(
    val key: Long,
    val title: String,
    val authors: String,
    val cover: Any?,
    val pageCount: Int = 0,
    val format: BookFormat = BookFormat.UNKNOWN,
    /** Small coloured ribbon, e.g. for "currently reading" or "available to borrow". */
    val ribbon: Color? = null,
    /** Why the book is away, in words ("Lent to Bo"), or null for a book that is here. */
    val away: String? = null,
)

/** The wooden board a row of books stands on, with the shadow it throws on the wall below. */
@Composable
fun ShelfBoard(modifier: Modifier = Modifier) {
    val c = LocalShelfColors.current
    Column(modifier.fillMaxWidth()) {
        Box(
            Modifier
                .fillMaxWidth()
                .height(15.dp)
                .drawBehind {
                    val top = size.height * 0.42f
                    drawRect(Brush.verticalGradient(listOf(c.woodLight, c.wood), endY = top), size = Size(size.width, top))
                    drawRect(
                        Brush.verticalGradient(listOf(c.wood, c.woodDark), startY = top, endY = size.height),
                        topLeft = Offset(0f, top),
                        size = Size(size.width, size.height - top),
                    )
                    drawLine(Color.White.copy(alpha = 0.28f), Offset(0f, top), Offset(size.width, top), strokeWidth = 1.dp.toPx())
                    // Grain: a few long, uneven lines in the front edge of the board.
                    val grain = c.woodDark.copy(alpha = 0.22f)
                    var x = -size.width * 0.1f
                    var n = 0
                    while (x < size.width) {
                        val length = size.width * (0.18f + 0.11f * (n % 4))
                        val y = top + (size.height - top) * (0.25f + 0.22f * (n % 3))
                        // Kept inside the board: nothing is clipped here, and a short board has close ends.
                        drawLine(grain, Offset(x.coerceAtLeast(0f), y), Offset((x + length).coerceAtMost(size.width), y + 0.6.dp.toPx()), strokeWidth = 0.8.dp.toPx())
                        x += length * 0.72f
                        n++
                    }
                },
        )
        Box(
            Modifier
                .fillMaxWidth()
                .height(9.dp)
                .background(Brush.verticalGradient(listOf(Color.Black.copy(alpha = 0.20f), Color.Transparent))),
        )
    }
}

@Composable
fun ShelfRow(
    modifier: Modifier = Modifier,
    spacing: Dp = 12.dp,
    content: @Composable RowScope.() -> Unit,
) {
    val back = LocalShelfColors.current.shelfBack
    Column(modifier.fillMaxWidth()) {
        Row(
            Modifier
                .fillMaxWidth()
                .background(Brush.verticalGradient(listOf(Color.Transparent, back)))
                .drawBehind {
                    // The corner where the back wall meets the board is the darkest place of a shelf.
                    val depth = 16.dp.toPx()
                    drawRect(
                        Brush.verticalGradient(listOf(Color.Transparent, Color.Black.copy(alpha = 0.16f)), startY = size.height - depth, endY = size.height),
                        topLeft = Offset(0f, size.height - depth),
                        size = Size(size.width, depth),
                    )
                }
                .padding(start = 16.dp, end = 16.dp, top = 14.dp),
            horizontalArrangement = Arrangement.spacedBy(spacing),
            verticalAlignment = Alignment.Bottom,
            content = content,
        )
        ShelfBoard()
    }
}

/** A run of books under one heading, e.g. everything on the "Reading" list. */
data class ShelfSection(
    val key: String,
    val items: List<ShelfItem>,
    /** Heading above the shelf, or null for a shelf without one. */
    val title: String? = null,
    /** Opens just this list when the heading is tapped. */
    val onOpen: (() -> Unit)? = null,
    /** Ornaments on this shelf, each standing after the given number of books. Only the spine view shows them. */
    val ornaments: List<Pair<Int, OrnamentKind>> = emptyList(),
    /** Opens the dialog for choosing ornaments. */
    val onDecorate: (() -> Unit)? = null,
    /** Shown on the bare board when the shelf has nothing on it. Without it an empty shelf is not drawn at all. */
    val emptyHint: String? = null,
)

/** A shelf with nothing on it yet: the board is there, and a few words say what it is waiting for. */
@Composable
private fun EmptyShelf(hint: String, sectionKey: String) {
    ShelfRow {
        Box(Modifier.fillMaxWidth().height(96.dp).testTag("emptyShelf_$sectionKey"), contentAlignment = Alignment.Center) {
            Text(hint, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, textAlign = TextAlign.Center)
        }
    }
}

/** A spine or an ornament: the two kinds of thing that stand on a shelf in the spine view. */
internal sealed interface ShelfThing {
    val width: Float

    data class Spine(val item: ShelfItem) : ShelfThing {
        override val width get() = spineWidth(item.pageCount)
    }

    data class Deco(val kind: OrnamentKind) : ShelfThing {
        override val width get() = ornamentSize(kind).first
    }
}

/** Puts every ornament behind the book it follows. Ornaments beyond the last book end up at the end. */
internal fun arrange(itemCount: Int, ornaments: List<Pair<Int, OrnamentKind>>): List<Pair<Boolean, Int>> {
    val out = ArrayList<Pair<Boolean, Int>>()
    val sorted = ornaments.withIndex().sortedBy { it.value.first }
    var next = 0
    for (i in 0..itemCount) {
        while (next < sorted.size && (sorted[next].value.first <= i || i == itemCount)) {
            out += false to sorted[next].index
            next++
        }
        if (i < itemCount) out += true to i
    }
    return out
}

@Composable
private fun ShelfHeading(section: ShelfSection, decorate: Boolean = false) {
    val title = section.title ?: return
    Row(
        Modifier
            .fillMaxWidth()
            .then(if (section.onOpen != null) Modifier.clickable(onClick = section.onOpen) else Modifier)
            .padding(start = 16.dp, end = 12.dp, top = 14.dp, bottom = 2.dp)
            .testTag("shelf_${section.key}"),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(title, style = MaterialTheme.typography.titleLarge)
        Text(
            section.items.size.toString(),
            style = MaterialTheme.typography.labelLarge,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier
                .padding(start = 10.dp)
                .clip(RoundedCornerShape(50))
                .background(MaterialTheme.colorScheme.surfaceContainerHighest)
                .padding(horizontal = 9.dp, vertical = 2.dp),
        )
        if (section.onOpen != null) {
            Icon(Icons.AutoMirrored.Rounded.KeyboardArrowRight, contentDescription = null, tint = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        if (decorate && section.onDecorate != null) {
            Spacer(Modifier.weight(1f))
            IconButton(onClick = section.onDecorate, modifier = Modifier.testTag("decorate_${section.key}")) {
                Icon(Icons.Rounded.LocalFlorist, contentDescription = stringResource(R.string.ornament_title), tint = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
    }
}

/** Books standing face out on shelf boards, one group of shelves per section. */
@Composable
fun CoverShelf(
    sections: List<ShelfSection>,
    onClick: (ShelfItem) -> Unit,
    modifier: Modifier = Modifier,
    contentPadding: PaddingValues = PaddingValues(),
    header: (@Composable () -> Unit)? = null,
) {
    BoxWithConstraints(modifier.fillMaxSize()) {
        val columns = (maxWidth / 112.dp).toInt().coerceIn(3, 8)
        val prepared = remember(sections, columns) { sections.map { it to it.items.chunked(columns) } }
        LazyColumn(contentPadding = contentPadding, modifier = Modifier.fillMaxSize().testTag("coverShelf")) {
            if (header != null) item(key = "header") { header() }
            prepared.forEach { (section, rows) ->
                if (section.title != null) item(key = "heading_${section.key}") { ShelfHeading(section) }
                if (rows.isEmpty() && section.emptyHint != null) item(key = "empty_${section.key}") { EmptyShelf(section.emptyHint, section.key) }
                items(rows.size, key = { "${section.key}_${rows[it].first().key}" }) { index ->
                    val row = rows[index]
                    ShelfRow {
                        row.forEachIndexed { column, item ->
                            Box(Modifier.weight(1f).settleIn(index * 2 + column)) {
                                BookCover(
                                    title = item.title,
                                    authors = item.authors,
                                    model = item.cover,
                                    modifier = Modifier
                                        .fillMaxWidth()
                                        .bookPress { onClick(item) }
                                        .semantics { contentDescription = item.title },
                                    away = item.away,
                                )
                                item.ribbon?.let { Ribbon(it, Modifier.align(Alignment.TopEnd).padding(end = 8.dp)) }
                            }
                        }
                        repeat(columns - row.size) { Spacer(Modifier.weight(1f)) }
                    }
                }
            }
        }
    }
}

@Composable
private fun Ribbon(color: Color, modifier: Modifier = Modifier) {
    Box(
        modifier
            .width(10.dp)
            .height(22.dp)
            .clip(RoundedCornerShape(bottomStart = 5.dp, bottomEnd = 5.dp))
            .background(color),
    )
}

/** Width of a spine in dp. Thick books get thick spines. */
internal fun spineWidth(pageCount: Int): Float =
    if (pageCount <= 0) 34f else 24f + pageCount.coerceIn(60, 1000) / 1000f * 36f

/** Height of a spine in dp, varied a little per title so the row looks like a real shelf. */
internal fun spineHeight(title: String, format: BookFormat): Float =
    146f + (title.hashCode().absoluteValue % 5) * 6f + if (format == BookFormat.HARDCOVER) 12f else 0f

/** Breaks a run of widths into rows that each fit [maxWidth]. Returns index ranges. */
internal fun packRows(widths: List<Float>, maxWidth: Float, gap: Float): List<IntRange> {
    val rows = mutableListOf<IntRange>()
    var start = 0
    var used = 0f
    widths.forEachIndexed { i, w ->
        val needed = if (i == start) w else used + gap + w
        if (i > start && needed > maxWidth) {
            rows += start until i
            start = i
            used = w
        } else {
            used = needed
        }
    }
    if (widths.isNotEmpty()) rows += start until widths.size
    return rows
}

/** How the last book of a row leans: by how many degrees, and how far its foot stands from the neighbour. */
internal data class Lean(val angle: Float, val offset: Float)

/**
 * Decides whether the last book of a row leans. It does whenever the shelf is not full and
 * there is a neighbour to lean on, as on a real shelf, where the last book never stands by
 * itself. (An ornament behind it holds the row up, a bookend for instance.) The angle
 * differs from shelf to shelf. The foot of the book stands just far enough out that its
 * edge touches the neighbour.
 */
internal fun leanOf(sectionKey: String, rowIndex: Int, row: List<ShelfThing>, available: Float): Lean? {
    val last = row.lastOrNull() as? ShelfThing.Spine ?: return null
    val neighbour = row.getOrNull(row.size - 2) as? ShelfThing.Spine ?: return null
    val mood = ((sectionKey.hashCode() * 31 + rowIndex) and 0x7fffffff)
    val angle = 5f + (mood % 5)
    val radians = Math.toRadians(angle.toDouble())
    val height = spineHeight(last.item.title, last.item.format)
    val neighbourHeight = spineHeight(neighbour.item.title, neighbour.item.format)
    // Against a taller neighbour the top corner touches, against a shorter one the edge rests on its corner.
    val offset = minOf(height * Math.sin(radians), neighbourHeight * Math.tan(radians)).toFloat()
    val used = row.sumOf { it.width.toDouble() }.toFloat() + 2f * (row.size - 1)
    return if (available - used >= offset + 2f) Lean(angle, offset) else null
}

/** Books standing spine out, the way they do on a real shelf. Needs no cover pictures at all. */
@Composable
fun SpineShelf(
    sections: List<ShelfSection>,
    onClick: (ShelfItem) -> Unit,
    modifier: Modifier = Modifier,
    contentPadding: PaddingValues = PaddingValues(),
    header: (@Composable () -> Unit)? = null,
) {
    BoxWithConstraints(modifier.fillMaxSize()) {
        val available = maxWidth.value - 32f
        val prepared = remember(sections, available) {
            sections.map { section ->
                val things = arrange(section.items.size, section.ornaments).map { (isBook, index) ->
                    if (isBook) ShelfThing.Spine(section.items[index]) else ShelfThing.Deco(section.ornaments[index].second)
                }
                Triple(section, things, packRows(things.map { it.width }, available, gap = 2f))
            }
        }
        LazyColumn(contentPadding = contentPadding, modifier = Modifier.fillMaxSize().testTag("spineShelf")) {
            if (header != null) item(key = "header") { header() }
            prepared.forEach { (section, things, rows) ->
                if (section.title != null) item(key = "heading_${section.key}") { ShelfHeading(section, decorate = true) }
                if (rows.isEmpty() && section.emptyHint != null) item(key = "empty_${section.key}") { EmptyShelf(section.emptyHint, section.key) }
                items(rows.size, key = { "${section.key}_row$it" }) { index ->
                    val row = rows[index]
                    val lean = remember(section.key, index, things, available) { leanOf(section.key, index, row.map { things[it] }, available) }
                    ShelfRow(spacing = 2.dp) {
                        for (i in row) {
                            val place = Modifier.settleIn(index * 3 + (i - row.first))
                            when (val thing = things[i]) {
                                is ShelfThing.Spine ->
                                    if (lean != null && i == row.last) {
                                        // The last book of a shelf that is not full leans on its neighbour.
                                        Box(place.padding(start = lean.offset.dp)) {
                                            Spine(
                                                thing.item,
                                                Modifier
                                                    .graphicsLayer {
                                                        rotationZ = -lean.angle
                                                        transformOrigin = TransformOrigin(0f, 1f)
                                                    }
                                                    .bookPress { onClick(thing.item) }
                                                    .testTag("leaning"),
                                            )
                                        }
                                    } else {
                                        Spine(thing.item, place.bookPress { onClick(thing.item) })
                                    }
                                is ShelfThing.Deco -> {
                                    val name = stringResource(thing.kind.labelRes())
                                    OrnamentView(thing.kind, place.semantics { contentDescription = name })
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun Spine(item: ShelfItem, modifier: Modifier = Modifier) {
    val base = remember(item.title) { bookColor(item.title) }
    val ink = remember(base) { contentColorOn(base) }
    val width = spineWidth(item.pageCount).dp
    val height = spineHeight(item.title, item.format).dp
    val shape = RoundedCornerShape(topStart = 3.dp, topEnd = 3.dp)
    Box(
        modifier
            .away(item.away, shape)
            .width(width)
            .height(height)
            .clip(shape)
            // Lighter in the middle, darker at the edges: the spine is rounded.
            .background(Brush.horizontalGradient(listOf(lerpDark(base, 0.28f), lerpLight(base, 0.10f), lerpDark(base, 0.22f))))
            .semantics { contentDescription = item.title },
    ) {
        Box(Modifier.fillMaxWidth().padding(top = 9.dp).height(2.dp).background(ink.copy(alpha = 0.45f)))
        Box(Modifier.fillMaxWidth().padding(top = 13.dp).height(1.dp).background(ink.copy(alpha = 0.30f)))
        Box(Modifier.align(Alignment.BottomCenter).fillMaxWidth().padding(bottom = 10.dp).height(2.dp).background(ink.copy(alpha = 0.45f)))
        Text(
            text = item.title,
            color = ink,
            fontFamily = Serif,
            fontWeight = FontWeight.SemiBold,
            fontSize = 11.sp,
            lineHeight = 13.sp,
            maxLines = if (width >= 44.dp) 2 else 1,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier
                .align(Alignment.Center)
                .padding(vertical = 20.dp)
                .vertical(),
        )
        item.ribbon?.let {
            Box(Modifier.align(Alignment.TopCenter).size(width = 8.dp, height = 16.dp).clip(RoundedCornerShape(bottomStart = 4.dp, bottomEnd = 4.dp)).background(it))
        }
    }
}

/** Lays the content out rotated by 90 degrees so text runs down the spine. */
private fun Modifier.vertical(): Modifier = layout { measurable, constraints ->
    val placeable = measurable.measure(
        Constraints(
            minWidth = constraints.minHeight,
            maxWidth = constraints.maxHeight,
            minHeight = constraints.minWidth,
            maxHeight = constraints.maxWidth,
        ),
    )
    layout(placeable.height, placeable.width) {
        placeable.placeWithLayer(
            x = -(placeable.width / 2 - placeable.height / 2),
            y = -(placeable.height / 2 - placeable.width / 2),
        ) { rotationZ = 90f }
    }
}

@Composable
fun SectionTitle(text: String, modifier: Modifier = Modifier) {
    Text(
        text = text,
        style = MaterialTheme.typography.titleMedium,
        color = MaterialTheme.colorScheme.primary,
        modifier = modifier.padding(horizontal = 16.dp, vertical = 8.dp),
    )
}
