package com.cheddar.care.sleep;

/*
 * Smoothing adapted from DeltaSleep (https://github.com/ntufar/DeltaSleep),
 * app/.../apnea/NightSummarizer.kt (smoothPhases, sleep epoch rule)
 * MIT License · Copyright (c) 2026 Nicolai Tufar
 */

import java.time.Instant;
import java.time.ZoneId;
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

        Result(String sessionId, String day, int asleepMinutes, long bedStartMs, long wakeEndMs, boolean interrupted, int epochCount) {
            this.sessionId = sessionId;
            this.day = day;
            this.asleepMinutes = asleepMinutes;
            this.bedStartMs = bedStartMs;
            this.wakeEndMs = wakeEndMs;
            this.interrupted = interrupted;
            this.epochCount = epochCount;
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

    public static Result compute(String sessionId, List<Epoch> epochs, boolean interrupted, ZoneId zone) {
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
        return new Result(sessionId, day, minutes, bedStart, wakeEnd, interrupted, n);
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
