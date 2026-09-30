package com.jrmello4.tactilereader.reader

import android.app.Activity
import android.content.Context
import android.content.ContextWrapper
import android.content.pm.ActivityInfo
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.ui.platform.LocalView
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat

internal tailrec fun Context.readerActivity(): Activity? = when (this) {
    is Activity -> this
    is ContextWrapper -> baseContext.readerActivity()
    else -> null
}

@Composable
internal fun ReaderWindow(settings: ReaderSettings, hudVisible: Boolean) {
    val view = LocalView.current
    val activity = view.context.readerActivity()
    DisposableEffect(view, settings.keepScreenOn) {
        val previous = view.keepScreenOn
        view.keepScreenOn = settings.keepScreenOn
        onDispose { view.keepScreenOn = previous }
    }
    DisposableEffect(activity, settings.orientation) {
        activity?.requestedOrientation = when (settings.orientation) {
            ReaderOrientation.SYSTEM -> ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED
            ReaderOrientation.PORTRAIT -> ActivityInfo.SCREEN_ORIENTATION_SENSOR_PORTRAIT
            ReaderOrientation.LANDSCAPE -> ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE
        }
        onDispose {
            if (activity != null && !activity.isChangingConfigurations) {
                activity.requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED
            }
        }
    }
    DisposableEffect(activity, view, hudVisible) {
        val controller = activity?.window?.let { WindowCompat.getInsetsController(it, view) }
        val previousBehavior = controller?.systemBarsBehavior
        controller?.systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
        if (hudVisible) controller?.show(WindowInsetsCompat.Type.systemBars())
        else controller?.hide(WindowInsetsCompat.Type.systemBars())
        onDispose {
            controller?.show(WindowInsetsCompat.Type.systemBars())
            if (previousBehavior != null) controller.systemBarsBehavior = previousBehavior
        }
    }
}
