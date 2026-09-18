package com.jrmello4.tactilereader.ui.theme

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.unit.dp

/**
 * Ícones vetoriais autorais em Compose para a mesa editorial digital.
 * Sem emojis, sem unicode decorativo e sem conflitos de classpath.
 */
object EditorialIcons {
    /** Livro aberto para a Estante */
    val Book: ImageVector by lazy {
        ImageVector.Builder(
            name = "Book",
            defaultWidth = 24.dp,
            defaultHeight = 24.dp,
            viewportWidth = 24f,
            viewportHeight = 24f,
        ).apply {
            path(fill = SolidColor(Color.White)) {
                moveTo(21f, 5f)
                curveToRelative(-1.11f, -0.35f, -2.33f, -0.5f, -3.5f, -0.5f)
                curveToRelative(-1.95f, 0f, -4.05f, 0.4f, -5.5f, 1.5f)
                curveToRelative(-1.45f, -1.1f, -3.55f, -1.5f, -5.5f, -1.5f)
                curveTo(4.83f, 4.5f, 3.61f, 4.65f, 2.5f, 5f)
                curveTo(1.63f, 5.28f, 1f, 6.08f, 1f, 7f)
                verticalLineToRelative(12.5f)
                curveToRelative(0f, 1.34f, 1.25f, 2.34f, 2.55f, 1.98f)
                curveTo(4.74f, 21.14f, 5.88f, 21f, 7f, 21f)
                curveToRelative(1.75f, 0f, 3.59f, 0.43f, 5f, 1.28f)
                curveToRelative(1.41f, -0.85f, 3.25f, -1.28f, 5f, -1.28f)
                curveToRelative(1.12f, 0f, 2.26f, 0.14f, 3.45f, 0.48f)
                curveToRelative(1.3f, 0.36f, 2.55f, -0.64f, 2.55f, -1.98f)
                verticalLineTo(7f)
                curveToRelative(0f, -0.92f, -0.63f, -1.72f, -1.5f, -2f)
                close()
                moveTo(11f, 19.5f)
                curveToRelative(-1.21f, -0.65f, -2.57f, -1f, -4f, -1f)
                curveToRelative(-1.18f, 0f, -2.35f, 0.22f, -3.42f, 0.6f)
                curveToRelative(-0.35f, 0.13f, -0.58f, -0.16f, -0.58f, -0.47f)
                verticalLineTo(7.17f)
                curveToRelative(0f, -0.28f, 0.22f, -0.52f, 0.5f, -0.58f)
                curveTo(4.55f, 6.36f, 5.76f, 6.2f, 7f, 6.2f)
                curveToRelative(1.65f, 0f, 3.24f, 0.45f, 4f, 1.22f)
                verticalLineToRelative(12.08f)
                close()
                moveTo(21f, 17.63f)
                curveToRelative(0f, 0.31f, -0.23f, 0.6f, -0.58f, 0.47f)
                curveToRelative(-1.07f, -0.38f, -2.24f, -0.6f, -3.42f, -0.6f)
                curveToRelative(-1.43f, 0f, -2.79f, 0.35f, -4f, 1f)
                verticalLineTo(7.42f)
                curveToRelative(0.76f, -0.77f, 2.35f, -1.22f, 4f, -1.22f)
                curveToRelative(1.24f, 0f, 2.45f, 0.16f, 3.5f, 0.39f)
                curveToRelative(0.28f, 0.06f, 0.5f, 0.3f, 0.5f, 0.58f)
                verticalLineToRelative(10.46f)
                close()
            }
        }.build()
    }

    /** Marcador de fita para a Central de Marcadores */
    val Bookmark: ImageVector by lazy {
        ImageVector.Builder(
            name = "Bookmark",
            defaultWidth = 24.dp,
            defaultHeight = 24.dp,
            viewportWidth = 24f,
            viewportHeight = 24f,
        ).apply {
            path(fill = SolidColor(Color.White)) {
                moveTo(17f, 3f)
                horizontalLineTo(7f)
                curveToRelative(-1.1f, 0f, -2f, 0.9f, -2f, 2f)
                verticalLineToRelative(16f)
                lineToRelative(7f, -3f)
                lineToRelative(7f, 3f)
                verticalLineTo(5f)
                curveToRelative(0f, -1.1f, -0.9f, -2f, -2f, -2f)
                close()
            }
        }.build()
    }

    /** Gráfico de linha / ritmo para Minha Leitura */
    val Metrics: ImageVector by lazy {
        ImageVector.Builder(
            name = "Metrics",
            defaultWidth = 24.dp,
            defaultHeight = 24.dp,
            viewportWidth = 24f,
            viewportHeight = 24f,
        ).apply {
            path(fill = SolidColor(Color.White)) {
                moveTo(19f, 3f)
                horizontalLineTo(5f)
                curveToRelative(-1.1f, 0f, -2f, 0.9f, -2f, 2f)
                verticalLineToRelative(14f)
                curveToRelative(0f, 1.1f, 0.9f, 2f, 2f, 2f)
                horizontalLineToRelative(14f)
                curveToRelative(1.1f, 0f, 2f, -0.9f, 2f, -2f)
                verticalLineTo(5f)
                curveToRelative(0f, -1.1f, -0.9f, -2f, -2f, -2f)
                close()
                moveTo(9f, 17f)
                horizontalLineTo(7f)
                verticalLineToRelative(-5f)
                horizontalLineToRelative(2f)
                verticalLineToRelative(5f)
                close()
                moveTo(13f, 17f)
                horizontalLineToRelative(-2f)
                verticalLineToRelative(-8f)
                horizontalLineToRelative(2f)
                verticalLineToRelative(8f)
                close()
                moveTo(17f, 17f)
                horizontalLineToRelative(-2f)
                verticalLineToRelative(-3f)
                horizontalLineToRelative(2f)
                verticalLineToRelative(3f)
                close()
            }
        }.build()
    }
}
