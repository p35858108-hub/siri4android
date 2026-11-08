package com.assistant.siri

import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.service.voice.VoiceInteractionService
import android.service.voice.VoiceInteractionSession
import android.service.voice.VoiceInteractionSessionService
import android.speech.RecognitionService
import android.speech.SpeechRecognizer

/** Lo que Android enlaza cuando eres el asistente predeterminado. */
class SiriInteractionService : VoiceInteractionService()

class SiriSessionService : VoiceInteractionSessionService() {
    override fun onNewSession(args: Bundle?): VoiceInteractionSession = SiriSession(this)
}

/** Mantener pulsado Inicio / botón de encendido / gesto de esquina => onShow => abrimos la isla. */
class SiriSession(ctx: Context) : VoiceInteractionSession(ctx) {
    companion object { @Volatile var current: SiriSession? = null }

    override fun onCreate() { super.onCreate(); current = this }
    override fun onDestroy() { if (current === this) current = null; super.onDestroy() }

    override fun onShow(args: Bundle?, showFlags: Int) {
        super.onShow(args, showFlags)
        val i = Intent(context, AssistActivity::class.java)
        try {
            startAssistantActivity(i)
        } catch (e: Exception) {
            context.startActivity(i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        }
    }
}

/** Algunas versiones de Android exigen declarar un RecognitionService para listar el asistente. No hace nada. */
class SiriRecognitionService : RecognitionService() {
    override fun onStartListening(intent: Intent?, cb: Callback?) { cb?.error(SpeechRecognizer.ERROR_CLIENT) }
    override fun onCancel(cb: Callback?) {}
    override fun onStopListening(cb: Callback?) {}
}
