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
import ch.schmidtbit.shelfmark.ui.friends.loanDue
import ch.schmidtbit.shelfmark.ui.friends.loanPeer
import ch.schmidtbit.shelfmark.ui.friends.textRes
import ch.schmidtbit.shelfmark.util.Dates

/** Tells the reader what a friend did to a loan, and when a book that is out should be back. */
object Notifier {
    const val CHANNEL = "friends"
    const val ACTION_OPEN_LOANS = "ch.schmidtbit.shelfmark.OPEN_LOANS"

    fun allowed(context: Context): Boolean =
        Build.VERSION.SDK_INT < 33 || ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED

    /** Returns how many notifications were shown. */
    fun announce(context: Context, news: SyncResult.Done): Int {
        if (news.news.isEmpty() && news.due.isEmpty()) return 0
        if (!allowed(context)) return 0
        val manager = context.getSystemService(NotificationManager::class.java) ?: return 0
        manager.createNotificationChannel(
            NotificationChannel(CHANNEL, context.getString(R.string.notify_channel), NotificationManager.IMPORTANCE_DEFAULT),
        )
        val open = PendingIntent.getActivity(
            context,
            0,
            Intent(context, MainActivity::class.java).setAction(ACTION_OPEN_LOANS).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        fun show(id: Int, title: String, text: String?) {
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
        val resources = context.resources
        var shown = 0
        news.news.forEach { item ->
            // One notification per loan: the latest step takes the place of the one before.
            val id = item.loan.id.hashCode()
            val kind = item.kind
            if (kind == null) {
                // A tap was taken back. What the notification said is no longer so.
                manager.cancel(id)
            } else {
                val confirm = if (kind.asksForATap) context.getString(R.string.notify_loan_confirm) else null
                show(id, context.getString(kind.textRes(), loanPeer(resources, item.loan), item.loan.title), confirm)
                shown++
            }
        }
        news.due.forEach { loan ->
            val title = context.getString(if (loan.lender) R.string.notify_due_lender else R.string.notify_due_borrower, loanPeer(resources, loan), loan.title)
            // Not the notification of the loan's last step: a reminder stands next to it.
            show(("due:" + loan.id).hashCode(), title, loanDue(resources, loan, Dates.today())?.text)
            shown++
        }
        return shown
    }
}
