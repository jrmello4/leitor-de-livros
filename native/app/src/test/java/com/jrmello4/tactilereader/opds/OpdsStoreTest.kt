package com.jrmello4.tactilereader.opds

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.After
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import javax.crypto.spec.SecretKeySpec

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class OpdsStoreTest {
    private val context get() = RuntimeEnvironment.getApplication()

    @Before
    fun setUp() {
        OpdsStore.testKeyProvider = { SecretKeySpec(ByteArray(32) { (it + 1).toByte() }, "AES") }
        context.getSharedPreferences("tactile-opds", 0).edit().clear().commit()
    }

    @After
    fun tearDown() {
        OpdsStore.testKeyProvider = null
        context.getSharedPreferences("tactile-opds", 0).edit().clear().commit()
    }

    @Test
    fun credentialsAreEncryptedInPreferencesAndRoundTripThroughKeystore() {
        context.getSharedPreferences("tactile-opds", 0).edit().clear().commit()
        val server = OpdsServer(name = "Minha biblioteca", url = "https://books.example/opds", user = "leitor", pass = "senha-secreta")

        OpdsStore.save(context, listOf(server))

        val stored = context.getSharedPreferences("tactile-opds", 0).getString("servers", "")!!
        assertFalse(stored.contains("leitor"))
        assertFalse(stored.contains("senha-secreta"))
        assertTrue(stored.contains("userEncrypted"))
        assertEquals(listOf(server), OpdsStore.list(context))
    }

    @Test
    fun plaintextCredentialsAreMigratedWhenLegacyServerListIsRead() {
        val preferences = context.getSharedPreferences("tactile-opds", 0)
        preferences.edit()
            .putString(
                "servers",
                """[{"id":"legacy","name":"Legada","url":"https://books.example","user":"antigo","pass":"senha-antiga","type":"opds"}]""",
            )
            .commit()

        val server = OpdsStore.list(context).single()

        assertEquals("antigo", server.user)
        assertEquals("senha-antiga", server.pass)
        val stored = preferences.getString("servers", "")!!
        assertFalse(stored.contains("senha-antiga"))
        assertTrue(stored.contains("passEncrypted"))
    }
}
