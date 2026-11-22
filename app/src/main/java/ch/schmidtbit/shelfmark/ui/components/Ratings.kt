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
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import ch.schmidtbit.shelfmark.R
import ch.schmidtbit.shelfmark.ui.formatRating
import ch.schmidtbit.shelfmark.ui.theme.LocalShelfColors

/** What tapping star number [star] does to the current [rating]: whole, then half, then clear. */
fun nextRating(rating: Float, star: Int): Float = when (rating) {
    star.toFloat() -> star - 0.5f
    star - 0.5f -> 0f
    else -> star.toFloat()
}

/** One to five stars with half steps. Read-only when [onChange] is null. */
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
    Row(modifier.semantics { contentDescription = description }, verticalAlignment = Alignment.CenterVertically) {
        for (star in 1..5) {
            val icon = when {
                rating >= star -> Icons.Rounded.Star
                rating >= star - 0.5f -> Icons.AutoMirrored.Rounded.StarHalf
                else -> Icons.Rounded.StarBorder
            }
            val tap = if (onChange != null) {
                Modifier
                    .clickable(interactionSource = remember { MutableInteractionSource() }, indication = null) { onChange(nextRating(rating, star)) }
                    .padding(4.dp)
                    .testTag("star$star")
            } else {
                Modifier
            }
            Icon(icon, contentDescription = null, tint = if (rating >= star - 0.5f) color else empty, modifier = tap.size(starSize))
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
    Row(modifier.semantics { contentDescription = description }, verticalAlignment = Alignment.CenterVertically) {
        for (i in 1..5) {
            val tap = if (onChange != null) {
                Modifier
                    .clickable(interactionSource = remember { MutableInteractionSource() }, indication = null) { onChange(if (level == i) 0 else i) }
                    .padding(4.dp)
                    .testTag("spice$i")
            } else {
                Modifier
            }
            Icon(ChilliIcon, contentDescription = null, tint = if (i <= level) hot else cold, modifier = tap.size(size))
        }
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
