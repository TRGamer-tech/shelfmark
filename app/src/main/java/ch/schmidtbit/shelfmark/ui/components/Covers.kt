package ch.schmidtbit.shelfmark.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.layout.ContentScale
import ch.schmidtbit.shelfmark.ui.theme.Serif
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil3.compose.AsyncImage
import kotlin.math.absoluteValue

/** Cloth and leather tones for books that have no cover picture. */
private val BookColors = listOf(
    Color(0xFF1F4D46), Color(0xFF7B2D26), Color(0xFF2F3E5C), Color(0xFF8A6529),
    Color(0xFF4A3B52), Color(0xFF3F5D3A), Color(0xFFA6522F), Color(0xFF22475E),
    Color(0xFF6B4226), Color(0xFF5C2A44), Color(0xFF39524F), Color(0xFF8C7A3B),
)

/** Stable colour for a book, derived from its title so it never changes between launches. */
fun bookColor(seed: String): Color = BookColors[(seed.hashCode().absoluteValue) % BookColors.size]

fun contentColorOn(background: Color): Color =
    if (background.luminance() > 0.45f) Color(0xFF211D17) else Color(0xFFF8F1E1)

/**
 * A book's front. Shows the cover picture when there is one and it loads, otherwise
 * a drawn cloth cover with title and author, so every book looks like a book.
 */
@Composable
fun BookCover(
    title: String,
    authors: String,
    model: Any?,
    modifier: Modifier = Modifier,
    cornerRadius: Dp = 4.dp,
    elevation: Dp = 3.dp,
) {
    val shape = RoundedCornerShape(topStart = 2.dp, bottomStart = 2.dp, topEnd = cornerRadius, bottomEnd = cornerRadius)
    Box(
        modifier
            .aspectRatio(2f / 3f)
            .shadow(elevation, shape)
            .clip(shape),
    ) {
        GeneratedCover(title, authors, Modifier.fillMaxSize())
        if (model != null) {
            AsyncImage(
                model = model,
                contentDescription = null,
                contentScale = ContentScale.Crop,
                modifier = Modifier.fillMaxSize(),
            )
        }
        // The crease where the cover meets the spine.
        Box(
            Modifier
                .fillMaxHeight()
                .width(7.dp)
                .background(Brush.horizontalGradient(listOf(Color.Black.copy(alpha = 0.22f), Color.Transparent))),
        )
    }
}

@Composable
fun GeneratedCover(title: String, authors: String, modifier: Modifier = Modifier) {
    val base = remember(title) { bookColor(title) }
    val ink = remember(base) { contentColorOn(base) }
    Box(
        modifier.background(Brush.verticalGradient(listOf(base, lerpDark(base, 0.22f)))),
    ) {
        Box(
            Modifier
                .fillMaxSize()
                .padding(start = 9.dp, top = 6.dp, end = 6.dp, bottom = 6.dp)
                .border(1.dp, ink.copy(alpha = 0.35f), RoundedCornerShape(2.dp)),
        )
        Column(
            Modifier
                .fillMaxSize()
                .padding(start = 14.dp, top = 12.dp, end = 10.dp, bottom = 10.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Text(
                text = title,
                color = ink,
                fontFamily = Serif,
                fontWeight = FontWeight.Bold,
                fontSize = 12.sp,
                lineHeight = 14.sp,
                textAlign = TextAlign.Center,
                maxLines = 4,
                overflow = TextOverflow.Ellipsis,
            )
            Spacer(Modifier.height(4.dp))
            Box(Modifier.width(18.dp).height(1.dp).background(ink.copy(alpha = 0.5f)))
            Spacer(Modifier.weight(1f))
            if (authors.isNotBlank()) {
                Text(
                    text = authors,
                    color = ink.copy(alpha = 0.85f),
                    fontSize = 9.sp,
                    lineHeight = 11.sp,
                    textAlign = TextAlign.Center,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.fillMaxWidth(),
                )
            }
        }
    }
}

internal fun lerpDark(color: Color, amount: Float): Color = Color(
    red = color.red * (1 - amount),
    green = color.green * (1 - amount),
    blue = color.blue * (1 - amount),
    alpha = color.alpha,
)

internal fun lerpLight(color: Color, amount: Float): Color = Color(
    red = color.red + (1 - color.red) * amount,
    green = color.green + (1 - color.green) * amount,
    blue = color.blue + (1 - color.blue) * amount,
    alpha = color.alpha,
)
