package com.cheddar.care.sleep;

import android.Manifest;
import android.content.Intent;
import android.os.Build;
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
import org.json.JSONObject;

/**
 * 요청 창구 — 화면(src/sleep/sleepSound.js)의 요청을 받아 수면 서비스·보관함에 전달한다.
 * 측정은 '매일 밤 자동'뿐이라(SleepRecordService) 여기서는 켜기/끄기·상태·결과 전달만 한다.
 */
@CapacitorPlugin(
    name = "SleepSound",
    permissions = {
        @Permission(alias = "microphone", strings = { Manifest.permission.RECORD_AUDIO }),
        @Permission(alias = "notifications", strings = { Manifest.permission.POST_NOTIFICATIONS }),
    }
)
public class SleepSoundPlugin extends Plugin {

    private SleepSessionStore store() {
        return SleepSessionStore.get(getContext());
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

    // ───────── 상태 ─────────

    @PluginMethod
    public void getStatus(PluginCall call) {
        store().recoverIfStale();
        JSObject ret = new JSObject();
        ret.put("running", store().isActive());       // 오늘 밤 측정이 진행 중(화면 켜져 잠시 멈춘 때 포함)
        ret.put("recording", SleepRecordService.isRecording());
        ret.put("startedAt", store().startedAt());
        ret.put("autoEnabled", store().isAutoEnabled());
        ret.put("autoArmed", SleepRecordService.isRunning());
        call.resolve(ret);
    }

    // ───────── 자동 기록 켜기/끄기 ─────────

    /** 서비스에 명령. 이미 떠 있으면 일반 시작, 아니면 포그라운드 시작(앱이 화면에 있을 때만 호출됨). */
    private void sendToService(String action) {
        Intent i = new Intent(getContext(), SleepRecordService.class).setAction(action);
        if (SleepRecordService.isRunning()) getContext().startService(i);
        else ContextCompat.startForegroundService(getContext(), i);
    }

    /** { enabled } — 켤 때는 마이크 권한이 있어야 한다(JS 가 먼저 requestMicPermission). */
    @PluginMethod
    public void setAutoMode(PluginCall call) {
        boolean enabled = Boolean.TRUE.equals(call.getBoolean("enabled", false));
        if (enabled && !micGranted()) {
            call.reject("microphone permission not granted", "NO_PERMISSION");
            return;
        }
        store().setAuto(enabled, SleepAuto.NIGHT_START_MINUTE);
        if (enabled) {
            store().recoverIfStale();
            sendToService(SleepRecordService.ACTION_ARM);
            SleepBootReceiver.clearRearmNotification(getContext());
        } else if (SleepRecordService.isRunning()) {
            getContext().startService(new Intent(getContext(), SleepRecordService.class).setAction(SleepRecordService.ACTION_AUTO_OFF));
        }
        JSObject ret = new JSObject();
        ret.put("enabled", enabled);
        call.resolve(ret);
    }

    /**
     * 앱이 열릴 때마다 호출. 자동 기록이 켜져 있는데 서비스가 없으면(재부팅·시스템 종료) 다시 켠다.
     * 앱이 화면에 있을 때라 마이크 서비스를 새로 시작할 수 있다.
     */
    @PluginMethod
    public void ensureAuto(PluginCall call) {
        boolean rearmed = false;
        if (store().isAutoEnabled() && micGranted() && !SleepRecordService.isRunning()) {
            store().recoverIfStale();
            sendToService(SleepRecordService.ACTION_ARM);
            rearmed = true;
        }
        if (store().isAutoEnabled()) SleepBootReceiver.clearRearmNotification(getContext());
        JSObject ret = new JSObject();
        ret.put("rearmed", rearmed);
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
