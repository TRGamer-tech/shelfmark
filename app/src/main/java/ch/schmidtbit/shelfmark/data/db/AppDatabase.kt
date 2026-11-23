package ch.schmidtbit.shelfmark.data.db

import android.content.Context
import androidx.room.AutoMigration
import androidx.room.Database
import androidx.room.Room
import androidx.room.RoomDatabase
import ch.schmidtbit.shelfmark.data.model.Book
import ch.schmidtbit.shelfmark.data.model.BookShelf
import ch.schmidtbit.shelfmark.data.model.Friend
import ch.schmidtbit.shelfmark.data.model.FriendBook
import ch.schmidtbit.shelfmark.data.model.Goal
import ch.schmidtbit.shelfmark.data.model.LendRequest
import ch.schmidtbit.shelfmark.data.model.Note
import ch.schmidtbit.shelfmark.data.model.Ornament
import ch.schmidtbit.shelfmark.data.model.OutboxMessage
import ch.schmidtbit.shelfmark.data.model.Purchase
import ch.schmidtbit.shelfmark.data.model.ReadingSession
import ch.schmidtbit.shelfmark.data.model.Quote
import ch.schmidtbit.shelfmark.data.model.Shelf

@Database(
    entities = [
        Book::class, Shelf::class, BookShelf::class, Quote::class, ReadingSession::class, Note::class, Goal::class,
        Purchase::class, Ornament::class,
        Friend::class, FriendBook::class, LendRequest::class, OutboxMessage::class,
    ],
    // Every change to the tables gets a new version and a migration, so an update of the
    // app keeps the library. The schema of each version is kept in app/schemas.
    version = 3,
    autoMigrations = [AutoMigration(from = 1, to = 2), AutoMigration(from = 2, to = 3)],
    exportSchema = true,
)
abstract class AppDatabase : RoomDatabase() {
    abstract fun books(): BookDao
    abstract fun shelves(): ShelfDao
    abstract fun quotes(): QuoteDao
    abstract fun sessions(): SessionDao
    abstract fun notes(): NoteDao
    abstract fun goals(): GoalDao
    abstract fun purchases(): PurchaseDao
    abstract fun ornaments(): OrnamentDao
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
