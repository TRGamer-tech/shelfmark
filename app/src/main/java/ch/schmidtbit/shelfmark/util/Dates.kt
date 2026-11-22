package ch.schmidtbit.shelfmark.util

import java.time.LocalDate
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import java.util.Locale

/** Reading dates are stored as epoch days so they are free of time zone surprises. */
object Dates {
    private const val DAY_MS = 86_400_000L

    fun today(): Long = LocalDate.now().toEpochDay()

    fun format(epochDay: Long?, locale: Locale = Locale.getDefault()): String =
        epochDay?.let {
            LocalDate.ofEpochDay(it).format(DateTimeFormatter.ofLocalizedDate(FormatStyle.MEDIUM).withLocale(locale))
        } ?: ""

    fun toUtcMillis(epochDay: Long): Long = epochDay * DAY_MS

    fun fromUtcMillis(millis: Long): Long = Math.floorDiv(millis, DAY_MS)

    fun yearOf(epochDay: Long): Int = LocalDate.ofEpochDay(epochDay).year
}
