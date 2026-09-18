package com.jrmello4.tactilereader.ui.theme

import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Shapes
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/**
 * Paleta Dark-First Editorial Workbench para o Tactile Reader.
 * Inspirada em uma mesa de trabalho editorial digital de alto acabamento.
 * Fundo grafite profundo, costuras finas (seams), tipografia com números tabulares
 * e cor estritamente reservada para ação, progresso e estado.
 */

// Canvas e superfícies grafite
val DarkGraphite950 = Color(0xFF0B0D11) // Canvas leitor profundo
val DarkGraphite900 = Color(0xFF101318) // Fundo geral da estante e telas
val DarkGraphite850 = Color(0xFF161A22) // Barras de navegação e top bar
val DarkGraphite800 = Color(0xFF1C222D) // Superfície de cards e diálogos
val DarkGraphite750 = Color(0xFF242B38) // Superfície elevada e containers de controle

// Costuras estruturais (Hairline Seams)
val SeamSubtle = Color(0xFF232B38)     // Contornos finos de cartões e divisores
val SeamStrong = Color(0xFF333E50)     // Contornos focados e ênfase

// Tipografia Editorial Paper
val Paper50 = Color(0xFFF7F5EE)        // Texto primário de alto contraste
val Paper300 = Color(0xFFC5C0B4)       // Texto secundário e rótulos
val Paper500 = Color(0xFF888275)       // Metadados terciários e dicas

// Cores Semânticas
val WarmAmber = Color(0xFFF59E0B)       // Ação primária e progresso de leitura
val WarmAmberContainer = Color(0xFF2E1E08)
val WarmAmberOnContainer = Color(0xFFFDE68A)

val OxideRed = Color(0xFFD64045)        // Destrutivo, erro e cancelamento
val OxideRedContainer = Color(0xFF2D1214)
val OxideRedOnContainer = Color(0xFFFCA5A5)

val SageGreen = Color(0xFF588157)       // Sucesso exclusivo e 100% lido
val SageGreenContainer = Color(0xFF142417)
val SageGreenOnContainer = Color(0xFFA3CFAB)

val EditorialDarkScheme = darkColorScheme(
    primary = WarmAmber,
    onPrimary = Color(0xFF120E06),
    primaryContainer = WarmAmberContainer,
    onPrimaryContainer = WarmAmberOnContainer,
    secondary = WarmAmber,
    onSecondary = Color(0xFF120E06),
    secondaryContainer = DarkGraphite750,
    onSecondaryContainer = Paper50,
    tertiary = SageGreen,
    onTertiary = Color(0xFF0C170E),
    tertiaryContainer = SageGreenContainer,
    onTertiaryContainer = SageGreenOnContainer,
    background = DarkGraphite900,
    onBackground = Paper50,
    surface = DarkGraphite800,
    onSurface = Paper50,
    surfaceVariant = DarkGraphite850,
    onSurfaceVariant = Paper300,
    surfaceContainerLowest = DarkGraphite950,
    surfaceContainerLow = DarkGraphite900,
    surfaceContainer = DarkGraphite850,
    surfaceContainerHigh = DarkGraphite800,
    surfaceContainerHighest = DarkGraphite750,
    outline = SeamStrong,
    outlineVariant = SeamSubtle,
    error = OxideRed,
    onError = Color(0xFF1A0708),
    errorContainer = OxideRedContainer,
    onErrorContainer = OxideRedOnContainer,
)

val EditorialLightScheme = lightColorScheme(
    primary = Color(0xFFC07000),
    onPrimary = Color(0xFFFFFFFF),
    primaryContainer = Color(0xFFFFECC7),
    onPrimaryContainer = Color(0xFF3B1E00),
    secondary = Color(0xFFC07000),
    onSecondary = Color(0xFFFFFFFF),
    secondaryContainer = Color(0xFFEBE7DD),
    onSecondaryContainer = Color(0xFF1C1A15),
    tertiary = Color(0xFF3F6340),
    onTertiary = Color(0xFFFFFFFF),
    background = Color(0xFFF9F7F1),
    onBackground = Color(0xFF1A1C1E),
    surface = Color(0xFFFFFFFF),
    onSurface = Color(0xFF1A1C1E),
    surfaceVariant = Color(0xFFE5E0D4),
    onSurfaceVariant = Color(0xFF4C473E),
    outline = Color(0xFFCCC5B8),
    outlineVariant = Color(0xFFE2DDD2),
    error = Color(0xFFBA1A1A),
    onError = Color(0xFFFFFFFF),
)

// Tipografia com números tabulares ("tnum") para garantir alinhamento rigoroso
val EditorialTypography = Typography(
    titleLarge = TextStyle(
        fontFamily = FontFamily.SansSerif,
        fontWeight = FontWeight.Bold,
        fontSize = 20.sp,
        lineHeight = 26.sp,
        letterSpacing = (-0.25).sp,
        fontFeatureSettings = "tnum",
    ),
    titleMedium = TextStyle(
        fontFamily = FontFamily.SansSerif,
        fontWeight = FontWeight.SemiBold,
        fontSize = 16.sp,
        lineHeight = 22.sp,
        letterSpacing = 0.sp,
        fontFeatureSettings = "tnum",
    ),
    titleSmall = TextStyle(
        fontFamily = FontFamily.SansSerif,
        fontWeight = FontWeight.SemiBold,
        fontSize = 14.sp,
        lineHeight = 20.sp,
        letterSpacing = 0.1.sp,
        fontFeatureSettings = "tnum",
    ),
    bodyLarge = TextStyle(
        fontFamily = FontFamily.SansSerif,
        fontWeight = FontWeight.Normal,
        fontSize = 16.sp,
        lineHeight = 24.sp,
        letterSpacing = 0.15.sp,
        fontFeatureSettings = "tnum",
    ),
    bodyMedium = TextStyle(
        fontFamily = FontFamily.SansSerif,
        fontWeight = FontWeight.Normal,
        fontSize = 14.sp,
        lineHeight = 20.sp,
        letterSpacing = 0.2.sp,
        fontFeatureSettings = "tnum",
    ),
    bodySmall = TextStyle(
        fontFamily = FontFamily.SansSerif,
        fontWeight = FontWeight.Normal,
        fontSize = 12.sp,
        lineHeight = 16.sp,
        letterSpacing = 0.3.sp,
        fontFeatureSettings = "tnum",
    ),
    labelLarge = TextStyle(
        fontFamily = FontFamily.SansSerif,
        fontWeight = FontWeight.SemiBold,
        fontSize = 14.sp,
        lineHeight = 20.sp,
        letterSpacing = 0.1.sp,
        fontFeatureSettings = "tnum",
    ),
    labelMedium = TextStyle(
        fontFamily = FontFamily.SansSerif,
        fontWeight = FontWeight.Medium,
        fontSize = 12.sp,
        lineHeight = 16.sp,
        letterSpacing = 0.4.sp,
        fontFeatureSettings = "tnum",
    ),
    labelSmall = TextStyle(
        fontFamily = FontFamily.SansSerif,
        fontWeight = FontWeight.Medium,
        fontSize = 11.sp,
        lineHeight = 14.sp,
        letterSpacing = 0.5.sp,
        fontFeatureSettings = "tnum",
    ),
)

val EditorialShapes = Shapes(
    small = RoundedCornerShape(8.dp),
    medium = RoundedCornerShape(12.dp),
    large = RoundedCornerShape(16.dp),
    extraLarge = RoundedCornerShape(24.dp),
)
