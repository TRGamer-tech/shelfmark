package ch.schmidtbit.shelfmark.ui.components

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.snap
import androidx.compose.animation.core.tween
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.State
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.graphics.drawOutline
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.inset
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

// How a book looks that is not in the reader's hands: lent to somebody, or given back
// before it was finished (the rule is Book.away). It is still on the shelf, because the
// shelf is the record of what the reader has to do with, but it stands there like the
// outline left where something used to be: a dashed line where the book belongs, and the
// book itself see-through and a little smaller within it. The website draws it the same way.

/** How much of a book that is away is still seen. The website uses the same number. */
const val AWAY_ALPHA = 0.45f

/** How long a book takes to fade from here to away or back, as long as on the website. */
private const val AWAY_FADE_MS = 400

/**
 * 1 for a book that is away, 0 for one that is here, and the way between while it changes:
 * a book that comes back fills in, it does not jump. Where nothing is to move, it jumps.
 */
@Composable
fun awayAmount(away: Boolean): State<Float> =
    animateFloatAsState(if (away) 1f else 0f, if (LocalMotion.current) tween(AWAY_FADE_MS) else snap(), label = "away")

/**
 * The colour of the dashed line. It is the colour of quiet text, which every theme makes
 * readable on its shelf, its cards and its pages, light or dark, the reader's own included.
 */
@Composable
fun awayLine(): Color = MaterialTheme.colorScheme.onSurfaceVariant

/** Lets what is behind show through, as far as [amount] says. */
fun Modifier.seeThrough(amount: () -> Float): Modifier = graphicsLayer { alpha = 1f - (1f - AWAY_ALPHA) * amount() }

/**
 * A dashed line along [shape], as strong as [amount] says, [inset] inside the edge. It is
 * drawn over the content and is not see-through itself.
 */
fun Modifier.dashedOutline(amount: () -> Float, shape: Shape, color: Color, inset: Dp = 0.dp): Modifier = drawWithContent {
    drawContent()
    val strength = amount()
    if (strength > 0f) {
        val width = 1.5.dp.toPx()
        // Half a line's width in from the edge, so that none of it is cut off.
        inset(inset.toPx() + width / 2) {
            drawOutline(
                shape.createOutline(size, layoutDirection, this),
                color = color.copy(alpha = color.alpha * strength),
                style = Stroke(width, pathEffect = PathEffect.dashPathEffect(floatArrayOf(5.dp.toPx(), 3.5.dp.toPx()))),
            )
        }
    }
}

/**
 * The book inside its outline: see-through, and a little smaller than its place, so that
 * the dashes run around it and not over its picture.
 */
private fun Modifier.standsBack(amount: () -> Float): Modifier = graphicsLayer {
    val strength = amount()
    if (strength > 0f && size.width > 0f && size.height > 0f) {
        // About 3 dp on every side, less for a book the size of a thumbnail.
        val gap = minOf(3.dp.toPx(), 0.07f * minOf(size.width, size.height)) * strength
        scaleX = (size.width - 2 * gap) / size.width
        scaleY = (size.height - 2 * gap) / size.height
    }
    alpha = 1f - (1f - AWAY_ALPHA) * strength
}

/**
 * Draws a spine or a cover as away when [away] is set, and as usual otherwise. Only the
 * look: what a screen reader hears is up to the place that knows whether the words are
 * shown next to the book.
 */
@Composable
fun Modifier.awayLook(away: Boolean, shape: Shape): Modifier {
    val amount = awayAmount(away)
    return this
        .dashedOutline({ amount.value }, shape, awayLine())
        .standsBack { amount.value }
}
