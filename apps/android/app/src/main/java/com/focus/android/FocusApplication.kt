package com.focus.android

import android.app.Application
import androidx.work.Constraints
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import com.focus.android.data.ApiClient
import com.focus.android.data.FocusDatabase
import com.focus.android.data.FocusRepository
import com.focus.android.data.SessionStore
import com.focus.android.sync.ReplayCapturesWorker
import com.google.firebase.FirebaseApp
import com.google.firebase.messaging.FirebaseMessaging
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import java.util.concurrent.TimeUnit

class FocusApplication : Application() {
    private val appScope = CoroutineScope(SupervisorJob())
    lateinit var repository: FocusRepository
        private set

    override fun onCreate() {
        super.onCreate()
        val session = SessionStore(this)
        val api = ApiClient(session)
        repository = FocusRepository(session, FocusDatabase.get(this).dao(), api, appScope)
        repository.startRealtime()
        registerFirebaseTokenIfConfigured()
        scheduleReplayWorker()
    }

    private fun registerFirebaseTokenIfConfigured() {
        if (FirebaseApp.getApps(this).isEmpty()) return
        FirebaseMessaging.getInstance().token
            .addOnSuccessListener { token ->
                appScope.launch(Dispatchers.IO) { repository.registerDevice(token) }
            }
    }

    private fun scheduleReplayWorker() {
        val request = PeriodicWorkRequestBuilder<ReplayCapturesWorker>(15, TimeUnit.MINUTES)
            .setConstraints(
                Constraints.Builder()
                    .setRequiredNetworkType(NetworkType.CONNECTED)
                    .build(),
            )
            .build()
        WorkManager.getInstance(this).enqueueUniquePeriodicWork(
            ReplayCapturesWorker.WORK_NAME,
            ExistingPeriodicWorkPolicy.UPDATE,
            request,
        )
    }
}
