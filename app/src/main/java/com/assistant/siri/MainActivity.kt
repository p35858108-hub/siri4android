package com.assistant.siri

import android.app.Activity
import android.app.role.RoleManager
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.view.Gravity
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView

/** Pantalla de configuración mínima: login, elegir asistente, probar. */
class MainActivity : Activity() {

    private lateinit var status: TextView

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val d = resources.displayMetrics.density
        fun dp(v: Int) = (v * d).toInt()

        val col = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(24), dp(48), dp(24), dp(24))
            gravity = Gravity.CENTER_HORIZONTAL
        }
        status = TextView(this).apply { textSize = 15f; setPadding(0, 0, 0, dp(24)) }
        col.addView(status)

        fun button(label: String, onClick: () -> Unit) = col.addView(
            Button(this).apply { text = label; setOnClickListener { onClick() } },
            LinearLayout.LayoutParams(-1, -2).apply { bottomMargin = dp(12) }
        )

        button("1. Iniciar sesión en Google") { startActivity(Intent(this, LoginActivity::class.java)) }
        button("2. Elegir como asistente predeterminado") {
            try { startActivity(Intent(Settings.ACTION_VOICE_INPUT_SETTINGS)) }
            catch (e: Exception) { startActivity(Intent(Settings.ACTION_SETTINGS)) }
        }
        button("3. Probar la interfaz") { startActivity(Intent(this, AssistActivity::class.java)) }

        setContentView(ScrollView(this).apply { addView(col) })
        if (checkSelfPermission(android.Manifest.permission.RECORD_AUDIO) != android.content.pm.PackageManager.PERMISSION_GRANTED)
            requestPermissions(arrayOf(android.Manifest.permission.RECORD_AUDIO), 1)
        Engine.get(this)   // precarga Gemini para que la primera pregunta sea rápida
    }

    override fun onResume() {
        super.onResume()
        val isAssistant = if (Build.VERSION.SDK_INT >= 29)
            getSystemService(RoleManager::class.java).isRoleHeld(RoleManager.ROLE_ASSISTANT) else false
        status.text = if (isAssistant) "✔ Esta app es el asistente predeterminado."
                      else "Aún no eres el asistente predeterminado (paso 2)."
    }
}
