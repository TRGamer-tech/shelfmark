package ch.schmidtbit.shelfmark.ui

import androidx.annotation.StringRes
import androidx.compose.runtime.Composable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.res.stringResource
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import ch.schmidtbit.shelfmark.AppContainer
import android.content.res.Resources
import ch.schmidtbit.shelfmark.R
import ch.schmidtbit.shelfmark.data.model.Away
import ch.schmidtbit.shelfmark.data.model.Book
import ch.schmidtbit.shelfmark.data.model.BookFormat
import ch.schmidtbit.shelfmark.data.model.Ownership
import ch.schmidtbit.shelfmark.data.model.ReadingStatus
import ch.schmidtbit.shelfmark.data.model.away
import ch.schmidtbit.shelfmark.data.repo.LoanBooks
import ch.schmidtbit.shelfmark.data.repo.SortOrder
import java.io.File

val LocalContainer = staticCompositionLocalOf<AppContainer> { error("AppContainer not provided") }

/** A ViewModel that gets the [AppContainer] handed to its constructor. */
@Composable
inline fun <reified VM : ViewModel> containerViewModel(key: String? = null, crossinline create: (AppContainer) -> VM): VM {
    val container = LocalContainer.current
    return viewModel(key = key, factory = viewModelFactory { initializer { create(container) } })
}

@StringRes
fun ReadingStatus.labelRes(): Int = when (this) {
    ReadingStatus.NONE -> R.string.status_unread
    ReadingStatus.WISHLIST -> R.string.status_wishlist
    ReadingStatus.READING -> R.string.status_reading
    ReadingStatus.READ -> R.string.status_read
    ReadingStatus.ABANDONED -> R.string.status_abandoned
}

@StringRes
fun BookFormat.labelRes(): Int = when (this) {
    BookFormat.UNKNOWN -> R.string.format_unknown
    BookFormat.HARDCOVER -> R.string.format_hardcover
    BookFormat.PAPERBACK -> R.string.format_paperback
    BookFormat.EBOOK -> R.string.format_ebook
    BookFormat.AUDIOBOOK -> R.string.format_audiobook
    BookFormat.OTHER -> R.string.format_other
}

@StringRes
fun Ownership.labelRes(): Int = when (this) {
    Ownership.OWNED -> R.string.ownership_owned
    Ownership.BORROWED -> R.string.ownership_borrowed
    Ownership.NOT_OWNED -> R.string.ownership_not_owned
}

@StringRes
fun SortOrder.labelRes(): Int = when (this) {
    SortOrder.ADDED -> R.string.sort_added
    SortOrder.TITLE -> R.string.sort_title
    SortOrder.AUTHOR -> R.string.sort_author
    SortOrder.RATING -> R.string.sort_rating
}

@Composable
fun ReadingStatus.label(): String = stringResource(labelRes())

/**
 * The words for a book that is away ("Lent to Bo", "Given back to Lena, not finished"), or
 * null for a book that is here. They stand next to the book where there is room, and a
 * screen reader hears them wherever the book is drawn see-through.
 */
fun awayWords(resources: Resources, book: Book): String? {
    // A book that names nobody, or a friend who never gave themselves a name (LoanBooks.NO_NAME), is "someone", as on the website.
    fun name(who: String) = who.trim().takeIf { it.isNotEmpty() && it != LoanBooks.NO_NAME } ?: resources.getString(R.string.friends_someone)
    return when (book.away) {
        Away.LENT -> resources.getString(R.string.book_away_lent, name(book.lentTo))
        Away.RETURNED -> resources.getString(R.string.book_away_returned, name(book.borrowedFrom))
        null -> null
    }
}

/** What Coil should load for a book: the user's own photo, where this phone has it, wins over the catalogue cover. */
@Composable
fun Book.coverModel(): Any? = coverModelOf(LocalContainer.current.covers.dir, this)

/**
 * What to show as the cover. A photo taken on this phone is a file here. On every other
 * device that file does not exist, and the photo comes from its address like any cover.
 */
fun coverModelOf(coverDir: File, book: Book): Any? {
    val photo = book.coverPath.takeIf { it.isNotBlank() }?.let { File(coverDir, it) }?.takeIf { it.exists() }
    return photo ?: book.coverUrl.takeIf { it.isNotBlank() }
}

/** 4.5 is shown as "4.5", 4.0 as "4". */
fun formatRating(rating: Float): String = when {
    // What is no number is shown as what it is stored as: nothing.
    !rating.isFinite() -> "0"
    rating % 1f == 0f -> rating.toInt().toString()
    else -> String.format(java.util.Locale.getDefault(), "%.1f", rating)
}
