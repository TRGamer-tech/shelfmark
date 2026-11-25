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
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
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
// until the swipe is through, and then the page below is simply there.

/** How long a page takes for the whole way. A swipe moves along it with the finger, letting go runs the rest. */
private const val BACK_SWIPE_MS = 260

/** How dark the page below is while the page above still covers all of it. */
const val BACK_VEIL = 0.32f

/**
 * Whether the change of page that NavHost is showing is one pulled by a swipe, with
 * something that moves. Set by the transitions as NavHost asks for them: it asks for the
 * ones of a swipe or for the ordinary ones, never for both. Not something the screens are
 * redrawn for, so it is no state.
 */
class BackSwipe {
    var revealing = false
}

/** How the page that is swiped away leaves. [swipeEdge] is the edge the finger came from. */
fun backSwipeExit(motion: Boolean, swipeEdge: Int): ExitTransition =
    if (motion) {
        // Evenly, so that the page is where the finger is. A finger from the right edge pushes it out to the left.
        slideOutHorizontally(tween(BACK_SWIPE_MS, easing = LinearEasing)) { width -> if (swipeEdge == NavigationEvent.EDGE_RIGHT) -width else width }
    } else {
        // It stays as it is for as long as the swipe lasts and is gone at its end: a plain cut.
        fadeOut(tween(BACK_SWIPE_MS, easing = LinearEasing), targetAlpha = 1f)
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
        val covered by transition.animateFloat(transitionSpec = { tween(BACK_SWIPE_MS, easing = LinearEasing) }, label = "veil") { state ->
            if (state == EnterExitState.PreEnter) 1f else 0f
        }
        if (swipe.revealing && covered > 0f) {
            Box(Modifier.matchParentSize().background(Color.Black.copy(alpha = BACK_VEIL * covered)).testTag("backVeil"))
        }
    }
}
