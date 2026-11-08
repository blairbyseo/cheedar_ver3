package com.cheddar.care.sleep;

/*
 * Service structure adapted from DeltaSleep (https://github.com/ntufar/DeltaSleep),
 * app/.../service/SleepTrackingService.kt, app/.../audio/AudioCapture.kt
 * MIT License · Copyright (c) 2026 Nicolai Tufar
 */

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.media.AudioFormat;
import android.media.AudioRecord;
import android.media.MediaRecorder;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;
import android.util.Log;
import androidx.core.app.NotificationCompat;
import androidx.core.app.ServiceCompat;
import com.cheddar.care.R;

/**
 * 녹음 서비스. "수면 측정 중" 알림을 띄운 채 밤새 마이크를 읽는다.
 *
 * - 시작(ACTION_START)·멈춤(ACTION_STOP)은 요청 창구(SleepSoundPlugin)와 알림의 '측정 끝내기' 버튼이 보낸다.
 * - 전용 스레드에서 0.01초(160샘플)씩 읽어 SleepAnalyzer 에 넣고, 30초 판정이 나오면 보관함에 저장한다.
 *   읽은 소리는 다음 읽기에 덮어써져 어디에도 남지 않는다.
 * - 시스템이 서비스를 죽였다 살려도(intent 없음) 다시 녹음하지 않는다. Android 14 이상은 백그라운드에서
 *   시작된 서비스의 마이크 사용을 막는다. 남은 기록은 다음에 앱을 열 때 '끊김'으로 마무리된다.
 * - 마이크에서 2초 연속 완전 무음(권한 회수 등)이면 끊김으로 끝낸다(DeltaSleep SILENT_FRAME_LIMIT).
 */
public class SleepRecordService extends Service {

    public static final String ACTION_START = "com.cheddar.care.sleep.START";
    public static final String ACTION_STOP = "com.cheddar.care.sleep.STOP";

    private static final String TAG = "SleepRecordService";
    private static final String CHANNEL_ID = "sleep_measure";
    private static final int NOTIFICATION_ID = 4201;
    private static final int SILENT_FRAME_LIMIT = 200;              // 2초
    private static final long WAKE_LOCK_TIMEOUT_MS = 14L * 60 * 60 * 1000; // 안전장치: 최대 14시간

    private static volatile boolean running;

    public static boolean isRunning() {
        return running;
    }

    private volatile boolean stopRequested;
    private Thread worker;
    private PowerManager.WakeLock wakeLock;

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String action = intent != null ? intent.getAction() : null;
        if (ACTION_START.equals(action)) {
            begin();
        } else if (ACTION_STOP.equals(action)) {
            if (running) {
                stopRequested = true;
            } else {
                // 서비스는 없는데 보관함만 '측정 중'으로 남은 경우까지 정리
                SleepSessionStore.get(this).finishSession(true);
                stopSelf();
            }
        } else {
            stopSelf();
        }
        return START_NOT_STICKY;
    }

    private void begin() {
        if (running) return;
        try {
            int type = Build.VERSION.SDK_INT >= Build.VERSION_CODES.R ? ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE : 0;
            ServiceCompat.startForeground(this, NOTIFICATION_ID, buildNotification(), type);
        } catch (Exception e) {
            // 권한 없음·백그라운드 시작 금지 등 — 측정을 시작하지 못함
            Log.e(TAG, "포그라운드 시작 실패", e);
            SleepSessionStore.get(this).finishSession(false);
            stopSelf();
            return;
        }
        running = true;
        stopRequested = false;

        PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
        if (pm != null) {
            wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "cheddar:sleep-measure");
            wakeLock.setReferenceCounted(false);
            wakeLock.acquire(WAKE_LOCK_TIMEOUT_MS);
        }

        worker = new Thread(this::recordLoop, "cheddar-sleep-rec");
        worker.start();
    }

    private void recordLoop() {
        boolean normal = false;
        AudioRecord rec = null;
        try {
            int minBuf = AudioRecord.getMinBufferSize(SleepAnalyzer.SAMPLE_RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT);
            int bufBytes = Math.max(minBuf, SleepAnalyzer.FRAME_SAMPLES * 2 * 20);
            rec = new AudioRecord(MediaRecorder.AudioSource.VOICE_RECOGNITION, SleepAnalyzer.SAMPLE_RATE,
                AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT, bufBytes);
            if (rec.getState() != AudioRecord.STATE_INITIALIZED) throw new IllegalStateException("AudioRecord 초기화 실패");
            rec.startRecording();

            SleepAnalyzer analyzer = new SleepAnalyzer();
            SleepSessionStore store = SleepSessionStore.get(this);
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
                if (e != null) store.appendEpoch(e);
            }
            normal = stopRequested;
        } catch (Throwable t) {
            Log.e(TAG, "녹음 중단", t);
        } finally {
            if (rec != null) {
                try { rec.stop(); } catch (Exception ignored) { /* 이미 멈춤 */ }
                rec.release();
            }
            finish(normal);
        }
    }

    private void finish(boolean normal) {
        running = false;
        if (wakeLock != null && wakeLock.isHeld()) wakeLock.release();
        SleepSessionStore.get(this).finishSession(normal);
        ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE);
        stopSelf();
    }

    @Override
    public void onDestroy() {
        stopRequested = true;
        Thread w = worker;
        if (w != null && w != Thread.currentThread()) {
            try { w.join(3000); } catch (InterruptedException ignored) { Thread.currentThread().interrupt(); }
        }
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    private Notification buildNotification() {
        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm != null && nm.getNotificationChannel(CHANNEL_ID) == null) {
            NotificationChannel ch = new NotificationChannel(CHANNEL_ID, "수면 측정", NotificationManager.IMPORTANCE_LOW);
            ch.setDescription("수면 측정 중임을 알려요. 소리는 저장하지 않아요.");
            ch.setShowBadge(false);
            nm.createNotificationChannel(ch);
        }

        Intent open = getPackageManager().getLaunchIntentForPackage(getPackageName());
        PendingIntent openPi = open == null ? null
            : PendingIntent.getActivity(this, 0, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        Intent stop = new Intent(this, SleepRecordService.class).setAction(ACTION_STOP);
        PendingIntent stopPi = PendingIntent.getService(this, 1, stop, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);

        return new NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_cheddar)
            .setContentTitle("수면 측정 중")
            .setContentText("소리는 저장하지 않고 휴대폰 안에서만 분석해요")
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .setContentIntent(openPi)
            .addAction(0, "측정 끝내기", stopPi)
            .build();
    }
}
