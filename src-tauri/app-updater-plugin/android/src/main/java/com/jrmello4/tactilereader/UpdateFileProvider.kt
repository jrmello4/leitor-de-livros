package com.jrmello4.tactilereader.appupdater

import androidx.core.content.FileProvider

/**
 * Distinct FileProvider subclass so the manifest merger keeps both this
 * provider and Tauri's own FileProvider: same base class with different
 * authorities alone still conflicts on android:name.
 */
class UpdateFileProvider : FileProvider()
