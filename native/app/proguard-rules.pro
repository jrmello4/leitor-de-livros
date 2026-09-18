# Tactile Reader - Proguard / R8 Rules for Release Build

# Core Models and Data Classes
-keep class com.jrmello4.tactilereader.core.** { *; }
-keep class com.jrmello4.tactilereader.settings.BackupManager** { *; }
-keep class com.jrmello4.tactilereader.settings.UpdateCheck** { *; }
-keep class com.jrmello4.tactilereader.settings.UpdateState { *; }
-keep class com.jrmello4.tactilereader.opds.OpdsServer { *; }
-keep class com.jrmello4.tactilereader.opds.OpdsClient$** { *; }

# Archive engines: Junrar (RAR4/RAR5)
-keep class com.github.junrar.** { *; }
-dontwarn com.github.junrar.**

# Archive engines: Apache Commons Compress & XZ (7z / LZMA)
-keep class org.apache.commons.compress.** { *; }
-keep class org.tukaani.xz.** { *; }
-dontwarn org.apache.commons.compress.**
-dontwarn org.tukaani.xz.**

# SLF4J (silenced by slf4j-nop)
-dontwarn org.slf4j.**

# Coil 3 Image Loading
-dontwarn coil3.**

# Baseline Profile & ProfileInstaller
-keep class androidx.profileinstaller.** { *; }
-keep class * extends androidx.profileinstaller.ProfileInstallReceiver

# Coroutines and Kotlin runtime
-dontwarn kotlinx.coroutines.**
-keepattributes *Annotation*,InnerClasses,Signature,EnclosingMethod

# Keep Compose Preview and Composable symbols for runtime inspection if needed
-dontwarn androidx.compose.**
