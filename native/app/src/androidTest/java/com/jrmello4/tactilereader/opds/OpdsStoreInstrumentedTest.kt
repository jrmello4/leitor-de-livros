package com.jrmello4.tactilereader.opds

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class OpdsStoreInstrumentedTest {
    @Test
    fun credentialsRoundTripThroughAndroidKeyStoreWithoutPlaintextPreferences() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        val preferences = context.getSharedPreferences("tactile-opds", Context.MODE_PRIVATE)
        preferences.edit().clear().commit()
        val server = OpdsServer(
            name = "Biblioteca de teste",
            url = "https://books.example/opds",
            user = "leitor-teste",
            pass = "segredo-de-teste",
        )

        try {
            OpdsStore.save(context, listOf(server))
            val stored = preferences.getString("servers", "")!!
            assertFalse(stored.contains(server.user))
            assertFalse(stored.contains(server.pass))
            assertEquals(listOf(server), OpdsStore.list(context))
        } finally {
            preferences.edit().clear().commit()
        }
    }
}
