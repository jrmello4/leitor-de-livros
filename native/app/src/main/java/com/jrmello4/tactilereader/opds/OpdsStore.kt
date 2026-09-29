package com.jrmello4.tactilereader.opds

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import org.json.JSONArray
import org.json.JSONObject
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/** Servidores OPDS; credenciais cifradas com chave não exportável do Android Keystore. */
data class OpdsServer(
    val id: String = java.util.UUID.randomUUID().toString(),
    val name: String,
    val url: String,
    val user: String = "",
    val pass: String = "",
    val type: String = "opds",
)

object OpdsStore {
    private const val PREFS = "tactile-opds"
    private const val KEY = "servers"
    private const val KEY_ALIAS = "tactile-opds-credentials-v1"
    private const val TRANSFORMATION = "AES/GCM/NoPadding"
    private const val GCM_TAG_BITS = 128

    /** JVM-only seam; production always uses AndroidKeyStore. */
    @Volatile
    internal var testKeyProvider: (() -> SecretKey)? = null

    fun list(context: Context): List<OpdsServer> {
        val preferences = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val raw = preferences.getString(KEY, "[]") ?: "[]"
        val array = try {
            JSONArray(raw)
        } catch (_: org.json.JSONException) {
            return emptyList()
        }
        var foundLegacyCredentials = false
        val servers = List(array.length()) { index ->
            val item = array.getJSONObject(index)
            val encrypted = item.has("userEncrypted") || item.has("passEncrypted")
            if (!encrypted && (item.has("user") || item.has("pass"))) foundLegacyCredentials = true
            OpdsServer(
                id = item.optString("id", java.util.UUID.randomUUID().toString()),
                name = item.optString("name", "Servidor"),
                url = item.optString("url", ""),
                user = if (encrypted) decrypt(item.optString("userEncrypted", "")) else item.optString("user", ""),
                pass = if (encrypted) decrypt(item.optString("passEncrypted", "")) else item.optString("pass", ""),
                type = item.optString("type", "opds"),
            )
        }
        if (foundLegacyCredentials) save(context, servers)
        return servers
    }

    fun save(context: Context, servers: List<OpdsServer>) {
        val array = JSONArray()
        for (server in servers) {
            array.put(
                JSONObject()
                    .put("id", server.id)
                    .put("name", server.name)
                    .put("url", server.url)
                    .put("userEncrypted", encrypt(server.user))
                    .put("passEncrypted", encrypt(server.pass))
                    .put("type", server.type),
            )
        }
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit()
            .putString(KEY, array.toString())
            .apply()
    }

    private fun encrypt(value: String): String {
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.ENCRYPT_MODE, getOrCreateKey())
        val encrypted = cipher.doFinal(value.toByteArray(Charsets.UTF_8))
        return java.util.Base64.getEncoder().encodeToString(cipher.iv + encrypted)
    }

    private fun decrypt(encoded: String): String {
        if (encoded.isEmpty()) return ""
        return try {
            val payload = java.util.Base64.getDecoder().decode(encoded)
            require(payload.size > 12) { "Invalid encrypted OPDS credential" }
            val iv = payload.copyOfRange(0, 12)
            val ciphertext = payload.copyOfRange(12, payload.size)
            val cipher = Cipher.getInstance(TRANSFORMATION)
            cipher.init(Cipher.DECRYPT_MODE, getOrCreateKey(), GCMParameterSpec(GCM_TAG_BITS, iv))
            String(cipher.doFinal(ciphertext), Charsets.UTF_8)
        } catch (error: Exception) {
            throw IllegalStateException("Não foi possível decifrar as credenciais OPDS salvas.", error)
        }
    }

    private fun getOrCreateKey(): SecretKey {
        testKeyProvider?.invoke()?.let { return it }
        val keyStore = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (keyStore.getKey(KEY_ALIAS, null) as? SecretKey)?.let { return it }
        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        generator.init(
            KeyGenParameterSpec.Builder(
                KEY_ALIAS,
                KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
            )
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setRandomizedEncryptionRequired(true)
                .build(),
        )
        return generator.generateKey()
    }
}
