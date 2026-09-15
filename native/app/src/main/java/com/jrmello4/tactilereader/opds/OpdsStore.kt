package com.jrmello4.tactilereader.opds

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject

/** Servidor remoto cadastrado pelo usuário. Credenciais ficam no sandbox privado do app. */
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

    fun list(context: Context): List<OpdsServer> {
        val raw = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY, "[]") ?: "[]"
        return try {
            val arr = JSONArray(raw)
            List(arr.length()) { i ->
                val o = arr.getJSONObject(i)
                OpdsServer(
                    id = o.optString("id", java.util.UUID.randomUUID().toString()),
                    name = o.optString("name", "Servidor"),
                    url = o.optString("url", ""),
                    user = o.optString("user", ""),
                    pass = o.optString("pass", ""),
                    type = o.optString("type", "opds"),
                )
            }
        } catch (_: Exception) {
            emptyList()
        }
    }

    fun save(context: Context, servers: List<OpdsServer>) {
        val arr = JSONArray()
        for (server in servers) {
            val o = JSONObject()
            o.put("id", server.id)
            o.put("name", server.name)
            o.put("url", server.url)
            o.put("user", server.user)
            o.put("pass", server.pass)
            o.put("type", server.type)
            arr.put(o)
        }
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(KEY, arr.toString()).apply()
    }
}
