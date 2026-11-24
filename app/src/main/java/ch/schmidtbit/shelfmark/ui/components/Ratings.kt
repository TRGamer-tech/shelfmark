package ch.schmidtbit.shelfmark.ui.components

import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.StarHalf
import androidx.compose.material.icons.rounded.Star
import androidx.compose.material.icons.rounded.StarBorder
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.addPathNodes
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.ProgressBarRangeInfo
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.progressBarRangeInfo
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.setProgress
import androidx.compose.ui.semantics.stateDescription
import kotlin.math.roundToInt
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.spring
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.composed
import androidx.compose.ui.graphics.graphicsLayer
import ch.schmidtbit.shelfmark.R
import ch.schmidtbit.shelfmark.ui.formatRating
import ch.schmidtbit.shelfmark.ui.theme.LocalShelfColors

/** What tapping star number [star] does to the current [rating]: whole, then half, then clear. */
fun nextRating(rating: Float, star: Int): Float = when (rating) {
    star.toFloat() -> star - 0.5f
    star - 0.5f -> 0f
    else -> star.toFloat()
}

/** The rating a screen reader asked for, on the half star steps there are. */
fun ratingFor(asked: Float): Float = ((asked.takeIf { it.isFinite() } ?: 0f).coerceIn(0f, 5f) * 2).roundToInt() / 2f

/**
 * One to five stars with half steps. Read-only when [onChange] is null.
 *
 * To a screen reader a bar that can be changed is one control with a value, which it reads
 * out and can set (as it does with a slider), and each star besides is a button that says
 * what tapping it gives. Nothing of that changes what is drawn or what a tap does.
 */
@Composable
fun RatingBar(
    rating: Float,
    modifier: Modifier = Modifier,
    starSize: Dp = 20.dp,
    onChange: ((Float) -> Unit)? = null,
) {
    val color = LocalShelfColors.current.star
    val empty = MaterialTheme.colorScheme.outline
    val description = stringResource(R.string.rating_description, formatRating(rating))
    val label = stringResource(R.string.book_section_rating)
    val adjust = if (onChange == null) {
        Modifier.semantics { contentDescription = description }
    } else {
        Modifier.testTag("ratingBar").semantics {
            contentDescription = label
            stateDescription = description
            progressBarRangeInfo = ProgressBarRangeInfo(rating.coerceIn(0f, 5f), 0f..5f, steps = 9)
            setProgress { asked -> onChange(ratingFor(asked)); true }
        }
    }
    Row(modifier.then(adjust), verticalAlignment = Alignment.CenterVertically) {
        for (star in 1..5) {
            val icon = when {
                rating >= star -> Icons.Rounded.Star
                rating >= star - 0.5f -> Icons.AutoMirrored.Rounded.StarHalf
                else -> Icons.Rounded.StarBorder
            }
            val tap = if (onChange != null) {
                // A tap gives the whole star, then the half one, then none: the button says which.
                val next = nextRating(rating, star)
                val says = if (next == 0f) stringResource(R.string.rating_clear) else stringResource(R.string.rating_set, formatRating(next))
                Modifier
                    .clickable(interactionSource = remember { MutableInteractionSource() }, indication = null, role = Role.Button) { onChange(next) }
                    .semantics { contentDescription = says }
                    .padding(4.dp)
                    .testTag("star$star")
            } else {
                Modifier
            }
            Icon(icon, contentDescription = null, tint = if (rating >= star - 0.5f) color else empty, modifier = tap.size(starSize).pop(rating >= star - 0.5f, onChange != null))
        }
    }
}

/** Spice level from one to five chillies. Tapping the current level clears it. */
@Composable
fun SpiceBar(
    level: Int,
    modifier: Modifier = Modifier,
    size: Dp = 20.dp,
    onChange: ((Int) -> Unit)? = null,
) {
    val hot = LocalShelfColors.current.spice
    val cold = MaterialTheme.colorScheme.outlineVariant
    val description = stringResource(R.string.spice_description, level)
    val label = stringResource(R.string.spice_label)
    val adjust = if (onChange == null) {
        Modifier.semantics { contentDescription = description }
    } else {
        // The same two ways in for a screen reader as the stars have.
        Modifier.testTag("spiceBar").semantics {
            contentDescription = label
            stateDescription = description
            progressBarRangeInfo = ProgressBarRangeInfo(level.coerceIn(0, 5).toFloat(), 0f..5f, steps = 4)
            setProgress { asked -> onChange((asked.takeIf { it.isFinite() } ?: 0f).roundToInt().coerceIn(0, 5)); true }
        }
    }
    Row(modifier.then(adjust), verticalAlignment = Alignment.CenterVertically) {
        for (i in 1..5) {
            val tap = if (onChange != null) {
                val next = if (level == i) 0 else i
                val says = if (next == 0) stringResource(R.string.spice_clear) else stringResource(R.string.spice_set, next)
                Modifier
                    .clickable(interactionSource = remember { MutableInteractionSource() }, indication = null, role = Role.Button) { onChange(next) }
                    .semantics { contentDescription = says }
                    .padding(4.dp)
                    .testTag("spice$i")
            } else {
                Modifier
            }
            Icon(ChilliIcon, contentDescription = null, tint = if (i <= level) hot else cold, modifier = tap.size(size).pop(i <= level, onChange != null))
        }
    }
}

/** A star or chilli that has just been given swells for a moment, like a stamp being pressed down. */
private fun Modifier.pop(on: Boolean, enabled: Boolean): Modifier = composed {
    if (!enabled || !LocalMotion.current) return@composed this
    val scale = remember { Animatable(1f) }
    var before by remember { mutableStateOf(on) }
    LaunchedEffect(on) {
        if (on && !before) {
            scale.snapTo(1.35f)
            scale.animateTo(1f, spring(dampingRatio = Spring.DampingRatioMediumBouncy, stiffness = Spring.StiffnessMedium))
        }
        before = on
    }
    graphicsLayer {
        scaleX = scale.value
        scaleY = scale.value
    }
}

/** A chilli pepper, since Material ships none. */
val ChilliIcon: ImageVector by lazy {
    ImageVector.Builder(name = "Chilli", defaultWidth = 24.dp, defaultHeight = 24.dp, viewportWidth = 24f, viewportHeight = 24f)
        .addPath(
            pathData = addPathNodes(
                // stalk
                "M15.6 2.4c1.5 0.5 2.6 1.6 3.1 3.1l-1.7 0.9c-0.3 -1 -1 -1.7 -2 -2.1z" +
                    // cap
                    "M12.9 6.3c1.9 -1.2 4.5 -0.8 5.9 0.9c0.5 0.6 0.3 1.1 -0.3 1.3c-2.2 0.6 -4.2 0.1 -5.8 -1.2c-0.4 -0.3 -0.3 -0.7 0.2 -1z" +
                    // body, curving down to the tip at the lower left
                    "M12.6 8.6c1.7 1.2 3.9 1.7 6.2 1.1c0.4 4.8 -3.1 9.4 -9.2 11.3c-2.1 0.7 -4.3 0.8 -6.1 0.4c-0.8 -0.2 -0.9 -1.1 -0.2 -1.5c4.6 -2.4 7.6 -6 9.3 -11.3z",
            ),
            fill = SolidColor(androidx.compose.ui.graphics.Color.Black),
        )
        .build()
}
