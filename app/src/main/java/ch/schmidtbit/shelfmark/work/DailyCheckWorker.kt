package ch.schmidtbit.shelfmark.work

import android.content.Context
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import ch.schmidtbit.shelfmark.ShelfmarkApp
import ch.schmidtbit.shelfmark.data.repo.ServerSync
import ch.schmidtbit.shelfmark.data.repo.SyncResult
import java.util.concurrent.TimeUnit

/**
 * Runs twice a day when the phone is online: the check-in that keeps the server awake,
 * and, for those who are connected, a look whether a friend wrote.
 */
class DailyCheckWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result {
        val app = applicationContext as? ShelfmarkApp ?: return Result.success()
        return when (val result = app.container.server.dailyCheck()) {
            is SyncResult.Done -> {
                Notifier.announce(applicationContext, result)
                Result.success()
            }
            is SyncResult.Failed -> if (result.reason == ServerSync.NETWORK) Result.retry() else Result.success()
            SyncResult.Off -> Result.success()
        }
    }

    companion object {
        private const val NAME = "daily-check"

        fun schedule(context: Context) {
            val request = PeriodicWorkRequestBuilder<DailyCheckWorker>(12, TimeUnit.HOURS)
                .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
                .build()
            WorkManager.getInstance(context).enqueueUniquePeriodicWork(NAME, ExistingPeriodicWorkPolicy.KEEP, request)
        }
    }
}
