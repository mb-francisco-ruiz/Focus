package com.focus.android

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.ContextCompat
import com.focus.android.ui.FocusApp

class MainActivity : ComponentActivity() {
    private val notificationPermission = registerForActivityResult(
        ActivityResultContracts.RequestPermission(),
    ) {}

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        requestNotificationPermission()
        setContent {
            FocusApp(
                repository = (application as FocusApplication).repository,
                initialShareText = intent.shareText(),
                initialShareImage = intent.shareImage(),
                initialTaskId = intent.getStringExtra(EXTRA_TASK_ID),
            )
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
    }

    private fun requestNotificationPermission() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return
        val granted = ContextCompat.checkSelfPermission(
            this,
            Manifest.permission.POST_NOTIFICATIONS,
        ) == PackageManager.PERMISSION_GRANTED
        if (!granted) notificationPermission.launch(Manifest.permission.POST_NOTIFICATIONS)
    }

    private fun Intent.shareText(): String? =
        if (action == Intent.ACTION_SEND && type == "text/plain") {
            getStringExtra(Intent.EXTRA_TEXT)
        } else {
            null
        }

    private fun Intent.shareImage(): Uri? =
        if (action == Intent.ACTION_SEND && type?.startsWith("image/") == true) {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                getParcelableExtra(Intent.EXTRA_STREAM, Uri::class.java)
            } else {
                @Suppress("DEPRECATION")
                getParcelableExtra(Intent.EXTRA_STREAM)
            }
        } else {
            null
        }

    companion object {
        const val EXTRA_TASK_ID = "taskId"
    }
}
