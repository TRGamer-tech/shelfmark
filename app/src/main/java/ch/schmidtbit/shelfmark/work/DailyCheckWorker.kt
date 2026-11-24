package ch.schmidtbit.shelfmark.work

import android.content.Context
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.PeriodicWorkRequest
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import ch.schmidtbit.shelfmark.ShelfmarkApp
import ch.schmidtbit.shelfmark.data.repo.ServerSync
import ch.schmidtbit.shelfmark.data.repo.SyncResult
import kotlinx.coroutines.CancellationException
import java.util.concurrent.TimeUnit

/**
 * The look at the server while the app is not open. There is no push service, so this is
 * how news gets to a phone that lies on the table: what a friend did to a loan, a book
 * that is due and somebody who joined are said by the app's container, which hears of
 * every such look.
 *
 * It is asked for every quarter of an hour, the shortest WorkManager allows, and only
 * with a network. When exactly it runs is Android's decision, not the app's: a phone that
 * is dozing or saving battery puts the runs off and bundles them, and an app that was not
 * opened for a long time gets fewer of them. Nothing here wakes the phone up for it. So
 * news is usually minutes late and can be much later.
 *
 * The sign of life that keeps a free server from being put to sleep rides along. It is
 * sent once a day however often this runs (see [ServerSync.dailyCheck]), which is where
 * the name of the class comes from. The name stays, because the work that phones already
 * have scheduled is stored under it.
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
        const val NAME = "daily-check"

        /** How often the look is asked for. Android allows no less. */
        const val EVERY_MINUTES = 15L

        fun request(): PeriodicWorkRequest = PeriodicWorkRequestBuilder<DailyCheckWorker>(EVERY_MINUTES, TimeUnit.MINUTES)
            .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
            .build()

        /**
         * Asks for the look, under the one name it always had. A phone that still has the look
         * of earlier versions scheduled, twice a day, gets this one in its place: the old one is
         * updated, not kept and not joined by a second one.
         */
        fun schedule(context: Context) {
            WorkManager.getInstance(context).enqueueUniquePeriodicWork(NAME, ExistingPeriodicWorkPolicy.UPDATE, request())
        }
    }
}
