package com.focus.android.ui

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Bundle
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalContext
import androidx.core.content.ContextCompat
import java.util.Locale

enum class VoiceStage {
    Idle,
    Listening,
    Processing,
    Error,
}

data class VoiceCaptureState(
    val stage: VoiceStage,
    val message: String?,
    val start: () -> Unit,
    val stop: () -> Unit,
)

@Composable
fun rememberVoiceCapture(onTranscript: (String) -> Unit): VoiceCaptureState {
    val context = LocalContext.current
    val currentOnTranscript by rememberUpdatedState(onTranscript)
    var stage by remember { mutableStateOf(VoiceStage.Idle) }
    var message by remember { mutableStateOf<String?>(null) }

    val recognizer = remember {
        if (SpeechRecognizer.isRecognitionAvailable(context)) {
            SpeechRecognizer.createSpeechRecognizer(context)
        } else {
            null
        }
    }

    fun startListening() {
        val activeRecognizer = recognizer
        if (activeRecognizer == null) {
            stage = VoiceStage.Error
            message = "Voice recognition is not available on this device."
            return
        }
        message = null
        stage = VoiceStage.Listening
        activeRecognizer.startListening(
            Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
                putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
                putExtra(RecognizerIntent.EXTRA_LANGUAGE, Locale.getDefault().toLanguageTag())
                putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
                putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 3)
            },
        )
    }

    val permissionLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission(),
    ) { granted ->
        if (granted) {
            startListening()
        } else {
            stage = VoiceStage.Error
            message = "Microphone permission is required for voice capture."
        }
    }

    DisposableEffect(recognizer) {
        recognizer?.setRecognitionListener(
            object : RecognitionListener {
                override fun onReadyForSpeech(params: Bundle?) {
                    stage = VoiceStage.Listening
                }

                override fun onBeginningOfSpeech() {
                    stage = VoiceStage.Listening
                }

                override fun onRmsChanged(rmsdB: Float) = Unit
                override fun onBufferReceived(buffer: ByteArray?) = Unit

                override fun onEndOfSpeech() {
                    stage = VoiceStage.Processing
                }

                override fun onError(error: Int) {
                    stage = VoiceStage.Error
                    message = recognitionError(error)
                }

                override fun onResults(results: Bundle?) {
                    val transcript = results.bestTranscript()
                    if (transcript.isNullOrBlank()) {
                        stage = VoiceStage.Error
                        message = "I couldn't hear a task. Try again closer to the microphone."
                    } else {
                        currentOnTranscript(transcript)
                        stage = VoiceStage.Idle
                        message = "Transcript ready — review it before adding."
                    }
                }

                override fun onPartialResults(partialResults: Bundle?) {
                    partialResults.bestTranscript()?.takeIf { it.isNotBlank() }?.let(currentOnTranscript)
                }

                override fun onEvent(eventType: Int, params: Bundle?) = Unit
            },
        )
        onDispose {
            recognizer?.cancel()
            recognizer?.destroy()
        }
    }

    val start = {
        if (ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) {
            startListening()
        } else {
            permissionLauncher.launch(Manifest.permission.RECORD_AUDIO)
        }
    }
    val stop = {
        recognizer?.stopListening()
        stage = VoiceStage.Processing
    }

    return VoiceCaptureState(stage, message, start, stop)
}

private fun Bundle?.bestTranscript(): String? =
    this?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull()

private fun recognitionError(error: Int): String = when (error) {
    SpeechRecognizer.ERROR_AUDIO -> "The microphone couldn't capture audio."
    SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS -> "Microphone permission is required for voice capture."
    SpeechRecognizer.ERROR_NETWORK, SpeechRecognizer.ERROR_NETWORK_TIMEOUT -> "Voice recognition needs a working network connection."
    SpeechRecognizer.ERROR_NO_MATCH -> "I couldn't understand that. Tap MIC and try again."
    SpeechRecognizer.ERROR_RECOGNIZER_BUSY -> "Voice recognition is busy. Wait a moment and try again."
    SpeechRecognizer.ERROR_SPEECH_TIMEOUT -> "I didn't hear anything. Tap MIC when you're ready."
    else -> "Voice recognition stopped. Tap MIC to try again."
}
