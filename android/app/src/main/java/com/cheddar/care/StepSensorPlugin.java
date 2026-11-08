package com.cheddar.care;

import android.Manifest;
import android.os.Build;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import com.google.android.gms.common.ConnectionResult;
import com.google.android.gms.common.GoogleApiAvailability;
import com.google.android.gms.fitness.FitnessLocal;
import com.google.android.gms.fitness.LocalRecordingClient;
import com.google.android.gms.fitness.data.LocalBucket;
import com.google.android.gms.fitness.data.LocalDataPoint;
import com.google.android.gms.fitness.data.LocalDataSet;
import com.google.android.gms.fitness.data.LocalDataType;
import com.google.android.gms.fitness.data.LocalField;
import com.google.android.gms.fitness.request.LocalDataReadRequest;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.ZonedDateTime;
import java.util.concurrent.TimeUnit;

/**
 * 폰 센서 걸음수 — Google Play 서비스의 Recording API on mobile(LocalRecordingClient).
 *
 * 삼성 헬스 → Health Connect 를 거치지 않고, 폰의 걸음 센서를 Play 서비스가 직접 기록한다.
 * - 구글 계정 불필요, 기기 안에만 저장(최근 약 10일 보관).
 * - 한 번 subscribe 하면 우리 앱이 꺼져 있어도 Play 서비스가 계속 센다(백그라운드 서비스·알림 없음).
 * - subscribe 한 시점부터만 기록된다. 그 전 걸음은 가져올 수 없다.
 * - 권한: Android 10+ 는 ACTIVITY_RECOGNITION("신체 활동") 런타임 권한, 9 이하는 설치 시 자동.
 *
 * JS 쪽: src/health/stepSensor.js
 */
@CapacitorPlugin(
    name = "StepSensor",
    permissions = { @Permission(alias = "activity", strings = { Manifest.permission.ACTIVITY_RECOGNITION }) }
)
public class StepSensorPlugin extends Plugin {

    // Recording API 가 보관하는 기간(일). 그 이상은 요청해도 비어 있다.
    private static final int MAX_DAYS = 10;

    private LocalRecordingClient client() {
        return FitnessLocal.getLocalRecordingClient(getContext());
    }

    private static boolean needsRuntimePermission() {
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q;
    }

    private boolean hasActivityPermission() {
        return !needsRuntimePermission() || getPermissionState("activity") == PermissionState.GRANTED;
    }

    /** Play 서비스가 Recording API 를 지원하는 버전인지. {available, reason} */
    @PluginMethod
    public void isAvailable(PluginCall call) {
        int code = GoogleApiAvailability.getInstance()
            .isGooglePlayServicesAvailable(getContext(), LocalRecordingClient.LOCAL_RECORDING_CLIENT_MIN_VERSION_CODE);
        JSObject ret = new JSObject();
        ret.put("available", code == ConnectionResult.SUCCESS);
        String reason = "";
        if (code == ConnectionResult.SERVICE_VERSION_UPDATE_REQUIRED) reason = "play-services-update";
        else if (code != ConnectionResult.SUCCESS) reason = "play-services-" + code;
        ret.put("reason", reason);
        call.resolve(ret);
    }

    @PluginMethod
    public void checkActivityPermission(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("granted", hasActivityPermission());
        call.resolve(ret);
    }

    @PluginMethod
    public void requestActivityPermission(PluginCall call) {
        if (hasActivityPermission()) {
            JSObject ret = new JSObject();
            ret.put("granted", true);
            call.resolve(ret);
            return;
        }
        requestPermissionForAlias("activity", call, "activityPermissionCallback");
    }

    @PermissionCallback
    private void activityPermissionCallback(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("granted", hasActivityPermission());
        call.resolve(ret);
    }

    /** 걸음 기록 시작. 이미 구독 중이어도 그대로 성공 — 앱 진입 때마다 불러도 된다. */
    @PluginMethod
    public void subscribe(PluginCall call) {
        if (!hasActivityPermission()) {
            call.reject("activity permission not granted", "NO_PERMISSION");
            return;
        }
        client()
            .subscribe(LocalDataType.TYPE_STEP_COUNT_DELTA)
            .addOnSuccessListener(unused -> call.resolve())
            .addOnFailureListener(e -> call.reject("subscribe failed: " + e.getMessage(), "SUBSCRIBE_FAILED", e));
    }

    /**
     * 최근 N일(오늘 포함) 일별 걸음수. 기기 시간대의 자정 기준으로 하루씩 자른다.
     * 반환: { days: [{ day: "2026-11-08", steps: 1234 }, ...] } — 기록이 없는 날은 빠진다.
     */
    @PluginMethod
    public void readDailySteps(PluginCall call) {
        if (!hasActivityPermission()) {
            call.reject("activity permission not granted", "NO_PERMISSION");
            return;
        }
        int days = Math.max(1, Math.min(MAX_DAYS, call.getInt("days", 7)));
        ZoneId zone = ZoneId.systemDefault();
        ZonedDateTime start = LocalDate.now(zone).minusDays(days - 1).atStartOfDay(zone);
        ZonedDateTime end = ZonedDateTime.now(zone);

        LocalDataReadRequest request = new LocalDataReadRequest.Builder()
            .aggregate(LocalDataType.TYPE_STEP_COUNT_DELTA)
            // 시작 시각이 로컬 자정이므로 1일 버킷이 그대로 '하루'가 된다(한국은 서머타임 없음)
            .bucketByTime(1, TimeUnit.DAYS)
            .setTimeRange(start.toEpochSecond(), end.toEpochSecond(), TimeUnit.SECONDS)
            .build();

        client()
            .readData(request)
            .addOnSuccessListener(response -> {
                JSArray out = new JSArray();
                for (LocalBucket bucket : response.getBuckets()) {
                    long steps = 0;
                    for (LocalDataSet dataSet : bucket.getDataSets()) {
                        for (LocalDataPoint dp : dataSet.getDataPoints()) {
                            for (LocalField field : dp.getDataType().getFields()) {
                                steps += dp.getValue(field).asInt();
                            }
                        }
                    }
                    if (steps <= 0) continue;
                    LocalDate day = java.time.Instant
                        .ofEpochMilli(bucket.getStartTime(TimeUnit.MILLISECONDS))
                        .atZone(zone)
                        .toLocalDate();
                    JSObject row = new JSObject();
                    row.put("day", day.toString());
                    row.put("steps", steps);
                    out.put(row);
                }
                JSObject ret = new JSObject();
                ret.put("days", out);
                call.resolve(ret);
            })
            .addOnFailureListener(e -> call.reject("read failed: " + e.getMessage(), "READ_FAILED", e));
    }
}
