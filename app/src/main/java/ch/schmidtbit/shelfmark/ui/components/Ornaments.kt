package ch.schmidtbit.shelfmark.ui.components

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
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
}

@Composable
fun OrnamentView(kind: OrnamentKind, modifier: Modifier = Modifier, scale: Float = 1f) {
    val (width, height) = ornamentSize(kind)
    Canvas(modifier.size((width * scale).dp, (height * scale).dp)) {
        when (kind) {
            OrnamentKind.PLANT -> plant()
            OrnamentKind.CACTUS -> cactus()
            OrnamentKind.CANDLE -> candle()
            OrnamentKind.MUG -> mug()
            OrnamentKind.VASE -> vase()
            OrnamentKind.LAMP -> lamp()
            OrnamentKind.GLOBE -> globe()
            OrnamentKind.CLOCK -> clock()
            OrnamentKind.TROPHY -> trophy()
            OrnamentKind.FRAME -> frame()
            OrnamentKind.PUMPKIN -> pumpkin()
            OrnamentKind.BOOKEND -> bookend()
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

private fun DrawScope.plant() {
    val w = size.width
    val h = size.height
    listOf(-38f to LeafDark, 34f to LeafDark, -14f to Leaf, 16f to Leaf, 0f to Leaf).forEach { (angle, color) ->
        rotate(angle, Offset(w / 2, h * 0.66f)) {
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

private fun DrawScope.candle() {
    val w = size.width
    val h = size.height
    drawOval(Color(0xFFF2A33A), Offset(w * 0.28f, 0f), Size(w * 0.44f, h * 0.24f))
    drawOval(Color(0xFFFFE08A), Offset(w * 0.38f, h * 0.08f), Size(w * 0.24f, h * 0.15f))
    drawLine(Color(0xFF3A2A1A), Offset(w / 2, h * 0.20f), Offset(w / 2, h * 0.30f), strokeWidth = w * 0.08f)
    drawRoundRect(Cream, Offset(w * 0.18f, h * 0.28f), Size(w * 0.64f, h * 0.66f), CornerRadius(w * 0.1f))
    drawRect(GoldDark, Offset(w * 0.06f, h * 0.93f), Size(w * 0.88f, h * 0.07f))
}

private fun DrawScope.mug() {
    val w = size.width
    val h = size.height
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

private fun DrawScope.lamp() {
    val w = size.width
    val h = size.height
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

private fun DrawScope.clock() {
    val w = size.width
    val h = size.height
    val radius = w * 0.44f
    val centre = Offset(w * 0.5f, h * 0.46f)
    drawRoundRect(Wood, Offset(w * 0.14f, h * 0.90f), Size(w * 0.72f, h * 0.10f), CornerRadius(w * 0.04f))
    drawCircle(Wood, radius, centre)
    drawCircle(Cream, radius * 0.80f, centre)
    drawLine(Color(0xFF2B2520), centre, Offset(centre.x, centre.y - radius * 0.56f), strokeWidth = w * 0.05f, cap = StrokeCap.Round)
    drawLine(Color(0xFF2B2520), centre, Offset(centre.x + radius * 0.40f, centre.y + radius * 0.14f), strokeWidth = w * 0.05f, cap = StrokeCap.Round)
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
