package ch.schmidtbit.shelfmark.data.db

import android.content.Context
import androidx.room.Database
import androidx.room.Room
import androidx.room.RoomDatabase
import ch.schmidtbit.shelfmark.data.model.Book
import ch.schmidtbit.shelfmark.data.model.BookShelf
import ch.schmidtbit.shelfmark.data.model.Friend
import ch.schmidtbit.shelfmark.data.model.FriendBook
import ch.schmidtbit.shelfmark.data.model.LendRequest
import ch.schmidtbit.shelfmark.data.model.Quote
import ch.schmidtbit.shelfmark.data.model.Shelf

@Database(
    entities = [Book::class, Shelf::class, BookShelf::class, Quote::class, Friend::class, FriendBook::class, LendRequest::class],
    version = 1,
    exportSchema = true,
)
abstract class AppDatabase : RoomDatabase() {
    abstract fun books(): BookDao
    abstract fun shelves(): ShelfDao
    abstract fun quotes(): QuoteDao
    abstract fun social(): SocialDao

    companion object {
        fun create(context: Context): AppDatabase =
            Room.databaseBuilder(context.applicationContext, AppDatabase::class.java, "shelfmark.db").build()

        fun inMemory(context: Context): AppDatabase =
            Room.inMemoryDatabaseBuilder(context.applicationContext, AppDatabase::class.java)
                .allowMainThreadQueries()
                .build()
    }
}
