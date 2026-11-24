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
import kotlinx.coroutines.CancellationException
import java.util.concurrent.TimeUnit

/**
 * Runs twice a day when the phone is online: the check-in that keeps the server awake,
 * and, for those who are signed in, a look at the loans. What a friend did meanwhile and
 * a book that is due are said by the app's container, which hears of every such look.
 */
class DailyCheckWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result = try {
        check()
    } catch (e: CancellationException) {
        throw e
    } catch (e: Exception) {
        // Nobody is looking, and nothing here is worth more than the app staying up. The next run tries again.
        Result.success()
    }

    private suspend fun check(): Result {
        val app = applicationContext as? ShelfmarkApp ?: return Result.success()
        return when (val result = app.container.server.dailyCheck()) {
            is SyncResult.Done -> Result.success()
            is SyncResult.Failed -> if (result.reason == ServerSync.NETWORK) Result.retry() else Result.success()
            // A question for the user is asked when the app is open, not from the background.
            is SyncResult.Choose, SyncResult.Off -> Result.success()
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
