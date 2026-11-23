package ch.schmidtbit.shelfmark

import android.app.Application
import ch.schmidtbit.shelfmark.work.DailyCheckWorker

class ShelfmarkApp : Application() {
    /** Replaceable so tests can run against an in-memory database and a fake catalogue. */
    lateinit var container: AppContainer

    override fun onCreate() {
        super.onCreate()
        if (!::container.isInitialized) container = AppContainer(this)
        // A build that comes with a server checks in with it in the background.
        // (A server entered in the settings is scheduled from there.)
        if (BuildConfig.SERVER_URL.isNotBlank()) runCatching { DailyCheckWorker.schedule(this) }
    }
}
