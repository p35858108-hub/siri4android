package com.assistant.siri

import android.annotation.SuppressLint
import android.content.Context
import android.os.Handler
import android.os.Looper
import android.webkit.CookieManager
import android.webkit.JavascriptInterface
import android.webkit.WebChromeClient
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import org.json.JSONObject

/**
 * WebView oculto y único (sobrevive a las Activities) que mantiene abierta la web de Gemini.
 * Cookies + DOM storage persistentes => la sesión de Google no se pierde.
 */
object Engine {
    // Cambia aquí si prefieres otra URL (p. ej. https://www.google.com/ai)
    const val URL = "https://gemini.google.com/app"

    private val main = Handler(Looper.getMainLooper())
    private var web: WebView? = null
    private var ready = false
    private var pending: String? = null
    private var bridgeJs: String? = null

    /** (texto, terminado, códigoDeError) -> lo recibe la interfaz visual */
    @Volatile var listener: ((String, Boolean, String) -> Unit)? = null

    /** UA tipo Chrome móvil (sin "; wv" ni "Version/x.y"): Google es menos hostil al login así. */
    fun chromeUa(ctx: Context): String =
        WebSettings.getDefaultUserAgent(ctx).replace("; wv", "").replace(Regex(" Version/\\d+\\.\\d+"), "")

    fun configure(wv: WebView, ctx: Context) {
        val s = wv.settings
        s.javaScriptEnabled = true
        s.domStorageEnabled = true            // requisito: sesión persistente
        s.databaseEnabled = true
        s.mediaPlaybackRequiresUserGesture = true
        s.userAgentString = chromeUa(ctx)
        CookieManager.getInstance().apply {
            setAcceptCookie(true)
            setAcceptThirdPartyCookies(wv, true)
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    fun get(ctx: Context): WebView {
        web?.let { return it }
        val app = ctx.applicationContext
        val wv = WebView(app)
        configure(wv, app)
        bridgeJs = app.assets.open("gemini_bridge.js").bufferedReader().use { it.readText() }

        wv.addJavascriptInterface(object {
            @JavascriptInterface
            fun onResponse(text: String, done: Boolean, error: String) {
                main.post { listener?.invoke(text, done, error) }
            }
        }, "SiriBridge")

        wv.webChromeClient = WebChromeClient()
        wv.webViewClient = object : WebViewClient() {
            override fun onPageFinished(view: WebView, url: String?) {
                CookieManager.getInstance().flush()
                view.evaluateJavascript(bridgeJs!!, null)
                ready = true
                pending?.let { p -> pending = null; run(p) }
            }
        }
        web = wv
        wv.loadUrl(URL)
        return wv
    }

    fun reload() { ready = false; web?.loadUrl(URL) }

    fun send(text: String) {
        main.post { if (ready) run(text) else pending = text }
    }

    private fun run(text: String) {
        web?.evaluateJavascript("window.__siriSend(${JSONObject.quote(text)})", null)
    }
}
