package com.cheddar.care.sleep;

/*
 * Smoothing adapted from DeltaSleep (https://github.com/ntufar/DeltaSleep),
 * app/.../apnea/NightSummarizer.kt (smoothPhases, sleep epoch rule)
 * MIT License · Copyright (c) 2026 Nicolai Tufar
 */

import java.time.Instant;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

/**
 * 밤새 쌓인 30초 기록 → 결과 3가지(잔 시간, 잠든 시각, 일어난 시각).
 *
 * 1. 다듬기: 각 칸을 앞뒤 2칸 포함 5칸의 중앙값으로 (양 끝 2칸은 그대로)        — DeltaSleep
 * 2. '잠 칸' = 깸이 아니고, TV·대화 소리가 절반을 넘지 않는 칸                    — DeltaSleep
 * 2-1. 화면이 한 번도 안 켜지고 이어진 구간마다 잠 칸을 모아, 1시간이 안 되면 그 구간은 잠이 아니다
 *      (폰을 잠깐 내려놓은 시간·아침 알람 뒤 조용한 방을 거른다)                 — 2026-11-25 사용자 결정
 * 3. 묶음: 잠 칸 사이가 1시간 미만으로 끊기면 한 묶음(합산), 1시간 이상 끊기면 다른 묶음.
 *    묶음이 여럿이면 잔 시간이 가장 긴 묶음 하나만 쓴다                           — 2026-11-25 사용자 결정
 * 4. 잠든 시각 = 그 묶음에서 잠 칸이 10칸(5분) 연속되는 첫 구간의 시작            — Cheddar 제안
 * 5. 일어난 시각 = 그 묶음의 마지막 잠 칸의 끝                                    — Cheddar 제안
 * 6. 잔 분 = 4~5 사이 잠 칸 수 × 30초 (중간에 깬 칸은 빠진다)                     — DeltaSleep + 범위
 * 7. day = 일어난 시각의 기기 날짜 (Health Connect 수면 코드와 같은 기준)
 * 잔 시간이 2시간 미만이면 null — 결과를 만들지 않는다(2026-11-25 사용자 결정).
 *
 * 추가 지표(2026-11-27, 모두 '그 묶음' 안에서만 — 잠든 시각~일어난 시각):
 * - 깊은/얕은/렘 분: 잠 칸을 다듬은 판정별로 센다. 렘은 DeltaSleep NightSummarizer 처럼
 *   잠든 뒤 60분 안의 렘은 얕은 잠으로, 4칸(2분) 미만으로 짧게 끊긴 렘은 앞 칸 판정으로 바꾼다
 *   (원본은 '측정 시작'부터 60분이지만 Cheddar 는 자동 측정이 잠들기 한참 전에 시작돼 '잠든 시각' 기준).
 *   앞 칸이 깸이면 잠 시간은 그대로 두려고 얕은 잠으로 센다. 깊은+얕은+렘 = 잔 분.
 * - 중간에 깬 분: 그 사이 잠 칸이 아닌 칸 수 × 30초. 중간에 깬 횟수: 잠 아닌 칸이 2칸(1분) 이상 이어진 횟수.
 * - 수면 효율(%): 잔 분 ÷ (일어난 시각 − 잠든 시각).
 * - 호흡수(회/분): 숨 주기가 잡힌 잠 칸들의 (60 ÷ 숨 주기) 중앙값. 하나도 없으면 null.
 *   숨 감지 비율(%): 잠 칸 중 숨 주기가 잡힌 칸의 비율 — 이 값이 낮으면 호흡수·무호흡·렘을 믿기 어렵다.
 * - 무호흡/저호흡 의심 횟수: 사건 가운데 시각이 잠 칸에 들어가는 것만 센다
 *   (DeltaSleep 처럼 깸·TV 소리 구간의 사건은 버린다).
 */
public final class NightSummary {

    static final int SMOOTH_HALF_WIDTH = 2;
    static final int ONSET_RUN = 10;               // 10칸 = 5분
    static final float EXTERNAL_AUDIO_MAX = 0.5f;  // DeltaSleep ExternalAudio.THRESHOLD_SPEECH
    static final int EPOCH_SECONDS = 30;
    static final long SPLIT_GAP_MS = 60L * 60 * 1000; // 잠이 이만큼 끊기면 다른 잠으로 본다
    static final int MIN_SLEEP_MINUTES = 120;         // 이보다 짧으면 기록하지 않는다
    static final int MIN_STRETCH_SLEEP_MINUTES = 60;  // 화면이 꺼져 있던 한 구간의 잠이 이보다 짧으면 잠 아님
    static final long STRETCH_BREAK_MS = 90_000L;     // 칸 사이가 이만큼 비면(앱이 꺼졌던 시간) 구간이 끊긴 것

    public static final class Result {
        public final String sessionId;
        public final String day;
        public final int asleepMinutes;
        public final long bedStartMs;
        public final long wakeEndMs;
        public final boolean interrupted;
        public final int epochCount;
        public final int deepMinutes;
        public final int lightMinutes;
        public final int remMinutes;
        public final int awakeMinutes;
        public final int awakenings;
        public final int sleepEfficiency;
        /** 회/분. 숨 주기가 한 칸도 안 잡혔으면 null. */
        public final Float breathingRate;
        public final int breathingDetectedPct;
        public final int apneaCount;
        public final int hypopneaCount;

        Result(String sessionId, String day, int asleepMinutes, long bedStartMs, long wakeEndMs, boolean interrupted,
               int epochCount, int deepMinutes, int lightMinutes, int remMinutes, int awakeMinutes, int awakenings,
               int sleepEfficiency, Float breathingRate, int breathingDetectedPct, int apneaCount, int hypopneaCount) {
            this.sessionId = sessionId;
            this.day = day;
            this.asleepMinutes = asleepMinutes;
            this.bedStartMs = bedStartMs;
            this.wakeEndMs = wakeEndMs;
            this.interrupted = interrupted;
            this.epochCount = epochCount;
            this.deepMinutes = deepMinutes;
            this.lightMinutes = lightMinutes;
            this.remMinutes = remMinutes;
            this.awakeMinutes = awakeMinutes;
            this.awakenings = awakenings;
            this.sleepEfficiency = sleepEfficiency;
            this.breathingRate = breathingRate;
            this.breathingDetectedPct = breathingDetectedPct;
            this.apneaCount = apneaCount;
            this.hypopneaCount = hypopneaCount;
        }

        public String bedStartIso() { return Instant.ofEpochMilli(bedStartMs).toString(); }
        public String wakeEndIso() { return Instant.ofEpochMilli(wakeEndMs).toString(); }
    }

    private NightSummary() {}

    /** 앞뒤 5칸 중앙값. 칸이 5개 미만이면 그대로. */
    static int[] smooth(int[] phases) {
        int n = phases.length;
        int[] out = phases.clone();
        int[] window = new int[2 * SMOOTH_HALF_WIDTH + 1];
        for (int i = SMOOTH_HALF_WIDTH; i + SMOOTH_HALF_WIDTH < n; i++) {
            for (int k = 0; k < window.length; k++) window[k] = phases[i - SMOOTH_HALF_WIDTH + k];
            java.util.Arrays.sort(window);
            out[i] = window[window.length / 2];
        }
        return out;
    }

    static final long REM_SUPPRESS_MS = 60L * 60 * 1000; // 잠든 뒤 60분 안의 렘은 얕은 잠으로
    static final int REM_MIN_RUN = 4;                     // 렘이 4칸(2분) 미만이면 앞 칸 판정으로
    static final int AWAKENING_MIN_RUN = 2;               // 잠 아닌 칸이 2칸(1분) 이상이면 '깬 것'

    /** 사건 없이 요약(예전 기록·테스트용). */
    public static Result compute(String sessionId, List<Epoch> epochs, boolean interrupted, ZoneId zone) {
        return compute(sessionId, epochs, java.util.Collections.emptyList(), interrupted, zone);
    }

    /** events: 각 원소 {가운데 시각ms, 종류(0 무호흡·1 저호흡)}. */
    public static Result compute(String sessionId, List<Epoch> epochs, List<long[]> events, boolean interrupted, ZoneId zone) {
        int n = epochs.size();
        if (n == 0) return null;

        int[] raw = new int[n];
        for (int i = 0; i < n; i++) raw[i] = epochs.get(i).phase;
        int[] phases = smooth(raw);

        boolean[] asleep = new boolean[n];
        for (int i = 0; i < n; i++) {
            asleep[i] = phases[i] != Epoch.AWAKE && epochs.get(i).externalAudioFraction <= EXTERNAL_AUDIO_MAX;
        }

        // 화면이 계속 꺼져 있던 한 구간 안의 잠 칸이 모두 합쳐 1시간이 안 되면 잠으로 치지 않는다
        int stretchFrom = -1;
        for (int i = 0; i <= n; i++) {
            boolean boundary = i == n || epochs.get(i).isScreenOnFill()
                || (i > 0 && epochs.get(i).endMs - epochs.get(i - 1).endMs > STRETCH_BREAK_MS);
            if (boundary && stretchFrom >= 0) {
                int sleep = 0;
                for (int k = stretchFrom; k < i; k++) if (asleep[k]) sleep++;
                if (sleep * EPOCH_SECONDS / 60 < MIN_STRETCH_SLEEP_MINUTES) {
                    for (int k = stretchFrom; k < i; k++) asleep[k] = false;
                }
                stretchFrom = -1;
            }
            if (i < n && !epochs.get(i).isScreenOnFill() && stretchFrom < 0) stretchFrom = i;
        }

        // 잠 칸을 '묶음'으로 나눈다 — 잠 칸 사이가 1시간 이상 비면 다른 묶음
        int bestOnset = -1;
        int bestWake = -1;
        int bestSleep = 0;
        int from = -1;
        int last = -1;
        for (int i = 0; i <= n; i++) {
            boolean end = i == n;
            if (!end && !asleep[i]) continue;
            boolean split = !end && last >= 0
                && (epochs.get(i).endMs - EPOCH_SECONDS * 1000L) - epochs.get(last).endMs >= SPLIT_GAP_MS;
            if ((end || split) && from >= 0) {
                int onset = onsetIn(asleep, from, last);
                if (onset >= 0) {
                    int sleep = 0;
                    for (int k = onset; k <= last; k++) if (asleep[k]) sleep++;
                    if (sleep > bestSleep) {
                        bestSleep = sleep;
                        bestOnset = onset;
                        bestWake = last;
                    }
                }
                from = -1;
            }
            if (end) break;
            if (from < 0) from = i;
            last = i;
        }
        if (bestOnset < 0) return null;

        int minutes = bestSleep * EPOCH_SECONDS / 60;
        if (minutes < MIN_SLEEP_MINUTES) return null;

        long bedStart = epochs.get(bestOnset).endMs - EPOCH_SECONDS * 1000L;
        long wakeEnd = epochs.get(bestWake).endMs;
        String day = Instant.ofEpochMilli(wakeEnd).atZone(zone).toLocalDate().toString();

        // ── 단계별 시간 (렘 후처리 — DeltaSleep NightSummarizer.smoothPhases 2·3단계) ──
        int[] stage = phases.clone();
        for (int k = bestOnset; k <= bestWake; k++) {
            if (stage[k] == Epoch.REM && epochs.get(k).endMs - bedStart <= REM_SUPPRESS_MS) stage[k] = Epoch.LIGHT;
        }
        for (int i = bestOnset; i <= bestWake; ) {
            if (stage[i] != Epoch.REM) { i++; continue; }
            int j = i;
            while (j <= bestWake && stage[j] == Epoch.REM) j++;
            if (j - i < REM_MIN_RUN) {
                int fill = i > 0 ? stage[i - 1] : (j < n ? stage[j] : Epoch.LIGHT);
                for (int k = i; k < j; k++) stage[k] = fill;
            }
            i = j;
        }
        int deep = 0, light = 0, rem = 0, awakeEpochs = 0, awakenings = 0, run = 0;
        int breathEpochs = 0;
        List<Float> bpms = new ArrayList<>();
        for (int k = bestOnset; k <= bestWake; k++) {
            if (!asleep[k]) {
                awakeEpochs++;
                run++;
                continue;
            }
            if (run >= AWAKENING_MIN_RUN) awakenings++;
            run = 0;
            if (stage[k] == Epoch.DEEP) deep++;
            else if (stage[k] == Epoch.REM) rem++;
            else light++; // 얕은 잠 + 렘 정리에서 깸으로 채워진 칸
            float period = epochs.get(k).breathPeriodS;
            if (period > 0f) {
                breathEpochs++;
                bpms.add(60f / period);
            }
        }
        Float breathingRate = null;
        if (!bpms.isEmpty()) {
            Collections.sort(bpms);
            int mid = bpms.size() / 2;
            float med = bpms.size() % 2 == 1 ? bpms.get(mid) : (bpms.get(mid - 1) + bpms.get(mid)) / 2f;
            breathingRate = Math.round(med * 10f) / 10f;
        }
        int breathPct = Math.round(breathEpochs * 100f / bestSleep);
        double spanMin = (wakeEnd - bedStart) / 60_000.0;
        int efficiency = spanMin > 0 ? (int) Math.min(100, Math.round(minutes * 100.0 / spanMin)) : 0;

        // ── 무호흡·저호흡: 가운데 시각이 이 묶음의 잠 칸에 들어가는 사건만 ──
        int apnea = 0, hypopnea = 0;
        for (long[] ev : events) {
            int k = epochIndexAt(epochs, ev[0]);
            if (k < bestOnset || k > bestWake || !asleep[k]) continue;
            if (ev[1] == BreathingTrackerEvents.APNEA) apnea++;
            else if (ev[1] == BreathingTrackerEvents.HYPOPNEA) hypopnea++;
        }

        // 30초 칸 단위 합산이라 분은 내림 — 깊은+얕은+렘 = 잔 분이 되도록 렘·깊은을 먼저 내리고 나머지를 얕은 잠에
        int deepMin = deep * EPOCH_SECONDS / 60;
        int remMin = rem * EPOCH_SECONDS / 60;
        int lightMin = Math.max(0, minutes - deepMin - remMin);
        return new Result(sessionId, day, minutes, bedStart, wakeEnd, interrupted, n,
            deepMin, lightMin, remMin, awakeEpochs * EPOCH_SECONDS / 60, awakenings, efficiency,
            breathingRate, breathPct, apnea, hypopnea);
    }

    /** 사건 종류 번호 (BreathingTracker 와 같은 값). */
    static final class BreathingTrackerEvents {
        static final long APNEA = 0;
        static final long HYPOPNEA = 1;
    }

    /** 시각 t 가 들어가는 칸 번호 — 칸 i 는 (끝시각 − 30초, 끝시각]. 없으면 -1. */
    static int epochIndexAt(List<Epoch> epochs, long t) {
        int lo = 0, hi = epochs.size() - 1, ans = -1;
        while (lo <= hi) {
            int mid = (lo + hi) >>> 1;
            if (epochs.get(mid).endMs >= t) { ans = mid; hi = mid - 1; } else lo = mid + 1;
        }
        if (ans < 0) return -1;
        return epochs.get(ans).endMs - EPOCH_SECONDS * 1000L < t ? ans : -1;
    }

    /** [from, to] 안에서 잠 칸이 10칸(5분) 연속되는 첫 구간의 시작. 없으면 -1. */
    private static int onsetIn(boolean[] asleep, int from, int to) {
        int run = 0;
        for (int i = from; i <= to; i++) {
            run = asleep[i] ? run + 1 : 0;
            if (run >= ONSET_RUN) return i - ONSET_RUN + 1;
        }
        return -1;
    }
}
