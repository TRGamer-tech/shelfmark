package ch.schmidtbit.shelfmark.ui

import android.content.Context
import android.content.Intent
import android.net.Uri

/** The pages of the website the app leads to. German readers get the German page. */
enum class WebsitePage(private val english: String, private val german: String) {
    HOME("", ""),
    PRIVACY("/privacy", "/de/datenschutz"),
    IMPRINT("/imprint", "/de/impressum");

    /** [website] is the address of the site without a slash at the end, [language] a code like "de". */
    fun address(website: String, language: String): String = website + if (language == "de") german else english
}

/** Opens a page of the website in the browser. Does nothing on a phone without one. */
fun openWebsite(context: Context, website: String, page: WebsitePage) {
    val language = context.resources.configuration.locales[0].language
    runCatching { context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(page.address(website, language))).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }
}
