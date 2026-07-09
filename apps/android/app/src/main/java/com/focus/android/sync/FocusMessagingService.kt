package com.focus.android.sync

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.core.app.NotificationCompat
import com.focus.android.FocusApplication
import com.focus.android.MainActivity
import com.focus.android.R
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch

class FocusMessagingService : FirebaseMessagingService() {
    override fun onNewToken(token: String) {
        super.onNewToken(token)
        CoroutineScope(Dispatchers.IO).launch {
            (application as FocusApplication).repository.registerDevice(token)
        }
    }

    override fun onMessageReceived(message: RemoteMessage) {
        super.onMessageReceived(message)
        val title = message.notification?.title ?: message.data["title"] ?: "Focus"
        val body = message.notification?.body ?: message.data["body"] ?: "New update"
        val taskId = message.data["taskId"]
        showNotification(title, body, taskId)
    }

    private fun showNotification(title: String, body: String, taskId: String?) {
        val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            manager.createNotificationChannel(
                NotificationChannel(CHANNEL_ID, "Focus", NotificationManager.IMPORTANCE_DEFAULT),
            )
        }
        val intent = Intent(this, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
            taskId?.let { putExtra(MainActivity.EXTRA_TASK_ID, it) }
        }
        val pending = PendingIntent.getActivity(
            this,
            taskId?.hashCode() ?: 0,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val notification = NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_launcher)
            .setContentTitle(title)
            .setContentText(body)
            .setAutoCancel(true)
            .setContentIntent(pending)
            .build()
        manager.notify((taskId ?: title).hashCode(), notification)
    }

    companion object {
        private const val CHANNEL_ID = "focus"
    }
}
