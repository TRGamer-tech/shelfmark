package ch.schmidtbit.shelfmark.work

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.provider.Settings
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import ch.schmidtbit.shelfmark.MainActivity
import ch.schmidtbit.shelfmark.R
import ch.schmidtbit.shelfmark.data.repo.SyncResult
import ch.schmidtbit.shelfmark.ui.friends.loanDue
import ch.schmidtbit.shelfmark.ui.friends.loanPeer
import ch.schmidtbit.shelfmark.ui.friends.textRes
import ch.schmidtbit.shelfmark.util.Dates

/**
 * Tells the reader what a friend did: a step of a loan, a book that should be back, and
 * somebody who became a friend by typing in the reader's code.
 */
object Notifier {
    const val CHANNEL = "friends"
    const val ACTION_OPEN_LOANS = "ch.schmidtbit.shelfmark.OPEN_LOANS"
    const val ACTION_OPEN_FRIENDS = "ch.schmidtbit.shelfmark.OPEN_FRIENDS"

    /** What keeps notifications from being shown, and with it what the reader can do about it. */
    enum class Block {
        /** Nothing does. */
        NONE,

        /** Only the permission is missing, and Android still shows its question for it. */
        ASK,

        /** They are switched off where only the system settings switch them on again. */
        SETTINGS,
    }

    /**
     * Makes the channel the notifications go through. Done when the app starts and again
     * before every notification: it costs nothing once the channel is there, and without
     * it Android drops a notification without a word. Having it from the start also puts
     * it into the system settings before the first piece of news.
     */
    fun prepare(context: Context) {
        val manager = context.getSystemService(NotificationManager::class.java) ?: return
        manager.createNotificationChannel(NotificationChannel(CHANNEL, context.getString(R.string.notify_channel), NotificationManager.IMPORTANCE_DEFAULT))
    }

    /** The permission that Android 13 and newer ask for. Older versions have none. */
    fun allowed(context: Context): Boolean =
        Build.VERSION.SDK_INT < 33 || ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED

    /**
     * Whether a notification posted now would be seen: the permission is there, the app's
     * notifications are not switched off in the system settings, and neither is its channel.
     */
    fun canShow(context: Context): Boolean {
        if (!allowed(context)) return false
        val system = NotificationManagerCompat.from(context)
        if (!system.areNotificationsEnabled()) return false
        // A channel that was not made yet is made switched on.
        return system.getNotificationChannel(CHANNEL)?.let { it.importance != NotificationManager.IMPORTANCE_NONE } ?: true
    }

    /**
     * What stands in the way. [noDialog] says that Android was asked for the permission
     * and answered no without showing its question, which is what it does once somebody
     * said no twice.
     */
    fun block(context: Context, noDialog: Boolean): Block = when {
        canShow(context) -> Block.NONE
        Build.VERSION.SDK_INT >= 33 && !allowed(context) && !noDialog -> Block.ASK
        else -> Block.SETTINGS
    }

    /** Opens the page of the system settings where the app's notifications are switched on. */
    fun settingsIntent(context: Context): Intent =
        Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, context.packageName).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)

    /** Returns how many notifications were shown. */
    fun announce(context: Context, news: SyncResult.Done): Int {
        if (!news.tells) return 0
        val manager = context.getSystemService(NotificationManager::class.java) ?: return 0
        prepare(context)
        // Without the permission, or with the notifications switched off, Android would take them and show nothing.
        if (!canShow(context)) return 0

        // Each kind of news opens the place it is about. The two intents differ in their action,
        // so Android keeps them apart, and a tap finds the app whether it is open, in the back or closed.
        fun opens(action: String): PendingIntent = PendingIntent.getActivity(
            context,
            0,
            Intent(context, MainActivity::class.java).setAction(action).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        var shown = 0
        fun show(id: Int, title: String, text: String?, open: PendingIntent) {
            val notification = NotificationCompat.Builder(context, CHANNEL)
                .setSmallIcon(R.drawable.ic_notification)
                .setContentTitle(title)
                .setContentText(text)
                // Pulled down, a text that is longer than the notification is wide can be read to its end.
                .apply { if (text != null) setStyle(NotificationCompat.BigTextStyle().bigText(text)) }
                .setContentIntent(open)
                .setAutoCancel(true)
                .build()
            // The permission can be taken away between the look at it and this line. That is no reason to stop a sync.
            if (runCatching { manager.notify(id, notification) }.isSuccess) shown++
        }
        val resources = context.resources
        val loans = opens(ACTION_OPEN_LOANS)
        news.news.forEach { item ->
            // One notification per loan: the latest step takes the place of the one before.
            // Two loans that moved in the same sync are two notifications.
            val id = item.loan.id.hashCode()
            val kind = item.kind
            if (kind == null) {
                // A tap was taken back. What the notification said is no longer so.
                manager.cancel(id)
            } else {
                val confirm = if (kind.asksForATap) context.getString(R.string.notify_loan_confirm) else null
                show(id, context.getString(kind.textRes(), loanPeer(resources, item.loan), item.loan.title), confirm, loans)
            }
        }
        news.due.forEach { loan ->
            val title = context.getString(if (loan.lender) R.string.notify_due_lender else R.string.notify_due_borrower, loanPeer(resources, loan), loan.title)
            // Not the notification of the loan's last step: a reminder stands next to it.
            show(("due:" + loan.id).hashCode(), title, loanDue(resources, loan, Dates.today())?.text, loans)
        }
        val friends = opens(ACTION_OPEN_FRIENDS)
        news.joined.forEach { friend ->
            // One per friend. The reader was not asked, so the text says where to undo it.
            val name = friend.name.ifBlank { context.getString(R.string.friends_someone) }
            show(("friend:" + friend.id).hashCode(), context.getString(R.string.notify_friend_joined, name), context.getString(R.string.notify_friend_joined_text), friends)
        }
        return shown
    }
}
