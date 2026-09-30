package com.jrmello4.tactilereader.reader

import android.content.Context
import androidx.compose.ui.graphics.Color

enum class ReaderMode { SINGLE_PAGE, DOUBLE_PAGE, VERTICAL, WEBTOON }
enum class ReadingDirection(val value: String) { LEFT_TO_RIGHT("ltr"), RIGHT_TO_LEFT("rtl") }
enum class FitMode { FIT_SCREEN, FIT_WIDTH, FIT_HEIGHT }
enum class ReaderOrientation { SYSTEM, PORTRAIT, LANDSCAPE }
enum class ReaderBackground(val color: Color) {
    BLACK(Color.Black), GRAY(Color(0xFF202124)), WHITE(Color.White),
}

data class ReaderSettings(
    val mode: ReaderMode = ReaderMode.WEBTOON,
    val direction: ReadingDirection = ReadingDirection.LEFT_TO_RIGHT,
    val fit: FitMode = FitMode.FIT_SCREEN,
    val coverAlone: Boolean = true,
    val orientation: ReaderOrientation = ReaderOrientation.SYSTEM,
    val background: ReaderBackground = ReaderBackground.BLACK,
    val keepScreenOn: Boolean = true,
)

/** Global preferences, no database migration and no bitmap cache. */
class ReaderSettingsStore(context: Context) {
    private val prefs = context.getSharedPreferences("reader-settings", Context.MODE_PRIVATE)
    private inline fun <reified T : Enum<T>> read(key: String, default: T): T =
        enumValues<T>().firstOrNull { it.name == prefs.getString(key, null) } ?: default

    fun load() = ReaderSettings(
        mode = read("mode", ReaderMode.WEBTOON),
        direction = read("direction", ReadingDirection.LEFT_TO_RIGHT),
        fit = read("fit", FitMode.FIT_SCREEN),
        coverAlone = prefs.getBoolean("cover", true),
        orientation = read("orientation", ReaderOrientation.SYSTEM),
        background = read("background", ReaderBackground.BLACK),
        keepScreenOn = prefs.getBoolean("keep-screen", true),
    )

    fun save(settings: ReaderSettings) {
        prefs.edit().putString("mode", settings.mode.name)
            .putString("direction", settings.direction.name).putString("fit", settings.fit.name)
            .putBoolean("cover", settings.coverAlone).putString("orientation", settings.orientation.name)
            .putString("background", settings.background.name).putBoolean("keep-screen", settings.keepScreenOn)
            .apply()
    }
}

/**
 * PAGE ORDER policy, pending manual validation with a real manga: RTL reverses the file sequence.
 * Change this function if that policy is rejected; visualSpread/tapStep independently control
 * READING DIRECTION. Also align ReadingStateRules and ReaderViewModel's terminal/start/metric
 * indexes with the approved policy (see docs/reader-2-finishing.md). No policy change here.
 */
internal fun <T> readingOrder(pages: List<T>, direction: ReadingDirection): List<T> =
    if (direction == ReadingDirection.RIGHT_TO_LEFT) pages.asReversed() else pages

internal fun pageSpreads(pageCount: Int, coverAlone: Boolean): List<List<Int>> {
    if (pageCount <= 0) return emptyList()
    val start = if (coverAlone) 1 else 0
    return buildList {
        if (coverAlone) add(listOf(0))
        for (index in start until pageCount step 2) {
            add((index until minOf(index + 2, pageCount)).toList())
        }
    }
}

internal fun visualSpread(spread: List<Int>, direction: ReadingDirection): List<Int> =
    // Spatial placement only: it must not inherit a future change to the file-order policy.
    if (direction == ReadingDirection.RIGHT_TO_LEFT) spread.asReversed() else spread

internal fun tapStep(fraction: Float, direction: ReadingDirection): Int {
    if (fraction in 0.25f..0.75f) return 0
    val step = if (fraction < 0.25f) -1 else 1
    return if (direction == ReadingDirection.RIGHT_TO_LEFT) -step else step
}
