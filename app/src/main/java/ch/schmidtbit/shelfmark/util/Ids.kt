package ch.schmidtbit.shelfmark.util

import java.util.concurrent.atomic.AtomicLong
import kotlin.random.Random

/**
 * Ids for new books, lists, quotes and so on. An account can be used on several phones
 * and on the website, each of which creates things while the others are not looking, so
 * simply counting up would give two different books the same number. An id is therefore
 * the moment it was made, in milliseconds, times a thousand, plus a random part: two
 * devices would have to create something in the very same millisecond and roll the same
 * number. The website makes its ids the same way. They stay small enough for JavaScript.
 */
object Ids {
    private val last = AtomicLong(0)

    fun next(): Long {
        while (true) {
            val candidate = System.currentTimeMillis() * 1000 + Random.nextInt(1000)
            val previous = last.get()
            // Never the same twice on one device, and never backwards.
            val id = maxOf(candidate, previous + 1)
            if (last.compareAndSet(previous, id)) return id
        }
    }
}
