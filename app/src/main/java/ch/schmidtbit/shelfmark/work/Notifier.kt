package ch.schmidtbit.shelfmark.work

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import ch.schmidtbit.shelfmark.MainActivity
import ch.schmidtbit.shelfmark.R
import ch.schmidtbit.shelfmark.data.repo.SyncResult

/** Tells the user about a borrow request or an answer that arrived while the app was closed. */
object Notifier {
    const val CHANNEL = "friends"
    const val ACTION_OPEN_REQUESTS = "ch.schmidtbit.shelfmark.OPEN_REQUESTS"

    fun allowed(context: Context): Boolean =
        Build.VERSION.SDK_INT < 33 || ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED

    /** Returns how many notifications were shown. */
    fun announce(context: Context, news: SyncResult.Done): Int {
        if (news.requests.isEmpty() && news.answers.isEmpty()) return 0
        if (!allowed(context)) return 0
        val manager = context.getSystemService(NotificationManager::class.java) ?: return 0
        manager.createNotificationChannel(
            NotificationChannel(CHANNEL, context.getString(R.string.notify_channel), NotificationManager.IMPORTANCE_DEFAULT),
        )
        val open = PendingIntent.getActivity(
            context,
            0,
            Intent(context, MainActivity::class.java).setAction(ACTION_OPEN_REQUESTS).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        fun show(id: Int, title: String, text: String) {
            manager.notify(
                id,
                NotificationCompat.Builder(context, CHANNEL)
                    .setSmallIcon(R.drawable.ic_notification)
                    .setContentTitle(title)
                    .setContentText(text)
                    .setContentIntent(open)
                    .setAutoCancel(true)
                    .build(),
            )
        }
        news.requests.forEach { request ->
            val who = request.fromName.ifBlank { context.getString(R.string.friends_someone) }
            show(request.requestId.hashCode(), context.getString(R.string.notify_request_title, who), request.bookTitle)
        }
        news.answers.forEach { answer ->
            val who = answer.fromName.ifBlank { context.getString(R.string.friends_someone) }
            show(
                (answer.fromName + answer.bookTitle).hashCode(),
                context.getString(if (answer.accepted) R.string.notify_answer_yes else R.string.notify_answer_no, who),
                answer.bookTitle,
            )
        }
        return news.requests.size + news.answers.size
    }
}
