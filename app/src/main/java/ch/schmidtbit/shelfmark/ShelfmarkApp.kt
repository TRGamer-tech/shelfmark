package ch.schmidtbit.shelfmark

import android.app.Application
import ch.schmidtbit.shelfmark.work.DailyCheckWorker
import ch.schmidtbit.shelfmark.work.Notifier

class ShelfmarkApp : Application() {
    /** Replaceable so tests can run against an in-memory database and a fake catalogue. */
    lateinit var container: AppContainer

    override fun onCreate() {
        super.onCreate()
        if (!::container.isInitialized) container = AppContainer(this)
        // The channel for news from friends is there from the start, also for a look in the background that finds some.
        runCatching { Notifier.prepare(this) }
        // A build that comes with a server looks at it in the background, for news from friends.
        if (BuildConfig.SERVER_URL.isNotBlank()) runCatching { DailyCheckWorker.schedule(this) }
    }
}
