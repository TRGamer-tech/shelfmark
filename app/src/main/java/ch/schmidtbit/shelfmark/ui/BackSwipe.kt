package ch.schmidtbit.shelfmark.ui

import androidx.compose.animation.AnimatedContentScope
import androidx.compose.animation.EnterExitState
import androidx.compose.animation.EnterTransition
import androidx.compose.animation.ExitTransition
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.navigationevent.NavigationEvent

// Going back with a swipe from the edge of the screen. Android tells the app how far the
// finger has come, and NavHost shows the page that is left and the page below at the same
// time, as far along as the finger is. What it shows by itself, when nobody says otherwise,
// is the leaving page shrinking to 70 percent in the middle of the screen with the page
// below all around it, which reads as a card that came loose and not as going back.
//
// Here the page follows the finger sideways, from the edge the swipe began at, and uncovers
// the page below, which lies under a dark veil that lifts as the finger moves. Letting go
// early puts the page back, letting go late sends it off. Nothing is scaled, and nothing of
// the page stays behind. With movement switched off there is none: the page stands still
// until the swipe is through, and then the page below is simply there. The back button of
// the three-button bar is no swipe and changes the page the way every other step back does.

/** How long a page takes for the whole way. A swipe moves along it with the finger, letting go runs the rest. */
private const val BACK_SWIPE_MS = 260

/** How dark the page below is while the page above still covers all of it. */
const val BACK_VEIL = 0.32f

/** Where the page goes that a swipe takes away. */
enum class BackSwipeMove {
    /** Off to the right, after a finger that came from the left edge. */
    RIGHT,

    /** Off to the left, after a finger that came from the right edge. */
    LEFT,

    /** Nowhere: it is there until the swipe is through, then it is gone. */
    STILL,
}

/** How a page goes for a swipe that began at [swipeEdge] (a NavigationEvent edge), with movement switched on or off. */
fun backSwipeMove(motion: Boolean, swipeEdge: Int): BackSwipeMove = when {
    !motion -> BackSwipeMove.STILL
    swipeEdge == NavigationEvent.EDGE_RIGHT -> BackSwipeMove.LEFT
    // From the left edge, and from no edge at all: going back reads as going to the right.
    else -> BackSwipeMove.RIGHT
}

/**
 * Whether the change of page that NavHost is showing is pulled by a swipe and uncovers the
 * page below with something that moves. It is set when NavHost chooses how the page below
 * comes in: for a swipe or for any other change, never both. Not something the screens are
 * redrawn for, so it is no state: the page below reads it as it appears.
 */
class BackSwipe {
    var revealing = false
}

/** How the page that is swiped away leaves. */
fun backSwipeExit(move: BackSwipeMove): ExitTransition = when (move) {
    // Evenly, so that the page is where the finger is.
    BackSwipeMove.RIGHT -> slideOutHorizontally(tween(BACK_SWIPE_MS, easing = LinearEasing)) { width -> width }
    BackSwipeMove.LEFT -> slideOutHorizontally(tween(BACK_SWIPE_MS, easing = LinearEasing)) { width -> -width }
    // It stays as it is for as long as the swipe lasts and is gone at its end: a plain cut.
    BackSwipeMove.STILL -> fadeOut(tween(BACK_SWIPE_MS, easing = LinearEasing), targetAlpha = 1f)
}

/** How the page below comes: it does not come, it is there. The veil on it is drawn by [Revealed]. */
fun backSwipeEnter(): EnterTransition = fadeIn(tween(BACK_SWIPE_MS, easing = LinearEasing), initialAlpha = 1f)

/**
 * A page of the app as NavHost shows it. While a swipe uncovers it, a dark veil lies on it
 * that lifts as the page above moves away, and comes down again when the swipe is taken back.
 */
@Composable
fun AnimatedContentScope.Revealed(swipe: BackSwipe, content: @Composable () -> Unit) {
    Box(Modifier.fillMaxSize()) {
        content()
        // Only while this page is coming in, so the veil is no layer of its own the rest of the time.
        if (swipe.revealing && transition.currentState == EnterExitState.PreEnter && transition.targetState == EnterExitState.Visible) {
            val covered = transition.animateFloat(transitionSpec = { tween(BACK_SWIPE_MS, easing = LinearEasing) }, label = "veil") { state ->
                if (state == EnterExitState.PreEnter) 1f else 0f
            }
            // Read while drawing: the veil follows the finger frame by frame without the page being composed again.
            Box(Modifier.matchParentSize().drawBehind { drawRect(Color.Black.copy(alpha = BACK_VEIL * covered.value)) }.testTag("backVeil"))
        }
    }
}
