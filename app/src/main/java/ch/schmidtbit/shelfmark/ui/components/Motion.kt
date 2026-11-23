package ch.schmidtbit.shelfmark.ui.components

import android.provider.Settings
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.LocalIndication
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.runtime.withFrameNanos
import androidx.compose.ui.Modifier
import androidx.compose.ui.composed
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import ch.schmidtbit.shelfmark.ui.theme.LocalShelfColors
import kotlinx.coroutines.delay
import kotlin.math.PI
import kotlin.math.sin

/**
 * Whether gentle movement is wanted. It is the user's choice in the settings, and it is
 * off on phones where animations are switched off altogether.
 */
val LocalMotion = staticCompositionLocalOf { true }

/**
 * Seconds that keep running while a lively screen is shown, zero and standing still
 * everywhere else. Read it while drawing, not while composing: then a flickering candle
 * redraws one small picture and nothing else.
 */
val LocalShelfTime = staticCompositionLocalOf<() -> Float> { { 0f } }

/** True for the first moments after a shelf appears, when the books are still finding their place. */
val LocalSettling = staticCompositionLocalOf { false }

/** True when the phone has animations switched off in its settings (or the developer options). */
@Composable
fun systemAnimationsOff(): Boolean {
    val resolver = LocalContext.current.contentResolver
    return remember(resolver) { Settings.Global.getFloat(resolver, Settings.Global.ANIMATOR_DURATION_SCALE, 1f) == 0f }
}

/** Everything inside can move: the clock for flames and dust runs here, and only while this is on screen. */
@Composable
fun LivelyScope(content: @Composable () -> Unit) {
    val motion = LocalMotion.current
    val seconds = remember { mutableFloatStateOf(0f) }
    val settling = remember { mutableFloatStateOf(if (motion) 1f else 0f) }
    if (motion) {
        LaunchedEffect(Unit) {
            val start = withFrameNanos { it }
            while (true) withFrameNanos { seconds.floatValue = (it - start) / 1_000_000_000f }
        }
        LaunchedEffect(Unit) {
            delay(SETTLE_WINDOW_MS)
            settling.floatValue = 0f
        }
    }
    CompositionLocalProvider(
        LocalShelfTime provides { seconds.floatValue },
        LocalSettling provides (settling.floatValue > 0f),
        content = content,
    )
}

private const val SETTLE_WINDOW_MS = 700L

/**
 * A book taking its place: it comes down the last bit and fades in, each one a moment after
 * its neighbour. Only books that are there when the shelf appears do this, not the ones
 * scrolled to later.
 */
fun Modifier.settleIn(index: Int): Modifier = composed {
    if (!LocalMotion.current || !LocalSettling.current) return@composed this
    val progress = remember { Animatable(0f) }
    LaunchedEffect(Unit) {
        delay(30L * index.coerceAtMost(14))
        progress.animateTo(1f, tween(340, easing = FastOutSlowInEasing))
    }
    graphicsLayer {
        alpha = progress.value
        translationY = -(1f - progress.value) * 14.dp.toPx()
    }
}

/** A book that can be taken out: it rises a little under the finger and springs back. */
fun Modifier.bookPress(onClick: () -> Unit): Modifier = composed {
    val source = remember { MutableInteractionSource() }
    val pressed by source.collectIsPressedAsState()
    val lift by animateFloatAsState(
        targetValue = if (pressed && LocalMotion.current) 1f else 0f,
        animationSpec = spring(dampingRatio = Spring.DampingRatioMediumBouncy, stiffness = Spring.StiffnessMedium),
        label = "lift",
    )
    graphicsLayer {
        translationY = -lift * 7.dp.toPx()
        scaleX = 1f + lift * 0.03f
        scaleY = 1f + lift * 0.03f
    }.clickable(interactionSource = source, indication = LocalIndication.current, onClick = onClick)
}

/** A progress bar that fills up to its value instead of just being there. */
@Composable
fun AnimatedProgress(progress: Float, modifier: Modifier = Modifier) {
    val motion = LocalMotion.current
    val shown = remember { Animatable(if (motion) 0f else progress) }
    LaunchedEffect(progress, motion) {
        if (motion) shown.animateTo(progress, tween(700, easing = FastOutSlowInEasing)) else shown.snapTo(progress)
    }
    LinearProgressIndicator(progress = { shown.value }, modifier = modifier)
}

/**
 * The light of a reading lamp falling on the shelf from above. With movement switched on
 * it breathes very slightly and a few specks of dust drift through it.
 */
@Composable
fun LampLight(modifier: Modifier = Modifier) {
    val warm = LocalShelfColors.current.star
    val motion = LocalMotion.current
    val time = LocalShelfTime.current
    Canvas(modifier) {
        val t = if (motion) time() else 0f
        val breath = if (motion) 0.5f + 0.5f * sin(t * 2f * PI.toFloat() / 9f) else 0.5f
        drawRect(
            Brush.radialGradient(
                colors = listOf(warm.copy(alpha = 0.13f + 0.03f * breath), warm.copy(alpha = 0.05f), Color.Transparent),
                center = Offset(size.width * 0.5f, -size.width * 0.12f),
                radius = size.width * 1.05f,
            ),
        )
    }
}

@Composable
fun DustMotes(modifier: Modifier = Modifier) {
    if (!LocalMotion.current) return
    val warm = LocalShelfColors.current.star
    val time = LocalShelfTime.current
    Canvas(modifier) {
        val t = time()
        // Where the light is: a cone below the lamp. Outside of it dust is not seen.
        val reach = size.width * 0.9f
        repeat(MOTES) { i ->
            val seed = i * 0.618034f
            val x0 = (seed * 7.13f) % 1f
            val y0 = (seed * 3.71f) % 1f
            val speed = 0.006f + ((seed * 5.3f) % 1f) * 0.010f
            val x = (x0 + 0.035f * sin(t * (0.11f + 0.05f * (i % 3)) + i * 1.3f)) * size.width
            // Drifting upwards, as dust does over a warm lamp, and starting over below.
            val y = (((y0 - t * speed) % 1f) + 1f) % 1f * reach
            val distance = (Offset(x, y) - Offset(size.width * 0.5f, 0f)).getDistance() / reach
            val light = (1f - distance).coerceIn(0f, 1f)
            val twinkle = 0.55f + 0.45f * sin(t * (0.5f + 0.13f * (i % 5)) + i * 2.1f)
            drawCircle(warm.copy(alpha = 0.34f * light * twinkle), radius = (0.9f + (i % 3) * 0.55f).dp.toPx(), center = Offset(x, y))
        }
    }
}

private const val MOTES = 16
