package ch.schmidtbit.shelfmark.ui.components

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import kotlin.math.cos
import kotlin.math.sin
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.rotate
import androidx.compose.ui.unit.dp
import ch.schmidtbit.shelfmark.R
import ch.schmidtbit.shelfmark.data.model.OrnamentKind

/** Width and height of an ornament in dp. They are sized to sit among book spines. */
fun ornamentSize(kind: OrnamentKind): Pair<Float, Float> = when (kind) {
    OrnamentKind.PLANT -> 46f to 78f
    OrnamentKind.CACTUS -> 36f to 68f
    OrnamentKind.CANDLE -> 22f to 58f
    OrnamentKind.MUG -> 42f to 40f
    OrnamentKind.VASE -> 36f to 84f
    OrnamentKind.LAMP -> 48f to 92f
    OrnamentKind.GLOBE -> 46f to 70f
    OrnamentKind.CLOCK -> 44f to 50f
    OrnamentKind.TROPHY -> 42f to 72f
    OrnamentKind.FRAME -> 50f to 62f
    OrnamentKind.PUMPKIN -> 52f to 42f
    OrnamentKind.BOOKEND -> 28f to 74f
    OrnamentKind.CAT -> 74f to 40f
    OrnamentKind.BOOKSTACK -> 64f to 44f
}

private val Terracotta = Color(0xFFB5623C)
private val TerracottaDark = Color(0xFF8E4A2B)
private val Leaf = Color(0xFF4F8A4B)
private val LeafDark = Color(0xFF37683A)
private val Gold = Color(0xFFD9A93B)
private val GoldDark = Color(0xFFA9781C)
private val Cream = Color(0xFFF1E7D2)
private val Metal = Color(0xFF6F7682)
private val MetalDark = Color(0xFF4A505A)
private val Sea = Color(0xFF3F7FB5)
private val Wood = Color(0xFF7A5230)

/** A small drawn object. All twelve are plain shapes drawn in code, so they scale and need no pictures. */
fun OrnamentKind.labelRes(): Int = when (this) {
    OrnamentKind.PLANT -> R.string.ornament_plant
    OrnamentKind.CACTUS -> R.string.ornament_cactus
    OrnamentKind.CANDLE -> R.string.ornament_candle
    OrnamentKind.MUG -> R.string.ornament_mug
    OrnamentKind.VASE -> R.string.ornament_vase
    OrnamentKind.LAMP -> R.string.ornament_lamp
    OrnamentKind.GLOBE -> R.string.ornament_globe
    OrnamentKind.CLOCK -> R.string.ornament_clock
    OrnamentKind.TROPHY -> R.string.ornament_trophy
    OrnamentKind.FRAME -> R.string.ornament_frame
    OrnamentKind.PUMPKIN -> R.string.ornament_pumpkin
    OrnamentKind.BOOKEND -> R.string.ornament_bookend
    OrnamentKind.CAT -> R.string.ornament_cat
    OrnamentKind.BOOKSTACK -> R.string.ornament_bookstack
}

/**
 * Draws an ornament. Some of them are alive when movement is switched on: the candle
 * flickers, the tea steams, leaves stir, the cat breathes, and the clock tells the time.
 */
@Composable
fun OrnamentView(kind: OrnamentKind, modifier: Modifier = Modifier, scale: Float = 1f) {
    val (width, height) = ornamentSize(kind)
    val motion = LocalMotion.current
    val time = LocalShelfTime.current
    Canvas(modifier.size((width * scale).dp, (height * scale).dp)) {
        // Read here, while drawing: a moving ornament repaints itself and nothing around it.
        val t = if (motion) time() else 0f
        when (kind) {
            OrnamentKind.PLANT -> plant(t)
            OrnamentKind.CACTUS -> cactus()
            OrnamentKind.CANDLE -> candle(t, motion)
            OrnamentKind.MUG -> mug(t, motion)
            OrnamentKind.VASE -> vase()
            OrnamentKind.LAMP -> lamp(t)
            OrnamentKind.GLOBE -> globe()
            OrnamentKind.CLOCK -> clock(motion)
            OrnamentKind.TROPHY -> trophy()
            OrnamentKind.FRAME -> frame()
            OrnamentKind.PUMPKIN -> pumpkin()
            OrnamentKind.BOOKEND -> bookend()
            OrnamentKind.CAT -> cat(t)
            OrnamentKind.BOOKSTACK -> bookstack()
        }
    }
}

private fun DrawScope.pot(top: Float) {
    val w = size.width
    val h = size.height
    val path = Path().apply {
        moveTo(w * 0.16f, top)
        lineTo(w * 0.84f, top)
        lineTo(w * 0.72f, h)
        lineTo(w * 0.28f, h)
        close()
    }
    drawPath(path, Terracotta)
    drawRect(TerracottaDark, Offset(w * 0.12f, top - h * 0.04f), Size(w * 0.76f, h * 0.07f))
}

private fun DrawScope.plant(t: Float = 0f) {
    val w = size.width
    val h = size.height
    listOf(-38f to LeafDark, 34f to LeafDark, -14f to Leaf, 16f to Leaf, 0f to Leaf).forEachIndexed { index, (angle, color) ->
        // A draught nobody else notices: every leaf moves a little, each in its own time.
        val sway = 1.8f * sin(t * (0.55f + 0.09f * index) + index * 1.7f)
        rotate(angle + sway, Offset(w / 2, h * 0.66f)) {
            drawOval(color, Offset(w * 0.36f, h * 0.06f), Size(w * 0.28f, h * 0.62f))
        }
    }
    pot(h * 0.68f)
}

private fun DrawScope.cactus() {
    val w = size.width
    val h = size.height
    val round = CornerRadius(w * 0.2f)
    drawRoundRect(Leaf, Offset(w * 0.34f, h * 0.08f), Size(w * 0.32f, h * 0.62f), round)
    drawRoundRect(LeafDark, Offset(w * 0.08f, h * 0.30f), Size(w * 0.18f, h * 0.24f), round)
    drawRect(LeafDark, Offset(w * 0.16f, h * 0.46f), Size(w * 0.22f, h * 0.08f))
    drawRoundRect(LeafDark, Offset(w * 0.74f, h * 0.20f), Size(w * 0.18f, h * 0.26f), round)
    drawRect(LeafDark, Offset(w * 0.62f, h * 0.38f), Size(w * 0.22f, h * 0.08f))
    pot(h * 0.68f)
}

private fun DrawScope.candle(t: Float = 0f, lit: Boolean = false) {
    val w = size.width
    val h = size.height
    // Two waves that never quite line up make a flame that does not repeat itself.
    val flicker = if (lit) 0.5f * sin(t * 9.1f) + 0.5f * sin(t * 13.7f + 1.3f) else 0f
    val lean = w * 0.05f * flicker
    val stretch = 1f + 0.10f * flicker
    if (lit) {
        drawCircle(
            Brush.radialGradient(listOf(Color(0x55FFC766), Color.Transparent), center = Offset(w / 2, h * 0.12f), radius = w * (1.5f + 0.12f * flicker)),
            radius = w * (1.5f + 0.12f * flicker),
            center = Offset(w / 2, h * 0.12f),
        )
    }
    val flameHeight = h * 0.24f * stretch
    drawOval(Color(0xFFF2A33A), Offset(w * 0.28f + lean, h * 0.24f - flameHeight), Size(w * 0.44f, flameHeight))
    drawOval(Color(0xFFFFE08A), Offset(w * 0.38f + lean * 0.6f, h * 0.23f - h * 0.15f * stretch), Size(w * 0.24f, h * 0.15f * stretch))
    drawLine(Color(0xFF3A2A1A), Offset(w / 2, h * 0.20f), Offset(w / 2, h * 0.30f), strokeWidth = w * 0.08f)
    drawRoundRect(Cream, Offset(w * 0.18f, h * 0.28f), Size(w * 0.64f, h * 0.66f), CornerRadius(w * 0.1f))
    drawRect(GoldDark, Offset(w * 0.06f, h * 0.93f), Size(w * 0.88f, h * 0.07f))
}

private fun DrawScope.mug(t: Float = 0f, steaming: Boolean = false) {
    val w = size.width
    val h = size.height
    if (steaming) {
        // Three wisps that rise, sway and thin out, one after the other.
        repeat(3) { i ->
            val phase = ((t * 0.28f + i / 3f) % 1f)
            val rise = h * (0.05f - 0.75f * phase)
            val x = w * (0.26f + 0.14f * i) + w * 0.05f * sin(t * 1.3f + i * 2f + phase * 4f)
            val wisp = Path().apply {
                moveTo(x, rise)
                quadraticTo(x + w * 0.07f, rise - h * 0.12f, x, rise - h * 0.24f)
            }
            drawPath(wisp, Color.White.copy(alpha = 0.42f * (1f - phase) * phase * 4f), style = Stroke(w * 0.045f, cap = StrokeCap.Round))
        }
    }
    drawArc(Color(0xFF9FB8C8), -90f, 180f, false, Offset(w * 0.56f, h * 0.24f), Size(w * 0.36f, h * 0.46f), style = Stroke(w * 0.09f))
    drawRoundRect(Color(0xFFC9DCE6), Offset(w * 0.08f, h * 0.10f), Size(w * 0.66f, h * 0.90f), CornerRadius(w * 0.1f))
    drawRect(Color(0xFF9FB8C8), Offset(w * 0.08f, h * 0.34f), Size(w * 0.66f, h * 0.12f))
}

private fun DrawScope.vase() {
    val w = size.width
    val h = size.height
    listOf(0.30f to Color(0xFFD95D6A), 0.52f to Color(0xFFE8B84A), 0.72f to Color(0xFFB36AC4)).forEachIndexed { index, (x, color) ->
        val top = h * (0.06f + 0.07f * (index % 2))
        drawLine(LeafDark, Offset(w * x, top), Offset(w * 0.5f, h * 0.50f), strokeWidth = w * 0.05f)
        drawCircle(color, w * 0.15f, Offset(w * x, top))
    }
    val path = Path().apply {
        moveTo(w * 0.36f, h * 0.44f)
        lineTo(w * 0.64f, h * 0.44f)
        cubicTo(w * 0.64f, h * 0.58f, w * 0.96f, h * 0.62f, w * 0.86f, h * 0.84f)
        cubicTo(w * 0.80f, h * 0.98f, w * 0.70f, h, w * 0.5f, h)
        cubicTo(w * 0.30f, h, w * 0.20f, h * 0.98f, w * 0.14f, h * 0.84f)
        cubicTo(w * 0.04f, h * 0.62f, w * 0.36f, h * 0.58f, w * 0.36f, h * 0.44f)
        close()
    }
    drawPath(path, Sea)
    drawRect(Color.White.copy(alpha = 0.35f), Offset(w * 0.20f, h * 0.72f), Size(w * 0.60f, h * 0.05f))
}

private fun DrawScope.lamp(t: Float = 0f) {
    val w = size.width
    val h = size.height
    // The light under the shade. It is always on, a lamp that is off is no comfort.
    val glow = 0.30f + 0.04f * sin(t * 0.7f)
    drawOval(
        Brush.radialGradient(listOf(Color(0xFFFFE9A8).copy(alpha = glow), Color.Transparent), center = Offset(w / 2, h * 0.46f), radius = w * 0.75f),
        Offset(-w * 0.25f, h * 0.36f),
        Size(w * 1.5f, h * 0.5f),
    )
    val shade = Path().apply {
        moveTo(w * 0.26f, h * 0.04f)
        lineTo(w * 0.74f, h * 0.04f)
        lineTo(w * 0.96f, h * 0.42f)
        lineTo(w * 0.04f, h * 0.42f)
        close()
    }
    drawPath(shade, Color(0xFFE9C86A))
    drawRect(Color(0xFFFFF0B8), Offset(w * 0.10f, h * 0.36f), Size(w * 0.80f, h * 0.06f))
    drawRect(MetalDark, Offset(w * 0.46f, h * 0.42f), Size(w * 0.08f, h * 0.48f))
    drawRoundRect(Metal, Offset(w * 0.22f, h * 0.90f), Size(w * 0.56f, h * 0.10f), CornerRadius(w * 0.06f))
}

private fun DrawScope.globe() {
    val w = size.width
    val h = size.height
    val radius = w * 0.40f
    val centre = Offset(w * 0.5f, h * 0.38f)
    drawArc(GoldDark, 60f, 240f, false, Offset(centre.x - radius * 1.12f, centre.y - radius * 1.12f), Size(radius * 2.24f, radius * 2.24f), style = Stroke(w * 0.05f))
    drawCircle(Sea, radius, centre)
    drawOval(Leaf, Offset(w * 0.22f, h * 0.20f), Size(w * 0.26f, h * 0.22f))
    drawOval(Leaf, Offset(w * 0.52f, h * 0.36f), Size(w * 0.24f, h * 0.16f))
    drawRect(GoldDark, Offset(w * 0.46f, h * 0.72f), Size(w * 0.08f, h * 0.20f))
    drawRoundRect(Wood, Offset(w * 0.18f, h * 0.90f), Size(w * 0.64f, h * 0.10f), CornerRadius(w * 0.05f))
}

private fun DrawScope.clock(live: Boolean = false) {
    val w = size.width
    val h = size.height
    val radius = w * 0.44f
    val centre = Offset(w * 0.5f, h * 0.46f)
    drawRoundRect(Wood, Offset(w * 0.14f, h * 0.90f), Size(w * 0.72f, h * 0.10f), CornerRadius(w * 0.04f))
    drawCircle(Wood, radius, centre)
    drawCircle(Cream, radius * 0.80f, centre)
    // A clock on a shelf should tell the time. Standing still it shows ten past ten, as clocks in shops do.
    val now = if (live) java.time.LocalTime.now() else java.time.LocalTime.of(10, 10)
    val minutes = now.minute + now.second / 60f
    val hourAngle = Math.toRadians(((now.hour % 12) + minutes / 60f) * 30.0)
    val minuteAngle = Math.toRadians(minutes * 6.0)
    fun hand(angle: Double, length: Float) = Offset(centre.x + (sin(angle) * radius * length).toFloat(), centre.y - (cos(angle) * radius * length).toFloat())
    drawLine(Color(0xFF2B2520), centre, hand(minuteAngle, 0.58f), strokeWidth = w * 0.045f, cap = StrokeCap.Round)
    drawLine(Color(0xFF2B2520), centre, hand(hourAngle, 0.40f), strokeWidth = w * 0.06f, cap = StrokeCap.Round)
    drawCircle(Color(0xFF2B2520), w * 0.04f, centre)
}

private fun DrawScope.trophy() {
    val w = size.width
    val h = size.height
    drawArc(GoldDark, 90f, 180f, false, Offset(w * 0.02f, h * 0.08f), Size(w * 0.34f, h * 0.30f), style = Stroke(w * 0.07f))
    drawArc(GoldDark, -90f, 180f, false, Offset(w * 0.64f, h * 0.08f), Size(w * 0.34f, h * 0.30f), style = Stroke(w * 0.07f))
    val cup = Path().apply {
        moveTo(w * 0.20f, h * 0.02f)
        lineTo(w * 0.80f, h * 0.02f)
        cubicTo(w * 0.80f, h * 0.40f, w * 0.66f, h * 0.52f, w * 0.5f, h * 0.54f)
        cubicTo(w * 0.34f, h * 0.52f, w * 0.20f, h * 0.40f, w * 0.20f, h * 0.02f)
        close()
    }
    drawPath(cup, Gold)
    drawRect(GoldDark, Offset(w * 0.44f, h * 0.52f), Size(w * 0.12f, h * 0.22f))
    drawRoundRect(Gold, Offset(w * 0.28f, h * 0.72f), Size(w * 0.44f, h * 0.10f), CornerRadius(w * 0.03f))
    drawRoundRect(Wood, Offset(w * 0.18f, h * 0.82f), Size(w * 0.64f, h * 0.18f), CornerRadius(w * 0.03f))
}

private fun DrawScope.frame() {
    val w = size.width
    val h = size.height
    drawRoundRect(Wood, Offset(0f, 0f), Size(w, h), CornerRadius(w * 0.05f))
    drawRect(Color(0xFFBFD9EA), Offset(w * 0.12f, h * 0.10f), Size(w * 0.76f, h * 0.80f))
    drawCircle(Color(0xFFF4D56A), w * 0.09f, Offset(w * 0.68f, h * 0.30f))
    val hill = Path().apply {
        moveTo(w * 0.12f, h * 0.90f)
        lineTo(w * 0.12f, h * 0.70f)
        cubicTo(w * 0.30f, h * 0.50f, w * 0.46f, h * 0.62f, w * 0.60f, h * 0.72f)
        cubicTo(w * 0.72f, h * 0.62f, w * 0.80f, h * 0.66f, w * 0.88f, h * 0.74f)
        lineTo(w * 0.88f, h * 0.90f)
        close()
    }
    drawPath(hill, Leaf)
}

private fun DrawScope.pumpkin() {
    val w = size.width
    val h = size.height
    drawRoundRect(LeafDark, Offset(w * 0.45f, 0f), Size(w * 0.10f, h * 0.24f), CornerRadius(w * 0.03f))
    drawOval(Color(0xFFD9772B), Offset(0f, h * 0.18f), Size(w * 0.50f, h * 0.82f))
    drawOval(Color(0xFFD9772B), Offset(w * 0.50f, h * 0.18f), Size(w * 0.50f, h * 0.82f))
    drawOval(Color(0xFFEA8C3A), Offset(w * 0.22f, h * 0.14f), Size(w * 0.56f, h * 0.86f))
}

private fun DrawScope.bookend() {
    val w = size.width
    val h = size.height
    drawRoundRect(Metal, Offset(w * 0.10f, 0f), Size(w * 0.24f, h), CornerRadius(w * 0.06f))
    drawRoundRect(MetalDark, Offset(w * 0.10f, h * 0.90f), Size(w * 0.86f, h * 0.10f), CornerRadius(w * 0.04f))
    val brace = Path().apply {
        moveTo(w * 0.34f, h * 0.50f)
        lineTo(w * 0.90f, h * 0.90f)
        lineTo(w * 0.34f, h * 0.90f)
        close()
    }
    drawPath(brace, MetalDark.copy(alpha = 0.55f))
}

private val Ginger = Color(0xFFCB8A4C)
private val GingerDark = Color(0xFFA5672F)

/** A cat asleep on the shelf, curled up with its tail around itself. It breathes. */
private fun DrawScope.cat(t: Float = 0f) {
    val w = size.width
    val h = size.height
    val breath = 0.035f * sin(t * 1.5f)
    // The body rises and falls from the shelf upwards.
    val bodyTop = h * (0.26f - breath)
    drawOval(Ginger, Offset(w * 0.20f, bodyTop), Size(w * 0.78f, h - bodyTop))
    // Stripes across the back.
    listOf(0.50f, 0.62f, 0.74f).forEach { x ->
        drawArc(GingerDark, 200f, 140f, false, Offset(w * (x - 0.07f), bodyTop + h * 0.04f), Size(w * 0.14f, h * 0.34f), style = Stroke(w * 0.03f, cap = StrokeCap.Round))
    }
    // The head rests on the front paws.
    val head = Offset(w * 0.22f, h * 0.60f)
    val ears = Path().apply {
        moveTo(w * 0.07f, h * 0.50f); lineTo(w * 0.10f, h * 0.22f); lineTo(w * 0.21f, h * 0.40f); close()
        moveTo(w * 0.23f, h * 0.40f); lineTo(w * 0.33f, h * 0.22f); lineTo(w * 0.37f, h * 0.50f); close()
    }
    drawPath(ears, GingerDark)
    drawCircle(Ginger, w * 0.17f, head)
    // Eyes closed, content.
    drawArc(Color(0xFF3A2A1A), 20f, 140f, false, Offset(w * 0.11f, h * 0.52f), Size(w * 0.08f, h * 0.10f), style = Stroke(w * 0.018f, cap = StrokeCap.Round))
    drawArc(Color(0xFF3A2A1A), 20f, 140f, false, Offset(w * 0.24f, h * 0.52f), Size(w * 0.08f, h * 0.10f), style = Stroke(w * 0.018f, cap = StrokeCap.Round))
    drawCircle(Color(0xFFE9A0A0), w * 0.015f, Offset(w * 0.215f, h * 0.70f))
    // The tail, laid around the body.
    drawArc(GingerDark, 0f, 150f, false, Offset(w * 0.30f, h * 0.52f), Size(w * 0.66f, h * 0.44f), style = Stroke(w * 0.07f, cap = StrokeCap.Round))
}

/** Three books lying on top of each other, the way they end up when the shelf is full. */
private fun DrawScope.bookstack() {
    val w = size.width
    val h = size.height
    data class Lying(val left: Float, val width: Float, val top: Float, val height: Float, val cover: Color)
    listOf(
        Lying(0.02f, 0.96f, 0.68f, 0.32f, Color(0xFF6E3B3B)),
        Lying(0.10f, 0.82f, 0.38f, 0.30f, Color(0xFF2F5D62)),
        Lying(0.06f, 0.74f, 0.12f, 0.26f, Color(0xFFC49A3A)),
    ).forEach { book ->
        val origin = Offset(w * book.left, h * book.top)
        val box = Size(w * book.width, h * book.height)
        drawRoundRect(book.cover, origin, box, CornerRadius(w * 0.02f))
        // The pages show at the open end, the spine carries two bands.
        drawRect(Cream, Offset(origin.x + box.width * 0.93f, origin.y + box.height * 0.16f), Size(box.width * 0.07f, box.height * 0.68f))
        drawRect(Color.White.copy(alpha = 0.30f), Offset(origin.x + box.width * 0.08f, origin.y), Size(box.width * 0.02f, box.height))
        drawRect(Color.White.copy(alpha = 0.30f), Offset(origin.x + box.width * 0.14f, origin.y), Size(box.width * 0.02f, box.height))
        drawRect(Color.Black.copy(alpha = 0.18f), Offset(origin.x, origin.y + box.height * 0.86f), Size(box.width, box.height * 0.14f))
    }
}
