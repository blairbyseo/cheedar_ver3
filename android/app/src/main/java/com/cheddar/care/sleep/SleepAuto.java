package com.cheddar.care.sleep;

import java.time.Instant;
import java.time.ZoneId;
import java.time.ZonedDateTime;
import java.util.ArrayList;
import java.util.List;

/**
 * '매일 밤 자동 수면 측정'의 시간 규칙. 안드로이드 API 를 쓰지 않아 기기 없이 시험할 수 있다.
 * 사용자가 정하는 값은 없다(2026-11-08 사용자 결정 — 시작 시각 설정 제거).
 *
 * - 밤 구간: 저녁 8시 ~ 다음 날 낮 12시. 이 안에서 '휴대폰 화면이 꺼져 있을 때만' 마이크를 켠다.
 *   화면이 켜지면(폰을 쓰는 중 = 깨어 있음) 잠시 멈추고, 그 시간은 '깸'으로 채운다.
 * - 측정 시작: 밤 구간에서 처음 화면이 꺼졌을 때. 같은 밤에 이미 끝난 측정이 있으면 다시 시작하지 않는다.
 * - 측정 끝(둘 중 먼저):
 *   1) 3시간 넘게 잰 뒤, 오전 5시~낮 12시 사이에 처음 휴대폰 잠금을 풀었을 때
 *      (새벽에 잠깐 시계만 보고 다시 자는 경우는 5시 전이라 끝나지 않는다)
 *   2) 낮 12시가 지난 뒤의 첫 화면 변화(또는 녹음 중이면 12시 정각)
 */
public final class SleepAuto {

    static final int NIGHT_START_MINUTE = 20 * 60;              // 저녁 8시
    static final long NIGHT_LENGTH_MS = 16L * 60 * 60 * 1000;    // ~ 다음 날 낮 12시
    static final long MIN_RECORD_MS = 3L * 60 * 60 * 1000;       // 이보다 짧으면 잠금 해제로 끝내지 않음
    static final int WAKE_FROM_HOUR = 5;
    static final int HARD_END_HOUR = 12;
    static final long EPOCH_MS = 30_000L;
    static final int MIN_AWAKE_FILL = 3;                         // 5칸 다듬기에도 '깸'이 남도록 최소 3칸
    static final int MAX_AWAKE_FILL = 16 * 120;                  // 안전장치: 16시간

    private SleepAuto() {}

    /** now 직전(또는 같은)의 밤 시작(저녁 8시). */
    static long nightStartMs(long nowMs, ZoneId zone) {
        ZonedDateTime now = Instant.ofEpochMilli(nowMs).atZone(zone);
        ZonedDateTime today = now.toLocalDate().atStartOfDay(zone).plusMinutes(NIGHT_START_MINUTE);
        return (today.toInstant().toEpochMilli() <= nowMs ? today : today.minusDays(1)).toInstant().toEpochMilli();
    }

    /** 다음 밤 시작. */
    static long nextNightStartMs(long nowMs, ZoneId zone) {
        long last = nightStartMs(nowMs, zone);
        return Instant.ofEpochMilli(last).atZone(zone).plusDays(1).toInstant().toEpochMilli();
    }

    /** 지금이 밤 구간(저녁 8시 ~ 낮 12시)인지. */
    static boolean inNight(long nowMs, ZoneId zone) {
        return nowMs - nightStartMs(nowMs, zone) < NIGHT_LENGTH_MS;
    }

    /** 화면이 꺼진 지금 새 측정을 시작할지 — 밤 구간이고, 이번 밤에 끝난 측정이 아직 없을 때. */
    static boolean shouldStartSession(long nowMs, long lastFinishedMs, ZoneId zone) {
        return inNight(nowMs, zone) && lastFinishedMs < nightStartMs(nowMs, zone);
    }

    /** 측정 시작 후 처음 오는 낮 12시 — 늦어도 이때는 끝낸다. */
    static long hardEndMs(long sessionStartMs, ZoneId zone) {
        ZonedDateTime start = Instant.ofEpochMilli(sessionStartMs).atZone(zone);
        ZonedDateTime noon = start.toLocalDate().atStartOfDay(zone).plusHours(HARD_END_HOUR);
        if (!noon.toInstant().isAfter(start.toInstant())) noon = noon.plusDays(1);
        return noon.toInstant().toEpochMilli();
    }

    static boolean pastHardEnd(long sessionStartMs, long nowMs, ZoneId zone) {
        return nowMs >= hardEndMs(sessionStartMs, zone);
    }

    /** 잠금 해제 순간에 측정을 끝낼지. */
    static boolean shouldEndOnUnlock(long sessionStartMs, long nowMs, ZoneId zone) {
        if (pastHardEnd(sessionStartMs, nowMs, zone)) return true;
        if (nowMs - sessionStartMs < MIN_RECORD_MS) return false;
        int hour = Instant.ofEpochMilli(nowMs).atZone(zone).getHour();
        return hour >= WAKE_FROM_HOUR && hour < HARD_END_HOUR;
    }

    /**
     * 화면이 켜져 마이크를 멈췄던 구간을 '깸' 칸으로 채운다. 칸이 없으면 앞뒤 잠이 이어져 보여
     * 잠든 시각(5분 연속 잠)이 잘못 잡히기 때문. 짧게 켰어도 최소 3칸(5칸 중앙값 다듬기에 지워지지 않게).
     */
    static List<Epoch> awakeFill(long pausedAtMs, long resumedAtMs) {
        List<Epoch> out = new ArrayList<>();
        long gap = Math.max(0, resumedAtMs - pausedAtMs);
        int n = (int) Math.max(MIN_AWAKE_FILL, Math.min(MAX_AWAKE_FILL, Math.round(gap / (double) EPOCH_MS)));
        long step = Math.max(1, gap / n);
        for (int i = 1; i <= n; i++) {
            out.add(new Epoch(pausedAtMs + step * i, Epoch.AWAKE, 0f, 0f, 0f));
        }
        return out;
    }
}
