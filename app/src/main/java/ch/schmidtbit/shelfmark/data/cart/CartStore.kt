package ch.schmidtbit.shelfmark.data.cart

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.encodeToJsonElement
import kotlinx.serialization.json.put
import java.io.File
import java.nio.file.Files
import java.nio.file.StandardCopyOption

/**
 * The book cart as it is kept on this phone: in a file of its own next to the database, so
 * that it survives leaving the screen and closing the app. It is not part of the library
 * that goes to the account, nor of a backup: what waits on the cart is not on the shelf yet.
 * A change is seen at once, and written to the file right after.
 */
class CartStore(private val file: File) {
    private val cartState: MutableStateFlow<Cart>
    private val straightState: MutableStateFlow<Boolean>
    private val writing = Mutex()

    init {
        val (cart, straight) = read()
        cartState = MutableStateFlow(cart)
        straightState = MutableStateFlow(straight)
    }

    val cart: StateFlow<Cart> = cartState.asStateFlow()

    /** Whether the scanner puts every book it finds straight onto the cart. The reader's choice on this phone, kept with the cart. */
    val straight: StateFlow<Boolean> = straightState.asStateFlow()

    /** Changes the cart and writes it down. Returns the cart as it is afterwards. */
    suspend fun change(edit: (Cart) -> Cart): Cart {
        val before = cartState.value
        cartState.update(edit)
        val after = cartState.value
        if (after != before) save()
        return after
    }

    suspend fun setStraight(on: Boolean) {
        if (straightState.value == on) return
        straightState.value = on
        save()
    }

    // Whatever the order in which changes come, the file ends with the latest of them.
    private suspend fun save() = withContext(Dispatchers.IO) {
        writing.withLock {
            val cart = cartState.value
            val straight = straightState.value
            runCatching {
                if (cart.items.isEmpty() && cart.forAll == CartSettings() && !straight) {
                    file.delete()
                } else {
                    val text = buildJsonObject {
                        put("forAll", json.encodeToJsonElement(cart.forAll))
                        put("items", json.encodeToJsonElement(cart.items))
                        put("straight", straight)
                    }.toString()
                    // Written next to it and then put in its place: a phone that switches off halfway leaves the old cart, not half a new one.
                    val next = File(file.path + ".new")
                    next.writeText(text)
                    Files.move(next.toPath(), file.toPath(), StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE)
                }
            }.onFailure { runCatching { android.util.Log.w("Shelfmark", "The book cart could not be written", it) } }
        }
    }

    /**
     * Reads the cart from its file. Whatever cannot be read is left out, entry by entry: a
     * damaged entry must not cost the reader the rest of the cart, and nothing that is no
     * book is ever shelved. A word this version does not know (a list from a newer one, say)
     * falls back to the usual one.
     */
    private fun read(): Pair<Cart, Boolean> {
        val root = runCatching { json.parseToJsonElement(file.readText()) as? JsonObject }.getOrNull() ?: return Cart() to false
        val forAll = runCatching { json.decodeFromJsonElement(CartSettings.serializer(), root.getValue("forAll")) }.getOrNull() ?: CartSettings()
        var cart = Cart(forAll = forAll.copy(listIds = forAll.listIds.distinct()))
        (root["items"] as? JsonArray)?.forEach { entry ->
            val item = runCatching { json.decodeFromJsonElement(CartItem.serializer(), entry) }.getOrNull() ?: return@forEach
            val before = cart.count
            cart = cart.put(item.book, item.own)
            if (cart.count > before && item.anyway) cart = cart.anyway(Cart.keyOf(item.book), true)
        }
        val straight = (root["straight"] as? JsonPrimitive)?.booleanOrNull ?: false
        return cart to straight
    }

    private companion object {
        val json = Json {
            ignoreUnknownKeys = true
            coerceInputValues = true
            encodeDefaults = true
        }
    }
}
