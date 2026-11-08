package com.cheddar.care.sleep;

/*
 * Service structure adapted from DeltaSleep (https://github.com/ntufar/DeltaSleep),
 * app/.../service/SleepTrackingService.kt, app/.../audio/AudioCapture.kt
 * MIT License · Copyright (c) 2026 Nicolai Tufar
 */

import android.app.AlarmManager;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.ServiceInfo;
import android.media.AudioFormat;
import android.media.AudioRecord;
import android.media.MediaRecorder;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;
import android.util.Log;
import androidx.core.app.NotificationCompat;
import androidx.core.app.ServiceCompat;
import androidx.core.content.ContextCompat;
import com.cheddar.care.R;
import java.time.ZoneId;

/**
 * '매일 밤 자동 수면 측정' 서비스. 홈 팝업의 [허용](또는 설정 토글)으로 한 번 켜면 계속 떠 있다.
 *
 * 마이크는 '밤(저녁 8시~낮 12시) + 휴대폰 화면이 꺼져 있을 때'만 켠다(SleepAuto).
 * - 화면 꺼짐 → 그 밤의 측정을 시작하거나(첫 번째) 이어서 잰다
 * - 화면 켜짐 → 폰을 쓰는 중 = 깨어 있음. 마이크를 멈추고, 그 시간은 나중에 '깸' 칸으로 채운다
 * - 아침 첫 잠금 해제(5시 이후·3시간 넘게 잰 뒤) 또는 낮 12시 이후 → 그 밤 측정 끝, 결과 계산
 * 읽은 소리는 다음 읽기에 덮어써져 어디에도 남지 않는다. 남는 건 30초 판정뿐.
 *
 * 왜 계속 떠 있나: Android 14 이상은 백그라운드에서 마이크 서비스를 '새로 시작'하지 못하게 한다.
 * 앱 화면에서 켠 서비스가 살아 있으면 밤에 다시 마이크를 쓸 수 있다. 시스템이 서비스를 죽이거나
 * 재부팅되면 앱을 한 번 열어야 다시 켜진다(SleepBootReceiver 안내 알림 + 앱 열 때 ensureAuto).
 * 마이크가 2초 연속 완전 무음이면(권한 회수·마이크 사용 불가) 그 밤은 끊김으로 끝내고 다시 켜 달라고 알린다.
 */
public class SleepRecordService extends Service {

    public static final String ACTION_ARM = "com.cheddar.care.sleep.ARM";
    public static final String ACTION_NIGHT_START = "com.cheddar.care.sleep.NIGHT_START";
    public static final String ACTION_STOP = "com.cheddar.care.sleep.STOP";
    public static final String ACTION_AUTO_OFF = "com.cheddar.care.sleep.AUTO_OFF";

    private static final String TAG = "SleepRecordService";
    static final String CHANNEL_ID = "sleep_measure";
    static final int NOTIFICATION_ID = 4201;
    private static final int SILENT_FRAME_LIMIT = 200;                       // 2초
    private static final long WAKE_LOCK_TIMEOUT_MS = 17L * 60 * 60 * 1000;   // 안전장치

    private enum StopReason { PAUSE, END, MIC_FAILED }

    private static volatile boolean running;    // 서비스가 떠 있음(자동 측정 켜짐)
    private static volatile boolean recording;  // 지금 마이크로 재는 중

    public static boolean isRunning() {
        return running;
    }

    public static boolean isRecording() {
        return recording;
    }

    private final Handler main = new Handler(Looper.getMainLooper());
    private volatile boolean stopRequested;
    private volatile StopReason stopReason = StopReason.END;
    private boolean endAfterStop;          // 녹음이 멈추면 그 밤을 끝낼지(아니면 잠시 멈춤)
    private Thread worker;
    private PowerManager.WakeLock wakeLock;
    private long sessionStartMs;
    private long pausedAtMs;               // 화면이 켜져 멈춘 시각(0 = 멈춤 아님)
    private BroadcastReceiver screenReceiver;

    private SleepSessionStore store() {
        return SleepSessionStore.get(this);
    }

    private static ZoneId zone() {
        return ZoneId.systemDefault();
    }

    // ───────────────────────── 명령 ─────────────────────────

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String action = intent != null ? intent.getAction() : null;
        if (action == null) {
            // 시스템이 죽였다 살린 경우 — 다시 대기해 본다(Android 14+ 는 막힐 수 있어 그땐 안내 알림)
            if (store().isAutoEnabled() && enterForeground()) {
                arm();
                return START_STICKY;
            }
            if (store().isAutoEnabled()) SleepBootReceiver.postRearmNotification(this);
            stopSelf();
            return START_NOT_STICKY;
        }
        switch (action) {
            case ACTION_ARM:
                if (enterForeground()) arm();
                break;
            case ACTION_NIGHT_START:
                if (!running) {
                    stopSelf(); // 대기 서비스가 없는데 남은 알람 — 마이크를 못 쓰니 닫는다
                    break;
                }
                scheduleNightStart();
                checkScreenNow();
                break;
            case ACTION_STOP:
                endSession(true);
                break;
            case ACTION_AUTO_OFF:
                store().setAuto(false, SleepAuto.NIGHT_START_MINUTE);
                endSession(true);
                shutdown();
                break;
            default:
                break;
        }
        return store().isAutoEnabled() ? START_STICKY : START_NOT_STICKY;
    }

    /** 포그라운드(마이크 유형)로 올라간다. 이미 올라가 있으면 true. 실패하면 false. */
    private boolean enterForeground() {
        if (running) return true;
        try {
            int type = Build.VERSION.SDK_INT >= Build.VERSION_CODES.R ? ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE : 0;
            ServiceCompat.startForeground(this, NOTIFICATION_ID, buildNotification(), type);
            running = true;
            return true;
        } catch (Exception e) {
            // 마이크 권한 없음·백그라운드 시작 금지(Android 14+) 등
            Log.e(TAG, "포그라운드 시작 실패", e);
            stopSelf();
            return false;
        }
    }

    private void arm() {
        registerScreenReceiver();
        // 앱이 꺼져 있던 사이 남은 측정(서비스가 새로 떴는데 보관함은 '측정 중')이 있으면 이어서 쓴다
        if (store().isActive() && sessionStartMs == 0) sessionStartMs = store().startedAt();
        scheduleNightStart();
        checkScreenNow();
        refreshNotification();
    }

    // ───────────────────────── 화면 꺼짐/켜짐 ─────────────────────────

    private void registerScreenReceiver() {
        if (screenReceiver != null) return;
        screenReceiver = new BroadcastReceiver() {
            @Override
            public void onReceive(Context context, Intent intent) {
                String a = intent.getAction();
                if (Intent.ACTION_SCREEN_OFF.equals(a)) onScreenOff();
                else if (Intent.ACTION_SCREEN_ON.equals(a)) onScreenOn();
                else if (Intent.ACTION_USER_PRESENT.equals(a)) onUnlock();
            }
        };
        IntentFilter f = new IntentFilter();
        f.addAction(Intent.ACTION_SCREEN_OFF);
        f.addAction(Intent.ACTION_SCREEN_ON);
        f.addAction(Intent.ACTION_USER_PRESENT);
        // 시스템 방송만 받으므로 다른 앱에 열 필요 없음
        ContextCompat.registerReceiver(this, screenReceiver, f, ContextCompat.RECEIVER_NOT_EXPORTED);
    }

    private void unregisterScreenReceiver() {
        if (screenReceiver == null) return;
        try {
            unregisterReceiver(screenReceiver);
        } catch (IllegalArgumentException ignored) {
            // 이미 해제됨
        }
        screenReceiver = null;
    }

    private void checkScreenNow() {
        PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
        if (pm != null && !pm.isInteractive()) onScreenOff();
    }

    private void onScreenOff() {
        if (!running || !store().isAutoEnabled()) return;
        long now = System.currentTimeMillis();
        if (store().isActive()) {
            if (sessionStartMs == 0) sessionStartMs = store().startedAt();
            if (SleepAuto.pastHardEnd(sessionStartMs, now, zone())) {
                endSession(true);
                return;
            }
            if (!recording) resumeMic(now);
        } else if (SleepAuto.shouldStartSession(now, store().lastFinishedAt(), zone())) {
            sessionStartMs = now;
            store().beginSession(now);
            startMic();
        }
    }

    private void onScreenOn() {
        if (recording) pauseMic();
    }

    private void onUnlock() {
        if (!store().isActive()) return;
        if (sessionStartMs == 0) sessionStartMs = store().startedAt();
        if (SleepAuto.shouldEndOnUnlock(sessionStartMs, System.currentTimeMillis(), zone())) {
            Log.i(TAG, "아침 잠금 해제 — 그 밤 측정 끝");
            endSession(true);
        }
    }

    // ───────────────────────── 마이크 ─────────────────────────

    private void startMic() {
        if (recording) return;
        recording = true;
        stopRequested = false;
        endAfterStop = false;

        PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
        if (pm != null) {
            if (wakeLock == null) {
                wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "cheddar:sleep-measure");
                wakeLock.setReferenceCounted(false);
            }
            wakeLock.acquire(WAKE_LOCK_TIMEOUT_MS);
        }
        // 녹음 중엔 CPU 가 깨어 있어 일반 타이머로 낮 12시 종료를 건다
        main.removeCallbacks(hardEnd);
        main.postDelayed(hardEnd, Math.max(0, SleepAuto.hardEndMs(sessionStartMs, zone()) - System.currentTimeMillis()));
        refreshNotification();

        worker = new Thread(this::recordLoop, "cheddar-sleep-rec");
        worker.start();
    }

    private void pauseMic() {
        pausedAtMs = System.currentTimeMillis();
        stopReason = StopReason.PAUSE;
        stopRequested = true;
    }

    private void resumeMic(long now) {
        if (pausedAtMs > 0) {
            for (Epoch e : SleepAuto.awakeFill(pausedAtMs, now)) store().appendEpoch(e);
            pausedAtMs = 0;
        }
        startMic();
    }

    private final Runnable hardEnd = () -> {
        if (store().isActive()) {
            Log.i(TAG, "낮 12시 — 그 밤 측정 끝");
            endSession(true);
        }
    };

    private void recordLoop() {
        AudioRecord rec = null;
        StopReason reason = StopReason.END;
        try {
            int minBuf = AudioRecord.getMinBufferSize(SleepAnalyzer.SAMPLE_RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT);
            int bufBytes = Math.max(minBuf, SleepAnalyzer.FRAME_SAMPLES * 2 * 20);
            rec = new AudioRecord(MediaRecorder.AudioSource.VOICE_RECOGNITION, SleepAnalyzer.SAMPLE_RATE,
                AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT, bufBytes);
            if (rec.getState() != AudioRecord.STATE_INITIALIZED) throw new IllegalStateException("AudioRecord 초기화 실패");
            rec.startRecording();

            SleepAnalyzer analyzer = new SleepAnalyzer();
            short[] frame = new short[SleepAnalyzer.FRAME_SAMPLES];
            int filled = 0;
            int silentFrames = 0;

            while (!stopRequested) {
                int n = rec.read(frame, filled, frame.length - filled);
                if (n < 0) throw new IllegalStateException("AudioRecord.read 오류 " + n);
                filled += n;
                if (filled < frame.length) continue;
                filled = 0;

                boolean allZero = true;
                for (short s : frame) if (s != 0) { allZero = false; break; }
                silentFrames = allZero ? silentFrames + 1 : 0;
                if (silentFrames >= SILENT_FRAME_LIMIT) {
                    Log.w(TAG, "2초 연속 무음 — 마이크를 쓸 수 없음");
                    break;
                }

                Epoch e = analyzer.process(frame, System.currentTimeMillis());
                if (e != null) store().appendEpoch(e);
            }
            reason = stopRequested ? stopReason : StopReason.MIC_FAILED;
        } catch (Throwable t) {
            Log.e(TAG, "녹음 중단", t);
            reason = StopReason.MIC_FAILED;
        } finally {
            if (rec != null) {
                try { rec.stop(); } catch (Exception ignored) { /* 이미 멈춤 */ }
                rec.release();
            }
            StopReason r = reason;
            main.post(() -> onMicStopped(r));
        }
    }

    private void onMicStopped(StopReason reason) {
        recording = false;
        main.removeCallbacks(hardEnd);
        if (wakeLock != null && wakeLock.isHeld()) wakeLock.release();

        if (reason == StopReason.MIC_FAILED) {
            finishSessionNow(false);
            // 이 상태로는 밤에 마이크를 다시 못 쓸 수 있어 서비스를 내리고, 앱을 한 번 열어 달라고 알린다
            SleepBootReceiver.postRearmNotification(this);
            shutdown();
            return;
        }
        if (reason == StopReason.END || endAfterStop) {
            finishSessionNow(true);
            return;
        }
        refreshNotification(); // 잠시 멈춤
    }

    /** 그 밤 측정을 끝낸다. 녹음 중이면 멈춘 뒤에 마무리된다. */
    private void endSession(boolean normal) {
        if (recording) {
            endAfterStop = true;
            stopReason = StopReason.END;
            stopRequested = true;
        } else {
            finishSessionNow(normal);
        }
    }

    private void finishSessionNow(boolean normal) {
        if (store().isActive()) store().finishSession(normal);
        sessionStartMs = 0;
        pausedAtMs = 0;
        endAfterStop = false;
        refreshNotification();
    }

    private void shutdown() {
        cancelNightAlarm();
        unregisterScreenReceiver();
        main.removeCallbacks(hardEnd);
        running = false;
        ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE);
        stopSelf();
    }

    // ───────────────────────── 밤 시작 알람 ─────────────────────────

    /**
     * 저녁 8시에 화면이 이미 꺼져 있는 경우를 위한 알람(화면이 켜져 있으면 꺼질 때 시작된다).
     * 정확한 알람 권한 없이 쓰는 알람은 '멀리 예약할수록 늦게 울려도 되는' 규칙이라(남은 시간의 최대 75%
     * 지연 — 2026-11-08 A9 Pro 실측), 남은 시간의 1/4 지점에 중간 알람을 걸고 울릴 때마다 다시 가까이 건다.
     */
    private void scheduleNightStart() {
        if (!store().isAutoEnabled()) return;
        long now = System.currentTimeMillis();
        long target = SleepAuto.nextNightStartMs(now, zone());
        long remaining = target - now;
        long trigger = remaining > 20 * 60_000L ? now + remaining / 4 : target;
        AlarmManager am = (AlarmManager) getSystemService(Context.ALARM_SERVICE);
        if (am != null) am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, trigger, nightAlarmIntent());
    }

    private PendingIntent nightAlarmIntent() {
        Intent i = new Intent(this, SleepRecordService.class).setAction(ACTION_NIGHT_START);
        return PendingIntent.getService(this, 1, i, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }

    private void cancelNightAlarm() {
        AlarmManager am = (AlarmManager) getSystemService(Context.ALARM_SERVICE);
        if (am != null) am.cancel(nightAlarmIntent());
    }

    // ───────────────────────── 생명주기 ─────────────────────────

    @Override
    public void onDestroy() {
        stopRequested = true;
        Thread w = worker;
        if (w != null && w != Thread.currentThread()) {
            try { w.join(3000); } catch (InterruptedException ignored) { Thread.currentThread().interrupt(); }
        }
        unregisterScreenReceiver();
        main.removeCallbacks(hardEnd);
        if (wakeLock != null && wakeLock.isHeld()) wakeLock.release();
        running = false;
        recording = false;
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    // ───────────────────────── 알림 ─────────────────────────

    static void ensureChannel(Context ctx) {
        NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm != null && nm.getNotificationChannel(CHANNEL_ID) == null) {
            NotificationChannel ch = new NotificationChannel(CHANNEL_ID, "수면 측정", NotificationManager.IMPORTANCE_LOW);
            ch.setDescription("수면 자동 기록 상태를 알려요. 소리는 저장하지 않아요.");
            ch.setShowBadge(false);
            nm.createNotificationChannel(ch);
        }
    }

    static PendingIntent openAppIntent(Context ctx) {
        Intent open = ctx.getPackageManager().getLaunchIntentForPackage(ctx.getPackageName());
        return open == null ? null
            : PendingIntent.getActivity(ctx, 0, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }

    private void refreshNotification() {
        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm != null && running) nm.notify(NOTIFICATION_ID, buildNotification());
    }

    private Notification buildNotification() {
        ensureChannel(this);
        NotificationCompat.Builder b = new NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_cheddar)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setShowWhen(false)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .setContentIntent(openAppIntent(this));

        String title;
        String text;
        if (store().isActive()) {
            Intent stop = new Intent(this, SleepRecordService.class).setAction(ACTION_STOP);
            PendingIntent stopPi = PendingIntent.getService(this, 3, stop, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
            title = "수면 측정 중";
            text = recording
                ? "소리는 저장하지 않고 휴대폰 안에서만 분석해요. 아침에 잠금을 풀면 자동으로 끝나요"
                : "화면이 켜져 있는 동안은 잠시 멈춰요. 아침에 잠금을 풀면 자동으로 끝나요";
            b.addAction(0, "오늘 측정 끝내기", stopPi);
        } else {
            Intent off = new Intent(this, SleepRecordService.class).setAction(ACTION_AUTO_OFF);
            PendingIntent offPi = PendingIntent.getService(this, 4, off, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
            title = "수면 자동 기록 켜짐";
            text = "밤에 휴대폰 화면이 꺼져 있을 때만 소리로 재요. 소리는 저장하지 않아요";
            b.addAction(0, "자동 기록 끄기", offPi);
        }
        return b.setContentTitle(title)
            .setContentText(text)
            .setStyle(new NotificationCompat.BigTextStyle().bigText(text))
            .build();
    }
}
