package com.cheddar.care.sleep;

import android.content.Context;
import android.content.SharedPreferences;
import android.util.Log;
import java.io.BufferedReader;
import java.io.File;
import java.io.FileOutputStream;
import java.io.FileReader;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * 측정 기록 보관함. 녹음 서비스와 요청 창구(플러그인)가 함께 쓴다.
 *
 * - 진행 상태: SharedPreferences "cheddar_sleep" (측정 중인 세션 id·시작 시각·칸 수)
 * - 30초 판정 기록: filesDir/sleep/&lt;sessionId&gt;.log — 한 줄씩 덧붙이고 매번 닫는다.
 *   앱이 갑자기 꺼져도 그때까지의 기록은 남는다. 소리는 들어 있지 않다.
 * - 측정이 끝나면 바로 요약(NightSummary)을 만들어 '보낼 결과' 목록에 넣고 기록 파일은 지운다.
 *   서버에 보내고 나면 markUploaded 로 목록에서 뺀다.
 *
 * 모든 메서드는 synchronized — 녹음 스레드와 플러그인 스레드가 동시에 부를 수 있다.
 */
public final class SleepSessionStore {

    private static final String TAG = "SleepSessionStore";
    private static final String PREFS = "cheddar_sleep";
    private static final String K_SESSION = "session_id";
    private static final String K_STARTED = "started_at";
    private static final String K_EPOCHS = "epoch_count";
    private static final String K_PENDING = "pending";
    private static final int MAX_PENDING = 14;

    /** 측정이 끝났을 때(정상·끊김 모두) 알림. result 는 5분 연속 잠이 없으면 null. */
    public interface FinishListener {
        void onFinished(NightSummary.Result result, boolean normal);
    }

    private static SleepSessionStore instance;

    public static synchronized SleepSessionStore get(Context context) {
        if (instance == null) instance = new SleepSessionStore(context.getApplicationContext());
        return instance;
    }

    private final Context context;
    private final SharedPreferences prefs;
    private volatile FinishListener listener;

    private SleepSessionStore(Context context) {
        this.context = context;
        this.prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    public void setFinishListener(FinishListener l) {
        this.listener = l;
    }

    // ───────── 진행 상태 ─────────

    public synchronized boolean isActive() {
        return prefs.getString(K_SESSION, null) != null;
    }

    public synchronized String sessionId() {
        return prefs.getString(K_SESSION, null);
    }

    public synchronized long startedAt() {
        return prefs.getLong(K_STARTED, 0L);
    }

    public synchronized int epochCount() {
        return prefs.getInt(K_EPOCHS, 0);
    }

    /** 새 측정 시작. 이미 측정 중이면 그 세션 id 를 그대로 돌려준다. */
    public synchronized String beginSession(long nowMs) {
        String current = prefs.getString(K_SESSION, null);
        if (current != null) return current;
        String id = "s" + nowMs;
        File dir = dir();
        if (!dir.exists() && !dir.mkdirs()) Log.w(TAG, "sleep 폴더 생성 실패");
        prefs.edit().putString(K_SESSION, id).putLong(K_STARTED, nowMs).putInt(K_EPOCHS, 0).commit();
        return id;
    }

    /** 30초 판정 한 줄 저장. */
    public synchronized void appendEpoch(Epoch e) {
        String id = prefs.getString(K_SESSION, null);
        if (id == null) return;
        // 시작 버튼보다 먼저 시작된 30초 칸은 버린다 — 이전 측정의 녹음이 이어지던 중에 새 측정이
        // 시작된 경우 등(2026-11-08 실기기에서 첫 칸이 시작 20초 전으로 잡힌 문제)
        long epochStart = e.endMs - NightSummary.EPOCH_SECONDS * 1000L;
        if (epochStart < prefs.getLong(K_STARTED, 0L) - 1000L) {
            Log.w(TAG, "측정 시작 전부터 쌓인 칸이라 버림");
            return;
        }
        try (FileOutputStream out = new FileOutputStream(logFile(id), true)) {
            out.write((e.toLine() + "\n").getBytes(StandardCharsets.UTF_8));
        } catch (IOException ex) {
            Log.e(TAG, "기록 저장 실패", ex);
            return;
        }
        prefs.edit().putInt(K_EPOCHS, prefs.getInt(K_EPOCHS, 0) + 1).apply();
    }

    /**
     * 측정 끝. 기록으로 요약을 만들어 '보낼 결과'에 넣고, 기록 파일을 지우고, 진행 상태를 비운다.
     * normal=false 는 멈춤 버튼 없이 끝난 경우(시스템 종료·마이크 문제).
     */
    public NightSummary.Result finishSession(boolean normal) {
        NightSummary.Result result;
        synchronized (this) {
            String id = prefs.getString(K_SESSION, null);
            if (id == null) return null;
            File log = logFile(id);
            result = NightSummary.compute(id, readEpochs(log), !normal, ZoneId.systemDefault());
            if (result != null) addPending(result);
            if (log.exists() && !log.delete()) Log.w(TAG, "기록 파일 삭제 실패: " + log);
            prefs.edit().remove(K_SESSION).remove(K_STARTED).remove(K_EPOCHS)
                .putLong(K_LAST_FINISHED, System.currentTimeMillis()).commit();
        }
        FinishListener l = listener;
        if (l != null) l.onFinished(result, normal);
        return result;
    }

    // ───────── 매일 밤 자동 측정 설정 ─────────

    private static final String K_AUTO = "auto_enabled";
    private static final String K_AUTO_START = "auto_start_minute";
    private static final String K_LAST_FINISHED = "last_finished_at";

    /** 마지막으로 측정이 끝난 시각(멈춤·자동 종료·끊김 모두). 같은 밤에 다시 자동 시작하지 않는 데 쓴다. */
    public synchronized long lastFinishedAt() {
        return prefs.getLong(K_LAST_FINISHED, 0L);
    }

    public synchronized boolean isAutoEnabled() {
        return prefs.getBoolean(K_AUTO, false);
    }

    /** 자동 기록 켜기/끄기. 시작 시각은 사용자가 정하지 않는다(SleepAuto 의 밤 구간 고정). */
    public synchronized void setAuto(boolean enabled, int unusedStartMinute) {
        prefs.edit().putBoolean(K_AUTO, enabled).remove(K_AUTO_START).commit();
    }

    /**
     * 측정 중으로 적혀 있는데 수면 서비스가 없으면(밤중에 앱이 꺼짐) 끊김으로 마무리한다.
     * 서비스가 살아 있으면 화면이 켜져 잠시 멈춘 것일 수 있어 건드리지 않는다.
     */
    public void recoverIfStale() {
        if (isActive() && !SleepRecordService.isRunning() && System.currentTimeMillis() - startedAt() > 15_000) {
            Log.i(TAG, "녹음 서비스 없이 남은 측정 → 끊김으로 마무리");
            finishSession(false);
        }
    }

    // ───────── 보낼 결과 ─────────

    public synchronized JSONArray pendingNights() {
        try {
            return new JSONArray(prefs.getString(K_PENDING, "[]"));
        } catch (JSONException e) {
            return new JSONArray();
        }
    }

    public synchronized void markUploaded(Set<String> sessionIds) {
        JSONArray kept = new JSONArray();
        JSONArray all = pendingNights();
        for (int i = 0; i < all.length(); i++) {
            JSONObject o = all.optJSONObject(i);
            if (o != null && !sessionIds.contains(o.optString("sessionId"))) kept.put(o);
        }
        prefs.edit().putString(K_PENDING, kept.toString()).apply();
    }

    public static JSONObject toJson(NightSummary.Result r) {
        JSONObject o = new JSONObject();
        try {
            o.put("sessionId", r.sessionId);
            o.put("day", r.day);
            o.put("asleep_minutes", r.asleepMinutes);
            o.put("bed_start", r.bedStartIso());
            o.put("wake_end", r.wakeEndIso());
            o.put("interrupted", r.interrupted);
            o.put("epochs", r.epochCount);
        } catch (JSONException ignored) {
            // put 에 넣는 값이 모두 문자열·숫자라 실제로는 나지 않는다
        }
        return o;
    }

    private void addPending(NightSummary.Result r) {
        JSONArray all = pendingNights();
        all.put(toJson(r));
        // 오래 못 보낸 결과가 끝없이 쌓이지 않게 최근 것만 남긴다
        while (all.length() > MAX_PENDING) all.remove(0);
        prefs.edit().putString(K_PENDING, all.toString()).commit();
    }

    // ───────── 파일 ─────────

    private File dir() {
        return new File(context.getFilesDir(), "sleep");
    }

    private File logFile(String sessionId) {
        return new File(dir(), sessionId + ".log");
    }

    private static List<Epoch> readEpochs(File log) {
        List<Epoch> out = new ArrayList<>();
        if (!log.exists()) return out;
        try (BufferedReader r = new BufferedReader(new FileReader(log))) {
            String line;
            while ((line = r.readLine()) != null) {
                Epoch e = Epoch.fromLine(line);
                if (e != null) out.add(e);
            }
        } catch (IOException ex) {
            Log.e(TAG, "기록 읽기 실패", ex);
        }
        return out;
    }
}
