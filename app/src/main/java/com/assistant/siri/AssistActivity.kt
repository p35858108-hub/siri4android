package com.assistant.siri

import android.Manifest
import android.annotation.SuppressLint
import android.content.ComponentName
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Bundle as AndroidBundle
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import java.util.Locale
import android.content.pm.ApplicationInfo
import android.graphics.Color
import android.os.Build
import android.os.Bundle
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.webkit.JavascriptInterface
import android.webkit.WebView
import android.widget.FrameLayout
import androidx.core.view.WindowCompat
import org.json.JSONObject

/** Overlay translúcido: [WebView Gemini invisible] + [WebView de la isla de cristal encima]. */
class AssistActivity : android.app.Activity() {

    private lateinit var ui: WebView
    private var recognizer: SpeechRecognizer? = null

    @SuppressLint("SetJavaScriptEnabled", "ClickableViewAccessibility")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        WindowCompat.setDecorFitsSystemWindows(window, false)
        window.statusBarColor = Color.TRANSPARENT
        window.navigationBarColor = Color.TRANSPARENT
        if (Build.VERSION.SDK_INT >= 28) {
            window.attributes = window.attributes.also {
                it.layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES
            }
        }
        if (applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE != 0) WebView.setWebContentsDebuggingEnabled(true)

        val root = FrameLayout(this)

        // 1) Motor (Gemini): mismo WebView entre invocaciones, invisible y sin tocar
        val engine = Engine.get(this)
        (engine.parent as? ViewGroup)?.removeView(engine)
        engine.alpha = 0f
        root.addView(engine, FrameLayout.LayoutParams(-1, -1))

        // 2) Interfaz visual
        ui = WebView(this).apply {
            setBackgroundColor(Color.TRANSPARENT)
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.allowFileAccess = true
            overScrollMode = View.OVER_SCROLL_NEVER
            isVerticalScrollBarEnabled = false
            addJavascriptInterface(object {
                @JavascriptInterface fun send(text: String) = Engine.send(text)
                @JavascriptInterface fun close() { runOnUiThread { finish() } }
                @JavascriptInterface fun stopListening() { runOnUiThread { stopVoice() } }
                @JavascriptInterface fun openSearch(q: String) {
                    runOnUiThread {
                        startActivity(
                            Intent(Intent.ACTION_VIEW, Uri.parse("https://www.google.com/search?q=" + Uri.encode(q)))
                                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                        )
                        finish()
                    }
                }
            }, "Android")
            loadUrl("file:///android_asset/web/index.html")
        }
        root.addView(ui, FrameLayout.LayoutParams(-1, -1))
        setContentView(root)

        Engine.listener = { text, done, err ->
            ui.evaluateJavascript(
                "window.onAssistantChunk(${JSONObject.quote(text)},$done,${JSONObject.quote(err)})", null
            )
        }
        startVoice()
    }

    // ---------- Voz: con la cápsula sin expandir, lo que hables se transcribe y se envía ----------
    private fun js(code: String) = ui.evaluateJavascript(code, null)

    private fun startVoice() {
        if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(arrayOf(Manifest.permission.RECORD_AUDIO), 1); return
        }
        if (!SpeechRecognizer.isRecognitionAvailable(this)) return
        stopVoice()

        // Al ser asistente, Android puede poner NUESTRO RecognitionService (vacío) como reconocedor por defecto.
        // Por eso se prefiere explícitamente el de Google si existe.
        val google = ComponentName("com.google.android.googlequicksearchbox",
            "com.google.android.voicesearch.serviceapi.GoogleRecognitionService")
        val hasGoogle = try { packageManager.getServiceInfo(google, 0); true } catch (e: Exception) { false }
        val r = if (hasGoogle) SpeechRecognizer.createSpeechRecognizer(this, google)
                else SpeechRecognizer.createSpeechRecognizer(this)

        fun first(b: AndroidBundle?) =
            b?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull().orEmpty()

        r.setRecognitionListener(object : RecognitionListener {
            override fun onPartialResults(partial: AndroidBundle?) {
                val t = first(partial); if (t.isNotBlank()) js("window.onVoicePartial(${JSONObject.quote(t)})")
            }
            override fun onResults(results: AndroidBundle?) {
                val t = first(results)
                if (t.isNotBlank()) js("window.onVoiceFinal(${JSONObject.quote(t)})") else js("window.onVoiceEnd&&window.onVoiceEnd()")
            }
            override fun onError(error: Int) { js("window.onVoiceEnd&&window.onVoiceEnd()") }
            override fun onReadyForSpeech(params: AndroidBundle?) {}
            override fun onBeginningOfSpeech() {}
            override fun onRmsChanged(rmsdB: Float) {}
            override fun onBufferReceived(buffer: ByteArray?) {}
            override fun onEndOfSpeech() {}
            override fun onEvent(eventType: Int, params: AndroidBundle?) {}
        })
        r.startListening(Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
            putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
            putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
            putExtra(RecognizerIntent.EXTRA_LANGUAGE, Locale.getDefault().toLanguageTag())
        })
        recognizer = r
    }

    private fun stopVoice() {
        recognizer?.let { it.cancel(); it.destroy() }
        recognizer = null
    }

    override fun onRequestPermissionsResult(code: Int, perms: Array<out String>, res: IntArray) {
        super.onRequestPermissionsResult(code, perms, res)
        if (code == 1 && res.firstOrNull() == PackageManager.PERMISSION_GRANTED) startVoice()
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        stopVoice()
        ui.evaluateJavascript("window.siriReset && window.siriReset()", null)
        startVoice()
    }

    override fun onPause() { super.onPause(); android.webkit.CookieManager.getInstance().flush() }

    override fun onDestroy() {
        stopVoice()
        Engine.listener = null
        (ui.parent as? ViewGroup)?.removeView(ui); ui.destroy()
        Engine.get(this).let { (it.parent as? ViewGroup)?.removeView(it) }   // el motor sigue vivo, solo se desengancha
        SiriSession.current?.hide()
        super.onDestroy()
    }
}
