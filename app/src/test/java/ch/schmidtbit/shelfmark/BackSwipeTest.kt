package ch.schmidtbit.shelfmark

import androidx.navigationevent.NavigationEvent
import ch.schmidtbit.shelfmark.ui.BackSwipeMove
import ch.schmidtbit.shelfmark.ui.backSwipeMove
import org.junit.Assert.assertEquals
import org.junit.Test

/** Which way a page goes that is swiped back, with movement on and off (see BackSwipe.kt and the swipes in AppFlowTest). */
class BackSwipeTest {
    @Test fun withMovementThePageFollowsTheFingerAwayFromTheEdgeItCameFrom() {
        assertEquals(BackSwipeMove.RIGHT, backSwipeMove(motion = true, swipeEdge = NavigationEvent.EDGE_LEFT))
        assertEquals(BackSwipeMove.LEFT, backSwipeMove(motion = true, swipeEdge = NavigationEvent.EDGE_RIGHT))
        // A swipe that names no edge still reads as going back.
        assertEquals(BackSwipeMove.RIGHT, backSwipeMove(motion = true, swipeEdge = NavigationEvent.EDGE_NONE))
    }

    @Test fun withoutMovementThePageStandsStillFromWhicheverEdge() {
        listOf(NavigationEvent.EDGE_LEFT, NavigationEvent.EDGE_RIGHT, NavigationEvent.EDGE_NONE).forEach { edge ->
            assertEquals(BackSwipeMove.STILL, backSwipeMove(motion = false, swipeEdge = edge))
        }
    }
}
