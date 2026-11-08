package com.cheddar.care.sleep;

import android.Manifest;
import android.content.Intent;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import androidx.core.content.ContextCompat;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.util.HashSet;
import java.util.Set;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * 요청 창구 — 화면(src/sleep/sleepSound.js)의 요청을 받아 녹음 서비스·보관함에 전달한다.
 * 녹음이나 계산은 직접 하지 않는다.
 */
@CapacitorPlugin(
    name = "SleepSound",
    permissions = {
        @Permission(alias = "microphone", strings = { Manifest.permission.RECORD_AUDIO }),
        @Permission(alias = "notifications", strings = { Manifest.permission.POST_NOTIFICATIONS }),
    }
)
public class SleepSoundPlugin extends Plugin {

    private static final long STOP_TIMEOUT_MS = 10_000;

    private final Handler main = new Handler(Looper.getMainLooper());
    private PluginCall pendingStop;

    private SleepSessionStore store() {
        return SleepSessionStore.get(getContext());
    }

    @Override
    public void load() {
        store().setFinishListener((result, normal) -> main.post(() -> resolveStop(result, normal)));
    }

    // ───────── 권한 ─────────

    private boolean micGranted() {
        return getPermissionState("microphone") == PermissionState.GRANTED;
    }

    @PluginMethod
    public void checkMicPermission(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("granted", micGranted());
        call.resolve(ret);
    }

    /** 마이크(+ Android 13 이상은 알림) 권한 요청. 알림을 거절해도 측정은 된다. */
    @PluginMethod
    public void requestMicPermission(PluginCall call) {
        if (micGranted()) {
            checkMicPermission(call);
            return;
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            requestPermissionForAliases(new String[] { "microphone", "notifications" }, call, "micPermissionCallback");
        } else {
            requestPermissionForAlias("microphone", call, "micPermissionCallback");
        }
    }

    @PermissionCallback
    private void micPermissionCallback(PluginCall call) {
        checkMicPermission(call);
    }

    // ───────── 측정 ─────────

    @PluginMethod
    public void start(PluginCall call) {
        if (!micGranted()) {
            call.reject("microphone permission not granted", "NO_PERMISSION");
            return;
        }
        store().recoverIfStale();
        long now = System.currentTimeMillis();
        String id = store().beginSession(now);
        if (!SleepRecordService.isRunning()) {
            Intent i = new Intent(getContext(), SleepRecordService.class).setAction(SleepRecordService.ACTION_START);
            ContextCompat.startForegroundService(getContext(), i);
        }
        JSObject ret = new JSObject();
        ret.put("sessionId", id);
        ret.put("startedAt", store().startedAt());
        call.resolve(ret);
    }

    /** 멈춤. 녹음 서비스가 정리를 끝내면 요약과 함께 응답한다. */
    @PluginMethod
    public void stop(PluginCall call) {
        store().recoverIfStale();
        if (!store().isActive()) {
            JSObject ret = new JSObject();
            ret.put("summary", null);
            ret.put("reason", "not_running");
            call.resolve(ret);
            return;
        }
        if (pendingStop != null) pendingStop.reject("superseded", "SUPERSEDED");
        pendingStop = call;
        Intent i = new Intent(getContext(), SleepRecordService.class).setAction(SleepRecordService.ACTION_STOP);
        getContext().startService(i);

        main.postDelayed(() -> {
            if (pendingStop != call) return;
            // 서비스가 응답하지 않으면 보관함에서 직접 마무리 — 결과는 finishListener 로 응답된다
            if (store().isActive()) store().finishSession(true);
            else resolveStop(null, true);
        }, STOP_TIMEOUT_MS);
    }

    private void resolveStop(NightSummary.Result result, boolean normal) {
        PluginCall call = pendingStop;
        if (call == null) return;
        pendingStop = null;
        JSObject ret = new JSObject();
        try {
            ret.put("summary", result != null ? JSObject.fromJSONObject(SleepSessionStore.toJson(result)) : null);
        } catch (JSONException e) {
            ret.put("summary", null);
        }
        ret.put("reason", result != null ? "ok" : "too_short");
        ret.put("interrupted", !normal);
        call.resolve(ret);
    }

    @PluginMethod
    public void getStatus(PluginCall call) {
        store().recoverIfStale();
        JSObject ret = new JSObject();
        ret.put("running", store().isActive());
        ret.put("sessionId", store().sessionId());
        ret.put("startedAt", store().startedAt());
        ret.put("epochCount", store().epochCount());
        call.resolve(ret);
    }

    // ───────── 보낼 결과 ─────────

    /** 아직 서버에 못 보낸 밤 결과 목록. 끊긴 측정도 여기서 마무리돼 들어온다. */
    @PluginMethod
    public void getPendingNights(PluginCall call) {
        store().recoverIfStale();
        JSONArray pending = store().pendingNights();
        JSArray nights = new JSArray();
        for (int i = 0; i < pending.length(); i++) {
            JSONObject o = pending.optJSONObject(i);
            if (o != null) nights.put(o);
        }
        JSObject ret = new JSObject();
        ret.put("nights", nights);
        call.resolve(ret);
    }

    @PluginMethod
    public void markUploaded(PluginCall call) {
        JSArray ids = call.getArray("sessionIds");
        Set<String> set = new HashSet<>();
        if (ids != null) {
            for (int i = 0; i < ids.length(); i++) {
                String id = ids.optString(i, null);
                if (id != null) set.add(id);
            }
        }
        store().markUploaded(set);
        call.resolve();
    }
}
