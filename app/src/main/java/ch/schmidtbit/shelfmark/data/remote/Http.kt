package ch.schmidtbit.shelfmark.data.remote

import kotlinx.coroutines.delay
import kotlinx.coroutines.suspendCancellableCoroutine
import okhttp3.Call
import okhttp3.Callback
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import java.io.IOException
import java.net.URLEncoder
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

/**
 * Minimal GET abstraction so the catalogue clients can be tested without a network.
 * Returns the body for a 2xx answer, null for "not found", and throws [IOException] otherwise.
 */
fun interface HttpFetcher {
    suspend fun get(url: String): String?
}

class OkHttpFetcher(private val client: OkHttpClient, private val retries: Int = 2) : HttpFetcher {
    /** Connection hiccups are retried a couple of times, HTTP errors are not. */
    override suspend fun get(url: String): String? {
        var attempt = 0
        while (true) {
            try {
                return getOnce(url)
            } catch (e: HttpStatusException) {
                throw e
            } catch (e: IOException) {
                if (attempt >= retries) throw e
                attempt++
                delay(350L * attempt)
            }
        }
    }

    private suspend fun getOnce(url: String): String? = suspendCancellableCoroutine { cont ->
        val request = Request.Builder()
            .url(url)
            .header("User-Agent", USER_AGENT)
            .header("Accept", "application/json")
            .build()
        val call = client.newCall(request)
        cont.invokeOnCancellation { call.cancel() }
        call.enqueue(object : Callback {
            override fun onFailure(call: Call, e: IOException) {
                if (cont.isActive) cont.resumeWithException(e)
            }

            override fun onResponse(call: Call, response: Response) {
                response.use {
                    try {
                        when {
                            it.isSuccessful -> cont.resume(it.body.string())
                            it.code == 404 -> cont.resume(null)
                            else -> if (cont.isActive) cont.resumeWithException(HttpStatusException(it.code))
                        }
                    } catch (e: IOException) {
                        if (cont.isActive) cont.resumeWithException(e)
                    }
                }
            }
        })
    }

    companion object {
        const val USER_AGENT = "Shelfmark/1.0 (Android book catalogue app)"
    }
}

/** The server answered, but with an error status. */
class HttpStatusException(val code: Int) : IOException("HTTP $code")

internal fun enc(value: String): String = URLEncoder.encode(value, "UTF-8")
