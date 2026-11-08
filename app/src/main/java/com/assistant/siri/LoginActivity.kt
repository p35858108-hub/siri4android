package com.assistant.siri

import android.annotation.SuppressLint
import android.app.Activity
import android.os.Bundle
import android.webkit.CookieManager
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.LinearLayout

/** WebView visible solo para iniciar sesión. Comparte cookies con el motor oculto. */
class LoginActivity : Activity() {
    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val web = WebView(this)
        Engine.configure(web, this)
        web.webViewClient = WebViewClient()
        web.loadUrl("https://accounts.google.com/ServiceLogin?continue=https%3A%2F%2Fgemini.google.com%2Fapp")

        val done = Button(this).apply {
            text = "Listo, ya he iniciado sesión"
            setOnClickListener {
                CookieManager.getInstance().flush()
                Engine.reload()
                finish()
            }
        }
        setContentView(LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            addView(web, LinearLayout.LayoutParams(-1, 0, 1f))
            addView(done, LinearLayout.LayoutParams(-1, -2))
        })
    }
}
