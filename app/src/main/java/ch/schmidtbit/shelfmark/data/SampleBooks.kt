package ch.schmidtbit.shelfmark.data

import ch.schmidtbit.shelfmark.data.model.Book
import ch.schmidtbit.shelfmark.data.model.BookFormat
import ch.schmidtbit.shelfmark.data.model.Ownership
import ch.schmidtbit.shelfmark.data.model.ReadingStatus

/** A handful of classics for trying the app out. They can be deleted like any other book. */
object SampleBooks {
    fun create(today: Long): List<Book> = listOf(
        Book(title = "Pride and Prejudice", authors = "Jane Austen", pageCount = 432, publishedYear = "1813", format = BookFormat.PAPERBACK,
            status = ReadingStatus.READ, rating = 4.5f, spice = 1, startedOn = today - 40, finishedOn = today - 31, currentPage = 432, readCount = 1, genres = "Classics, Romance"),
        Book(title = "Frankenstein", authors = "Mary Shelley", pageCount = 280, publishedYear = "1818", format = BookFormat.PAPERBACK,
            status = ReadingStatus.READ, rating = 4f, startedOn = today - 20, finishedOn = today - 12, currentPage = 280, readCount = 1, genres = "Classics, Horror"),
        Book(title = "Die Verwandlung", authors = "Franz Kafka", pageCount = 96, publishedYear = "1915", format = BookFormat.HARDCOVER,
            status = ReadingStatus.READ, rating = 5f, startedOn = today - 9, finishedOn = today - 8, currentPage = 96, readCount = 1, genres = "Klassiker"),
        Book(title = "Der Prozess", authors = "Franz Kafka", pageCount = 256, publishedYear = "1925", format = BookFormat.PAPERBACK,
            status = ReadingStatus.READING, startedOn = today - 3, currentPage = 120, genres = "Klassiker"),
        Book(title = "Faust", subtitle = "Der Tragödie erster Teil", authors = "Johann Wolfgang von Goethe", pageCount = 224, publishedYear = "1808", format = BookFormat.HARDCOVER,
            status = ReadingStatus.NONE, genres = "Klassiker, Drama"),
        Book(title = "Dracula", authors = "Bram Stoker", pageCount = 488, publishedYear = "1897", format = BookFormat.PAPERBACK,
            status = ReadingStatus.NONE, genres = "Classics, Horror"),
        Book(title = "Effi Briest", authors = "Theodor Fontane", pageCount = 336, publishedYear = "1895", format = BookFormat.PAPERBACK,
            status = ReadingStatus.READ, rating = 3.5f, startedOn = today - 70, finishedOn = today - 58, currentPage = 336, readCount = 1, genres = "Klassiker"),
        Book(title = "Moby Dick", authors = "Herman Melville", pageCount = 720, publishedYear = "1851", format = BookFormat.HARDCOVER,
            status = ReadingStatus.ABANDONED, startedOn = today - 100, currentPage = 140, genres = "Classics, Adventure"),
        Book(title = "Jane Eyre", authors = "Charlotte Brontë", pageCount = 592, publishedYear = "1847", format = BookFormat.PAPERBACK,
            status = ReadingStatus.WISHLIST, ownership = Ownership.NOT_OWNED, lendable = false, genres = "Classics, Romance"),
        Book(title = "Der Zauberberg", authors = "Thomas Mann", pageCount = 1008, publishedYear = "1924", format = BookFormat.HARDCOVER,
            status = ReadingStatus.WISHLIST, ownership = Ownership.NOT_OWNED, lendable = false, genres = "Klassiker"),
    )
}
