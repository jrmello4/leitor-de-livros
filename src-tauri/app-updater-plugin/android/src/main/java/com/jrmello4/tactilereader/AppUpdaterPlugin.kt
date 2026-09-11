package com.jrmello4.tactilereader.appupdater

import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.content.FileProvider
import app.tauri.annotation.Command
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors

/**
 * Checks a GitHub Releases `latest.json`, downloads the APK into the app cache,
 * and hands it to the system installer. The user always confirms the install —
 * silent updates are not possible without a store or device-owner policy.
 */
@TauriPlugin
class AppUpdaterPlugin(private val host: Activity) : Plugin(host) {
  companion object {
    private const val CONNECT_TIMEOUT_MS = 15_000
    private const val READ_TIMEOUT_MS = 60_000
    private const val MAX_APK_BYTES = 200L * 1024L * 1024L
  }

  private val executor = Executors.newSingleThreadExecutor()

  @Command
  fun checkUpdate(invoke: Invoke) {
    val manifestUrl = invoke.getString("manifestUrl")
      ?: "https://github.com/jrmello4/leitor-de-livros/releases/latest/download/latest.json"
    executor.execute {
      try {
        val payload = fetchJson(manifestUrl)
        val result = JSObject()
        result.put("version", payload.optString("version", ""))
        result.put("versionCode", payload.optLong("versionCode", -1L))
        result.put("url", payload.optString("url", ""))
        result.put("notes", payload.optString("notes", ""))
        invoke.resolve(result)
      } catch (error: Exception) {
        invoke.reject(error.message ?: "Could not read the update manifest")
      }
    }
  }

  @Command
  fun downloadAndInstall(invoke: Invoke) {
    val apkUrl = invoke.getString("apkUrl")
    if (apkUrl.isNullOrBlank()) {
      invoke.reject("Missing apkUrl")
      return
    }
    if (!apkUrl.startsWith("https://")) {
      invoke.reject("Only https update URLs are accepted")
      return
    }
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
      && !host.packageManager.canRequestPackageInstalls()
    ) {
      val settings = Intent(
        Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
        Uri.parse("package:${host.packageName}")
      )
      settings.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      host.startActivity(settings)
      invoke.reject("Allow this app to install updates, then try again")
      return
    }

    executor.execute {
      try {
        val apk = downloadApk(apkUrl)
        val uri = FileProvider.getUriForFile(
          host,
          "${host.packageName}.appupdater.fileprovider",
          apk
        )
        val intent = Intent(Intent.ACTION_VIEW).apply {
          setDataAndType(uri, "application/vnd.android.package-archive")
          addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        host.startActivity(intent)
        val result = JSObject()
        result.put("path", apk.absolutePath)
        result.put("bytes", apk.length())
        invoke.resolve(result)
      } catch (error: Exception) {
        invoke.reject(error.message ?: "Could not download the update")
      }
    }
  }

  private fun fetchJson(manifestUrl: String): JSONObject {
    val connection = openConnection(manifestUrl)
    try {
      val code = connection.responseCode
      if (code !in 200..299) {
        throw IllegalStateException("Update manifest returned HTTP $code")
      }
      val body = connection.inputStream.bufferedReader().use { it.readText() }
      return JSONObject(body)
    } finally {
      connection.disconnect()
    }
  }

  private fun downloadApk(apkUrl: String): File {
    val directory = File(host.cacheDir, "app-updater")
    if (!directory.exists() && !directory.mkdirs()) {
      throw IllegalStateException("Could not create the update cache directory")
    }
    val target = File(directory, "update.apk")
    if (target.exists()) {
      target.delete()
    }
    val connection = openConnection(apkUrl)
    try {
      val code = connection.responseCode
      if (code !in 200..299) {
        throw IllegalStateException("Update download returned HTTP $code")
      }
      val expected = connection.contentLengthLong
      if (expected > MAX_APK_BYTES) {
        throw IllegalStateException("Update package is larger than the allowed size")
      }
      var total = 0L
      connection.inputStream.use { input ->
        FileOutputStream(target).use { output ->
          val buffer = ByteArray(64 * 1024)
          while (true) {
            val read = input.read(buffer)
            if (read < 0) break
            total += read
            if (total > MAX_APK_BYTES) {
              throw IllegalStateException("Update package exceeded the allowed size")
            }
            output.write(buffer, 0, read)
          }
          output.flush()
        }
      }
      if (total <= 0L) {
        throw IllegalStateException("Update download was empty")
      }
      return target
    } finally {
      connection.disconnect()
    }
  }

  private fun openConnection(url: String): HttpURLConnection {
    val connection = URL(url).openConnection() as HttpURLConnection
    connection.connectTimeout = CONNECT_TIMEOUT_MS
    connection.readTimeout = READ_TIMEOUT_MS
    connection.instanceFollowRedirects = true
    connection.setRequestProperty("User-Agent", "TactileReader-Updater")
    connection.setRequestProperty("Accept", "application/json, application/octet-stream, */*")
    return connection
  }
}
