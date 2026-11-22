package ch.schmidtbit.shelfmark

import android.app.Application

class ShelfmarkApp : Application() {
    /** Replaceable so tests can run against an in-memory database and a fake catalogue. */
    lateinit var container: AppContainer

    override fun onCreate() {
        super.onCreate()
        if (!::container.isInitialized) container = AppContainer(this)
    }
}
