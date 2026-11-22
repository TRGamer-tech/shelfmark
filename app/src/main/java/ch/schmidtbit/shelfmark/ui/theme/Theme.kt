package ch.schmidtbit.shelfmark.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.ColorScheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.remember
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.lerp
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp
import ch.schmidtbit.shelfmark.R
import ch.schmidtbit.shelfmark.data.repo.Settings

/** A theme is four colours. Everything else is mixed from them. */
@Immutable
data class ThemePreset(
    val key: String,
    val name: String,
    val background: Color,
    val card: Color,
    val accent: Color,
    val text: Color,
) {
    val dark: Boolean get() = background.luminance() < 0.5f
}

private fun rgb(r: Int, g: Int, b: Int) = Color(r, g, b)

/** The 18 themes of the original Shelfmark, same keys and colours. */
val ThemePresets: List<ThemePreset> = listOf(
    ThemePreset("ember", "Ember", rgb(31, 26, 23), rgb(44, 38, 34), rgb(229, 135, 63), rgb(240, 234, 228)),
    ThemePreset("forest", "Forest", rgb(14, 24, 19), rgb(24, 38, 30), rgb(143, 191, 138), rgb(227, 236, 228)),
    ThemePreset("midnight", "Midnight", rgb(13, 18, 32), rgb(24, 32, 58), rgb(217, 180, 74), rgb(232, 230, 223)),
    ThemePreset("plum", "Plum Night", rgb(33, 22, 48), rgb(47, 34, 68), rgb(190, 154, 240), rgb(242, 236, 250)),
    ThemePreset("deepsea", "Deep Sea", rgb(16, 27, 50), rgb(27, 42, 72), rgb(112, 172, 240), rgb(230, 236, 246)),
    ThemePreset("ocean", "Ocean", rgb(12, 26, 31), rgb(21, 40, 47), rgb(79, 179, 191), rgb(226, 238, 240)),
    ThemePreset("mocha", "Mocha", rgb(33, 25, 21), rgb(47, 37, 32), rgb(210, 166, 121), rgb(240, 230, 220)),
    ThemePreset("cocoa", "Cocoa", rgb(42, 29, 23), rgb(58, 41, 33), rgb(238, 162, 98), rgb(246, 234, 222)),
    ThemePreset("graphite", "Graphite", rgb(18, 18, 18), rgb(30, 30, 30), rgb(158, 197, 255), rgb(242, 242, 242)),
    ThemePreset("paper", "Paper", rgb(245, 241, 234), rgb(255, 255, 255), rgb(200, 105, 44), rgb(43, 39, 35)),
    ThemePreset("peach", "Peach", rgb(251, 236, 226), rgb(255, 250, 246), rgb(226, 120, 64), rgb(52, 36, 28)),
    ThemePreset("lavender", "Lavender", rgb(244, 238, 248), rgb(252, 250, 254), rgb(176, 92, 206), rgb(45, 35, 56)),
    ThemePreset("rose", "Rose", rgb(251, 240, 242), rgb(255, 255, 255), rgb(207, 86, 121), rgb(53, 36, 42)),
    ThemePreset("slate", "Slate", rgb(236, 239, 244), rgb(255, 255, 255), rgb(63, 111, 181), rgb(31, 39, 51)),
    ThemePreset("sage", "Sage", rgb(236, 242, 234), rgb(252, 255, 251), rgb(86, 140, 90), rgb(32, 44, 34)),
    ThemePreset("sky", "Sky", rgb(234, 243, 250), rgb(255, 255, 255), rgb(52, 140, 210), rgb(28, 40, 54)),
    ThemePreset("sand", "Sand", rgb(244, 236, 222), rgb(253, 250, 244), rgb(176, 120, 60), rgb(52, 42, 30)),
    ThemePreset("mint", "Mint", rgb(232, 246, 242), rgb(252, 255, 254), rgb(38, 160, 140), rgb(26, 46, 42)),
)

fun presetFor(key: String, systemDark: Boolean): ThemePreset =
    ThemePresets.firstOrNull { it.key == key }
        ?: ThemePresets.first { it.key == if (systemDark) "ember" else "paper" }

private fun textOn(color: Color): Color = if (color.luminance() > 0.45f) Color(0xFF1B1714) else Color.White

/** Builds a complete Material colour scheme from the four colours of a preset. */
fun schemeOf(p: ThemePreset): ColorScheme {
    val base = if (p.dark) darkColorScheme() else lightColorScheme()
    // In light themes the accent is darkened a little where it carries text, for contrast.
    val strongAccent = if (p.dark) p.accent else lerp(p.accent, Color.Black, 0.12f)
    val danger = if (p.dark) Color(0xFFE86058) else Color(0xFFCE3C36)
    return base.copy(
        primary = strongAccent,
        onPrimary = textOn(strongAccent),
        primaryContainer = lerp(p.card, p.accent, if (p.dark) 0.30f else 0.22f),
        onPrimaryContainer = p.text,
        inversePrimary = lerp(p.accent, p.background, 0.4f),
        secondary = lerp(strongAccent, p.text, 0.30f),
        onSecondary = p.background,
        secondaryContainer = lerp(p.card, p.accent, if (p.dark) 0.18f else 0.14f),
        onSecondaryContainer = p.text,
        tertiary = danger,
        onTertiary = Color.White,
        tertiaryContainer = lerp(p.card, danger, 0.22f),
        onTertiaryContainer = p.text,
        background = p.background,
        onBackground = p.text,
        surface = p.background,
        onSurface = p.text,
        surfaceVariant = lerp(p.card, p.text, 0.08f),
        onSurfaceVariant = lerp(p.text, p.card, 0.38f),
        surfaceTint = p.accent,
        inverseSurface = p.text,
        inverseOnSurface = p.background,
        error = danger,
        onError = Color.White,
        errorContainer = lerp(p.card, danger, 0.25f),
        onErrorContainer = p.text,
        outline = lerp(p.card, p.text, 0.38f),
        outlineVariant = lerp(p.card, p.text, 0.14f),
        scrim = Color.Black,
        surfaceBright = lerp(p.card, p.text, 0.10f),
        surfaceDim = lerp(p.background, Color.Black, 0.08f),
        surfaceContainerLowest = lerp(p.background, if (p.dark) Color.Black else Color.White, 0.25f),
        surfaceContainerLow = lerp(p.background, p.card, 0.6f),
        surfaceContainer = p.card,
        surfaceContainerHigh = lerp(p.card, p.text, 0.05f),
        surfaceContainerHighest = lerp(p.card, p.text, 0.09f),
    )
}

/** Colours that Material has no slot for: the wooden shelf, stars and chillies. */
@Immutable
data class ShelfColors(
    val woodLight: Color,
    val wood: Color,
    val woodDark: Color,
    val shelfBack: Color,
    val star: Color,
    val spice: Color,
    val good: Color,
)

private fun shelfColorsOf(p: ThemePreset): ShelfColors = if (p.dark) {
    ShelfColors(
        woodLight = Color(0xFFB98862),
        wood = Color(0xFF9A6A48),
        woodDark = Color(0xFF6B4630),
        shelfBack = lerp(p.background, Color.Black, 0.25f),
        star = Color(0xFFE8BA4A),
        spice = Color(0xFFFF6B5E),
        good = Color(0xFF8BC878),
    )
} else {
    ShelfColors(
        woodLight = Color(0xFFD9B48A),
        wood = Color(0xFFBF9264),
        woodDark = Color(0xFF94683F),
        shelfBack = lerp(p.background, p.text, 0.07f),
        star = Color(0xFFBE8C14),
        spice = Color(0xFFCE3C36),
        good = Color(0xFF3A964A),
    )
}

val LocalShelfColors = staticCompositionLocalOf { shelfColorsOf(ThemePresets.first()) }

/** Playfair Display for headings, as in the original app. Only the bold cuts are bundled. */
val Serif = FontFamily(
    Font(R.font.playfair_bold, FontWeight.Bold),
    Font(R.font.playfair_bold_italic, FontWeight.Bold, FontStyle.Italic),
)

/** Lato for everything else. */
val Sans = FontFamily(
    Font(R.font.lato_regular, FontWeight.Normal),
    Font(R.font.lato_bold, FontWeight.Bold),
)

private val AppTypography = Typography().let { base ->
    fun TextStyle.sans(weight: FontWeight = FontWeight.Normal) = copy(fontFamily = Sans, fontWeight = weight)
    fun TextStyle.serif() = copy(fontFamily = Serif, fontWeight = FontWeight.Bold)
    Typography(
        displayLarge = base.displayLarge.serif(),
        displayMedium = base.displayMedium.serif(),
        displaySmall = base.displaySmall.serif(),
        headlineLarge = base.headlineLarge.serif(),
        headlineMedium = base.headlineMedium.serif(),
        headlineSmall = base.headlineSmall.serif(),
        titleLarge = base.titleLarge.serif(),
        titleMedium = base.titleMedium.sans(FontWeight.Bold),
        titleSmall = base.titleSmall.sans(FontWeight.Bold),
        bodyLarge = base.bodyLarge.sans().copy(lineHeight = 24.sp),
        bodyMedium = base.bodyMedium.sans(),
        bodySmall = base.bodySmall.sans(),
        labelLarge = base.labelLarge.sans(FontWeight.Bold),
        labelMedium = base.labelMedium.sans(FontWeight.Bold),
        labelSmall = base.labelSmall.sans(FontWeight.Bold),
    )
}

/** Serif italic used for quotes. */
val QuoteStyle = TextStyle(fontFamily = Serif, fontWeight = FontWeight.Bold, fontStyle = FontStyle.Italic, fontSize = 17.sp, lineHeight = 26.sp)

@Composable
fun ShelfmarkTheme(themeKey: String = Settings.THEME_SYSTEM, content: @Composable () -> Unit) {
    val preset = presetFor(themeKey, isSystemInDarkTheme())
    val scheme = remember(preset) { schemeOf(preset) }
    val shelf = remember(preset) { shelfColorsOf(preset) }
    CompositionLocalProvider(LocalShelfColors provides shelf) {
        MaterialTheme(colorScheme = scheme, typography = AppTypography, content = content)
    }
}
