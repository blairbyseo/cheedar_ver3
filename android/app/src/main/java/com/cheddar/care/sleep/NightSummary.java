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
 * 3. 잠든 시각 = 잠 칸이 10칸(5분) 연속되는 첫 구간의 시작                        — Cheddar 제안
 * 4. 일어난 시각 = 마지막 잠 칸의 끝                                              — Cheddar 제안
 * 5. 잔 분 = 3~4 사이 잠 칸 수 × 30초                                             — DeltaSleep + 범위
 * 6. day = 일어난 시각의 기기 날짜 (Health Connect 수면 코드와 같은 기준)
 * 5분 연속 잠이 한 번도 없으면 null — 결과를 만들지 않는다.
 */
public final class NightSummary {

    static final int SMOOTH_HALF_WIDTH = 2;
    static final int ONSET_RUN = 10;               // 10칸 = 5분
    static final float EXTERNAL_AUDIO_MAX = 0.5f;  // DeltaSleep ExternalAudio.THRESHOLD_SPEECH
    static final int EPOCH_SECONDS = 30;

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

        int onset = -1;
        int run = 0;
        for (int i = 0; i < n; i++) {
            run = asleep[i] ? run + 1 : 0;
            if (run >= ONSET_RUN) {
                onset = i - ONSET_RUN + 1;
                break;
            }
        }
        if (onset < 0) return null;

        int wake = onset;
        for (int i = n - 1; i >= onset; i--) {
            if (asleep[i]) {
                wake = i;
                break;
            }
        }

        int sleepEpochs = 0;
        for (int i = onset; i <= wake; i++) if (asleep[i]) sleepEpochs++;

        long bedStart = epochs.get(onset).endMs - EPOCH_SECONDS * 1000L;
        long wakeEnd = epochs.get(wake).endMs;
        String day = Instant.ofEpochMilli(wakeEnd).atZone(zone).toLocalDate().toString();
        int minutes = sleepEpochs * EPOCH_SECONDS / 60;
        return new Result(sessionId, day, minutes, bedStart, wakeEnd, interrupted, n);
    }
}
