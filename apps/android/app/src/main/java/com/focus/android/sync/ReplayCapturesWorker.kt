package com.focus.android.sync

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import com.focus.android.FocusApplication

class ReplayCapturesWorker(
    context: Context,
    params: WorkerParameters,
) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result {
        val app = applicationContext as FocusApplication
        return runCatching {
            app.repository.replayPendingCaptures()
            app.repository.refresh()
            Result.success()
        }.getOrElse { Result.retry() }
    }

    companion object {
        const val WORK_NAME = "replay-pending-captures"
    }
}
