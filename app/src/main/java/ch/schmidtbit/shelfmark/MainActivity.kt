package ch.schmidtbit.shelfmark

import android.content.Intent
import android.os.Bundle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.appcompat.app.AppCompatActivity
import ch.schmidtbit.shelfmark.ui.ShelfmarkRoot
import kotlinx.coroutines.flow.MutableStateFlow

class MainActivity : AppCompatActivity() {
    /** The intent that still has to be looked at: a shared file, shared text, or nothing. */
    private val incoming = MutableStateFlow<Intent?>(null)

    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        // After a rotation the old intent has been handled already.
        if (savedInstanceState == null) incoming.value = intent
        setContent { ShelfmarkRoot((application as ShelfmarkApp).container, incoming) }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        incoming.value = intent
    }
}
