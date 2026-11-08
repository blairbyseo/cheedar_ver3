package com.cheddar.care.sleep;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.app.NotificationManager;
import androidx.core.app.NotificationCompat;
import com.cheddar.care.R;

/**
 * 재부팅·앱 업데이트 뒤 '매일 밤 자동 수면 측정'을 다시 켜 달라는 알림.
 *
 * 안드로이드는 부팅 직후 앱이 마이크 서비스를 시작하지 못하게 한다(Android 15+ 명시적 금지).
 * 그래서 서비스를 직접 켜지 않고 알림만 띄운다 — 누르면 앱이 열리고, 앱이 열릴 때 다시 켜진다
 * (SleepSoundPlugin.ensureAuto). 사용자가 그 전에 Cheddar 를 열어도 똑같이 다시 켜진다.
 */
public class SleepBootReceiver extends BroadcastReceiver {

    private static final int REARM_NOTIFICATION_ID = 4202;

    @Override
    public void onReceive(Context context, Intent intent) {
        String a = intent != null ? intent.getAction() : null;
        if (!Intent.ACTION_BOOT_COMPLETED.equals(a) && !Intent.ACTION_MY_PACKAGE_REPLACED.equals(a)) return;
        if (SleepSessionStore.get(context).isAutoEnabled()) postRearmNotification(context);
    }

    static void postRearmNotification(Context context) {
        SleepRecordService.ensureChannel(context);
        NotificationManager nm = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null) return;
        nm.notify(REARM_NOTIFICATION_ID, new NotificationCompat.Builder(context, SleepRecordService.CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_cheddar)
            .setContentTitle("자동 수면 측정이 잠시 멈췄어요")
            .setContentText("눌러서 Cheddar 를 열면 오늘 밤부터 다시 재요")
            .setAutoCancel(true)
            .setContentIntent(SleepRecordService.openAppIntent(context))
            .build());
    }

    static void clearRearmNotification(Context context) {
        NotificationManager nm = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm != null) nm.cancel(REARM_NOTIFICATION_ID);
    }
}
