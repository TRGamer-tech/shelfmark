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
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.unit.dp

// How a book looks that is not in the reader's hands: lent to somebody, or given back
// before it was finished (the rule is Book.away). It is still on the shelf, because the
// shelf is the record of what the reader has to do with, but it stands there like the
// outline left where something used to be: see-through, with a dashed line around it.

/** How much of a book that is away is still seen. */
const val AWAY_ALPHA = 0.45f

/**
 * 1 for a book that is away, 0 for one that is here, and the way between while it changes:
 * a book that comes back fills in, it does not jump. Where nothing is to move, it jumps.
 */
@Composable
fun awayAmount(away: Boolean): State<Float> =
    animateFloatAsState(if (away) 1f else 0f, if (LocalMotion.current) tween(420) else snap(), label = "away")

/** The colour of the dashed line: the colour text has, which reads on the shelf, on a card and on a page, in a light theme and a dark one. */
@Composable
fun awayLine(): Color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.72f)

/** Lets what is behind show through, as far as [amount] says. */
fun Modifier.seeThrough(amount: () -> Float): Modifier = graphicsLayer { alpha = 1f - (1f - AWAY_ALPHA) * amount() }

/** A dashed line along [shape], as strong as [amount] says. It is drawn over the content and is not see-through itself. */
fun Modifier.dashedOutline(amount: () -> Float, shape: Shape, color: Color): Modifier = drawWithContent {
    drawContent()
    val strength = amount()
    if (strength > 0f) {
        val width = 1.5.dp.toPx()
        // Half a line's width in from the edge, so that none of it is cut off.
        inset(width / 2) {
            drawOutline(
                shape.createOutline(size, layoutDirection, this),
                color = color.copy(alpha = color.alpha * strength),
                style = Stroke(width, pathEffect = PathEffect.dashPathEffect(floatArrayOf(5.dp.toPx(), 3.5.dp.toPx()))),
            )
        }
    }
}

/**
 * Draws a spine or a cover as away when [words] says why ("Lent to Bo"), and as usual when
 * it is null. A screen reader hears the words, since it sees neither the line nor through
 * anything.
 */
@Composable
fun Modifier.away(words: String?, shape: Shape): Modifier {
    val amount = awayAmount(words != null)
    return this
        .then(if (words != null) Modifier.semantics { stateDescription = words } else Modifier)
        .dashedOutline({ amount.value }, shape, awayLine())
        .seeThrough { amount.value }
}
