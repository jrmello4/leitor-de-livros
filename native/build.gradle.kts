// Top-level build file for the native Android scaffold.
// The shipped product is still the Tauri APK; this module proves the
// portable core (tactile-core) through JNI, screen by screen.
plugins {
    id("com.android.application") version "8.7.3" apply false
    id("org.jetbrains.kotlin.android") version "2.0.21" apply false
    id("org.jetbrains.kotlin.plugin.compose") version "2.0.21" apply false
}
