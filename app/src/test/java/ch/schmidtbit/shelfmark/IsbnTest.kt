package ch.schmidtbit.shelfmark

import ch.schmidtbit.shelfmark.util.Isbn
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class IsbnTest {
    @Test fun validIsbn13() {
        assertTrue(Isbn.isValid("978-3-257-22953-0"))
        assertTrue(Isbn.isValid13("9780441172719"))
        assertFalse(Isbn.isValid13("9780441172718"))
    }

    @Test fun validIsbn10IncludingX() {
        assertTrue(Isbn.isValid("3257229534"))
        assertTrue(Isbn.isValid("0-8044-2957-X"))
        assertFalse(Isbn.isValid("3257229535"))
    }

    @Test fun convertsIsbn10To13() {
        assertEquals("9783257229530", Isbn.to13("3-257-22953-4"))
        assertEquals("9780804429573", Isbn.to13("080442957X"))
        assertEquals("9780441172719", Isbn.to13("9780441172719"))
        assertNull(Isbn.to13("12345"))
    }

    @Test fun bookEanNeedsBooklandPrefix() {
        assertTrue(Isbn.isBookEan("9783257229530"))
        assertTrue(Isbn.isBookEan("9791032305690"))
        // A valid EAN-13 from a cereal box is not a book.
        assertFalse(Isbn.isBookEan("4006381333931"))
    }
}
