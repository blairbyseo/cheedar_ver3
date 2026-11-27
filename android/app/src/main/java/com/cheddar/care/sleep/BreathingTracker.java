package com.cheddar.care.sleep;

/*
 * Ported from DeltaSleep (https://github.com/ntufar/DeltaSleep):
 *   dsp/src/apnea.rs        — RespEnvelope, NoiseFloor, PeriodicityTracker,
 *                             BreathingMedianTracker, EventStateMachine
 *   dsp/src/engine.rs       — breath-peak detector, epoch breathing fields
 *   dsp/src/apnea_config.rs, dsp/src/phase_config.rs — constants
 * MIT License · Copyright (c) 2026 Nicolai Tufar
 * (전문: android/app/src/main/assets/licenses/DeltaSleep-LICENSE.txt)
 */

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

/**
 * 숨소리 추적기 — 0.01초 조각을 받아 다음 세 가지를 만든다(모두 DeltaSleep 원본 규칙).
 *
 * 1. 숨 리듬: 100~2,000Hz 숨소리 대역의 크기(포락선)를 0.05초마다 모아 45초 동안의
 *    자기상관으로 2~8초 주기를 찾는다 → '숨 쉬는 중' 여부와 숨 주기(초) → 호흡수.
 * 2. 숨 간격 불규칙도: 포락선의 봉우리(숨 한 번)를 세어 숨 사이 간격의 변동계수(CV) → 렘 판정에 쓰임.
 * 3. 무호흡·저호흡 의심 사건: 숨 쉬던 소리가 30초 중앙값의 70% 아래로 10초 이상 줄었다가 돌아오면
 *    줄어든 정도가 50% 넘으면 무호흡, 30~50%면 저호흡.
 *
 * 원본과 다른 점: 숨이 돌아올 때 '헐떡임(gasp)' 판정(FFT 필요)은 옮기지 않았다. 원본에서 헐떡임은
 * 사건의 신뢰도만 올리고 사건 수는 바꾸지 않는다. 사건이 끝난 뒤 5초 동안 새 사건을 보지 않는 규칙은 그대로 둔다.
 *
 * 기준값은 모두 원작자가 합성 소리로 맞춘 값이며 실제 사람으로 검증되지 않았다.
 */
final class BreathingTracker {

    // ── apnea_config.rs ──
    static final int FRAMES_PER_SECOND = 100;
    private static final float SAMPLE_RATE = 16_000f;
    private static final float RESP_HP_HZ = 100f;
    private static final float RESP_LP_HZ = 2_000f;
    private static final float RESP_SMOOTH_MS = 300f;
    private static final int NOISE_BUCKET_FRAMES = 10;
    private static final int NOISE_FLOOR_BUCKETS = 600;
    private static final float NOISE_FLOOR_PERCENTILE = 0.10f;
    private static final float NOISE_FLOOR_DEFAULT_DB = -80f;
    private static final float PERIODICITY_DOWNSAMPLE_HZ = 20f;
    private static final int PERIODICITY_DOWNSAMPLE_FRAMES = 5;
    private static final int PERIODICITY_RING_SAMPLES = 900;
    private static final float BREATH_PERIOD_MIN_S = 2f;
    private static final float BREATH_PERIOD_MAX_S = 8f;
    private static final float PERIODICITY_CONFIDENCE_THRESHOLD = 0.30f;
    private static final float PERIODICITY_TIE_EPSILON = 0.05f;
    private static final int PERIODICITY_UPDATE_FRAMES = 100;
    private static final int PERIODICITY_MIN_SAMPLES = 200;
    private static final int BREATHING_MEDIAN_FRAMES = 3_000;
    private static final int BREATHING_MEDIAN_UPDATE_FRAMES = 100;
    private static final float DECREMENT_FLOOR_OFFSET_DB = 3f;
    private static final float DECREMENT_ENTRY_REDUCTION = 0.30f;
    private static final float DECREMENT_EXIT_FRACTION = 0.80f;
    private static final float MIN_EVENT_DURATION_S = 10f;
    private static final float MAX_EVENT_DURATION_S = 120f;
    private static final float HYPOPNEA_REDUCTION_LOW = 0.30f;
    private static final float HYPOPNEA_REDUCTION_HIGH = 0.50f;
    private static final float BREATHING_CONFIRM_S = 2f;
    private static final float GASP_WINDOW_AFTER_S = 5f;

    // ── phase_config.rs ──
    private static final float BREATH_PEAK_PROMINENCE = 1.15f;
    private static final float BREATH_TROUGH_ARM = 0.80f;
    private static final float BREATH_PEAK_FLOOR_MARGIN_DB = 6f;
    private static final long BREATH_PEAK_MIN_SEP_FRAMES = 150;
    private static final long BREATH_INTERVAL_MAX_FRAMES = 1_000;
    static final float REM_BREATHING_FRACTION_MIN = 0.5f;
    static final int REM_MIN_BREATH_INTERVALS = 3;

    // 사건 종류 — DeltaSleep EventType 순서
    static final int EVENT_APNEA = 0;
    static final int EVENT_HYPOPNEA = 1;

    // ── 숨소리 대역 필터 (RespBandPass: 고역 100Hz → 저역 2kHz) ──
    private static final float DT = 1f / SAMPLE_RATE;
    private static final float RC_HP = (float) (1.0 / (2.0 * Math.PI * RESP_HP_HZ));
    private static final float RC_LP = (float) (1.0 / (2.0 * Math.PI * RESP_LP_HZ));
    private static final float ALPHA_HP = RC_HP / (RC_HP + DT);
    private static final float ALPHA_LP = DT / (RC_LP + DT);
    private static final float ENV_ALPHA =
        (float) (1.0 - Math.exp(-(1000.0 / FRAMES_PER_SECOND) / RESP_SMOOTH_MS));

    private float hpPrevIn;
    private float hpPrevOut;
    private float lpPrevOut;
    private float envelope;

    // ── 잡음 바닥 (60초 동안 0.1초 최솟값들의 하위 10%) ──
    private final float[] noiseBuckets = new float[NOISE_FLOOR_BUCKETS];
    private final float[] noiseScratch = new float[NOISE_FLOOR_BUCKETS];
    private int noiseHead;
    private int noiseFilled;
    private float bucketMin = Float.POSITIVE_INFINITY;
    private int framesInBucket;
    private float floorDb = NOISE_FLOOR_DEFAULT_DB;

    // ── 숨 리듬 (45초 자기상관) ──
    private final float[] periodRing = new float[PERIODICITY_RING_SAMPLES];
    private final float[] periodScratch = new float[PERIODICITY_RING_SAMPLES];
    private final float[] corrAtLag = new float[(int) (BREATH_PERIOD_MAX_S * PERIODICITY_DOWNSAMPLE_HZ) + 1];
    private int periodHead;
    private int periodFilled;
    private boolean breathingPresent;
    private float periodS;
    private float periodConfidence;

    // ── 30초 숨소리 중앙값 ──
    private final float[] medianRing = new float[BREATHING_MEDIAN_FRAMES];
    private final float[] medianScratch = new float[BREATHING_MEDIAN_FRAMES];
    private int medianHead;
    private int medianFilled;
    private float medianLin;

    // ── 숨 봉우리 검출 ──
    private float prevEnv;
    private boolean rising;
    private float peakMax;
    private long framesSincePeak;
    private boolean havePeak;
    private boolean peakArmed = true;

    // ── 사건 상태 기계 ──
    private static final int ST_NO_SIGNAL = 0;
    private static final int ST_BREATHING = 1;
    private static final int ST_DECREMENT = 2;
    private static final int ST_AFTER_EVENT = 3;
    private int state = ST_NO_SIGNAL;
    private long breathingStreak;
    private long decrementStart;
    private float baselineLin;
    private float minEnvLin;
    private long afterEventDeadline;

    /** 끝난 사건 {시작 조각 번호, 길이(조각 수), 종류}. drainEvents 로 꺼낸다. */
    private final List<long[]> events = new ArrayList<>();

    // ── 30초 칸 누적 ──
    private int epochFrames;
    private int breathingFrames;
    private double periodSum;
    private int periodCount;
    private double intervalSum;
    private double intervalSqSum;
    private int intervalCount;

    static float db(float lin) {
        return (float) (20.0 * Math.log10(lin + 1e-6));
    }

    static float dbToLin(float db) {
        return (float) Math.pow(10.0, db / 20.0);
    }

    /** 조각 하나 처리. frameIdx 는 녹음 시작부터 센 조각 번호(0부터). */
    void process(short[] samples, int n, long frameIdx) {
        // 1. 숨소리 대역 크기 + 0.3초 평활
        float sumSq = 0f;
        for (int i = 0; i < n; i++) {
            float x = samples[i] / 32_768f;
            float hp = ALPHA_HP * (hpPrevOut + x - hpPrevIn);
            hpPrevIn = x;
            hpPrevOut = hp;
            lpPrevOut = ALPHA_LP * hp + (1f - ALPHA_LP) * lpPrevOut;
            sumSq += lpPrevOut * lpPrevOut;
        }
        float frameRms = n > 0 ? (float) Math.sqrt(sumSq / n) : 0f;
        envelope += ENV_ALPHA * (frameRms - envelope);
        float env = envelope;

        // 2. 잡음 바닥
        updateNoiseFloor(db(frameRms));

        // 3. 숨 리듬 — 0.05초마다 모으고 1초마다 다시 계산
        if (frameIdx % PERIODICITY_DOWNSAMPLE_FRAMES == 0) {
            periodRing[periodHead] = env;
            periodHead = (periodHead + 1) % PERIODICITY_RING_SAMPLES;
            periodFilled = Math.min(periodFilled + 1, PERIODICITY_RING_SAMPLES);
        }
        if (frameIdx % PERIODICITY_UPDATE_FRAMES == 0) computePeriodicity();

        // 4. 30초 중앙값 — 1초마다 다시 계산
        medianRing[medianHead] = env;
        medianHead = (medianHead + 1) % BREATHING_MEDIAN_FRAMES;
        medianFilled = Math.min(medianFilled + 1, BREATHING_MEDIAN_FRAMES);
        if (frameIdx % BREATHING_MEDIAN_UPDATE_FRAMES == 0) recomputeMedian();
        float medianDb = db(medianLin);

        // 4b. 숨 봉우리 → 숨 간격
        detectBreathPeak(env);

        // 7. 사건 상태 기계
        updateMachine(frameIdx, env, medianDb);

        // 8. 30초 칸 누적
        epochFrames++;
        if (breathingPresent) {
            breathingFrames++;
            periodSum += periodS;
            periodCount++;
        }
    }

    /** 30초 칸 마무리 — 숨 결과를 돌려주고 누적을 비운다. */
    EpochBreath takeEpoch() {
        float fraction = epochFrames > 0 ? breathingFrames / (float) epochFrames : 0f;
        float cv = 0f;
        if (intervalCount >= 2) {
            double mean = intervalSum / intervalCount;
            double var = Math.max(0.0, intervalSqSum / intervalCount - mean * mean);
            cv = mean > 1e-6 ? (float) (Math.sqrt(var) / mean) : 0f;
        }
        boolean present = fraction > REM_BREATHING_FRACTION_MIN || intervalCount >= REM_MIN_BREATH_INTERVALS;
        float period = periodCount > 0 ? (float) (periodSum / periodCount) : 0f;
        EpochBreath out = new EpochBreath(present, period, cv);

        epochFrames = 0;
        breathingFrames = 0;
        periodSum = 0;
        periodCount = 0;
        intervalSum = 0;
        intervalSqSum = 0;
        intervalCount = 0;
        return out;
    }

    /** 끝난 무호흡·저호흡 사건을 꺼낸다. 각 원소 {시작 조각 번호, 길이(조각 수), 종류}. */
    List<long[]> drainEvents() {
        if (events.isEmpty()) return java.util.Collections.emptyList();
        List<long[]> out = new ArrayList<>(events);
        events.clear();
        return out;
    }

    // 테스트용
    boolean breathingPresent() { return breathingPresent; }
    float periodSeconds() { return periodS; }

    static final class EpochBreath {
        /** 이 30초에 숨 리듬이 잡혔는지(절반 넘는 조각, 또는 숨 3번 이상). */
        final boolean breathingPresent;
        /** 숨 쉬는 동안의 평균 숨 주기(초). 숨이 한 번도 안 잡혔으면 0. */
        final float breathPeriodS;
        /** 숨 간격 변동계수 — 클수록 불규칙. 간격이 2개 미만이면 0. */
        final float breathPeriodCv;

        EpochBreath(boolean breathingPresent, float breathPeriodS, float breathPeriodCv) {
            this.breathingPresent = breathingPresent;
            this.breathPeriodS = breathPeriodS;
            this.breathPeriodCv = breathPeriodCv;
        }
    }

    // ───────── 내부 ─────────

    private void updateNoiseFloor(float frameDb) {
        bucketMin = Math.min(bucketMin, frameDb);
        framesInBucket++;
        if (framesInBucket < NOISE_BUCKET_FRAMES) return;
        noiseBuckets[noiseHead] = bucketMin;
        noiseHead = (noiseHead + 1) % NOISE_FLOOR_BUCKETS;
        noiseFilled = Math.min(noiseFilled + 1, NOISE_FLOOR_BUCKETS);
        bucketMin = Float.POSITIVE_INFINITY;
        framesInBucket = 0;
        int k = noiseFilled;
        System.arraycopy(noiseBuckets, 0, noiseScratch, 0, k);
        Arrays.sort(noiseScratch, 0, k);
        floorDb = noiseScratch[Math.min((int) (k * NOISE_FLOOR_PERCENTILE), k - 1)];
    }

    private void computePeriodicity() {
        int n = periodFilled;
        if (n < PERIODICITY_MIN_SAMPLES) {
            setPeriodicity(false, 0f, 0f);
            return;
        }
        int cap = PERIODICITY_RING_SAMPLES;
        int start = (periodHead + cap - n) % cap;
        float mean = 0f;
        for (int i = 0; i < n; i++) {
            periodScratch[i] = periodRing[(start + i) % cap];
            mean += periodScratch[i];
        }
        mean /= n;
        float r0 = 0f;
        for (int i = 0; i < n; i++) {
            periodScratch[i] -= mean;
            r0 += periodScratch[i] * periodScratch[i];
        }
        r0 /= n;
        if (r0 < 1e-16f) {
            setPeriodicity(false, 0f, 0f);
            return;
        }
        int lagMin = (int) (BREATH_PERIOD_MIN_S * PERIODICITY_DOWNSAMPLE_HZ);
        int lagMax = (int) (BREATH_PERIOD_MAX_S * PERIODICITY_DOWNSAMPLE_HZ);
        float best = -Float.MAX_VALUE;
        int lastLag = lagMin - 1;
        for (int lag = lagMin; lag <= lagMax; lag++) {
            if (lag + PERIODICITY_MIN_SAMPLES / 2 > n) break;
            int m = n - lag;
            float r = 0f;
            for (int i = 0; i < m; i++) r += periodScratch[i] * periodScratch[i + lag];
            corrAtLag[lag] = (r / m) / r0;
            best = Math.max(best, corrAtLag[lag]);
            lastLag = lag;
        }
        // 두 배 주기 오인 방지: 최대값에 가까운(0.05 이내) 가장 짧은 주기
        int bestLag = lagMin;
        for (int lag = lagMin; lag <= lastLag; lag++) {
            if (corrAtLag[lag] >= best - PERIODICITY_TIE_EPSILON) {
                bestLag = lag;
                break;
            }
        }
        float confidence = Math.max(0f, Math.min(1f, best));
        setPeriodicity(confidence > PERIODICITY_CONFIDENCE_THRESHOLD, bestLag / PERIODICITY_DOWNSAMPLE_HZ, confidence);
    }

    private void setPeriodicity(boolean present, float period, float confidence) {
        breathingPresent = present;
        periodS = period;
        periodConfidence = confidence;
    }

    private void recomputeMedian() {
        int n = medianFilled;
        if (n == 0) {
            medianLin = 0f;
            return;
        }
        System.arraycopy(medianRing, 0, medianScratch, 0, n);
        Arrays.sort(medianScratch, 0, n);
        medianLin = medianScratch[n / 2];
    }

    private void detectBreathPeak(float env) {
        framesSincePeak++;
        if (env < BREATH_TROUGH_ARM * medianLin) peakArmed = true;
        if (env > prevEnv) {
            if (!rising) {
                rising = true;
                peakMax = env;
            } else if (env > peakMax) {
                peakMax = env;
            }
        } else if (env < prevEnv && rising) {
            rising = false;
            if (!havePeak) {
                havePeak = true; // 첫 봉우리는 시계만 맞춘다
                framesSincePeak = 0;
            } else if (peakArmed
                && framesSincePeak >= BREATH_PEAK_MIN_SEP_FRAMES
                && peakMax > BREATH_PEAK_PROMINENCE * medianLin
                && db(peakMax) > floorDb + BREATH_PEAK_FLOOR_MARGIN_DB) {
                if (framesSincePeak <= BREATH_INTERVAL_MAX_FRAMES) {
                    float intervalS = framesSincePeak / (float) FRAMES_PER_SECOND;
                    intervalSum += intervalS;
                    intervalSqSum += intervalS * intervalS;
                    intervalCount++;
                }
                framesSincePeak = 0;
                peakArmed = false;
            }
        }
        prevEnv = env;
    }

    private void updateMachine(long frameIdx, float env, float medianDb) {
        switch (state) {
            case ST_NO_SIGNAL: {
                breathingStreak = breathingPresent ? breathingStreak + 1 : 0;
                if (breathingStreak >= (long) (BREATHING_CONFIRM_S * FRAMES_PER_SECOND)) state = ST_BREATHING;
                break;
            }
            case ST_BREATHING: {
                // 숨소리 기준이 방 잡음과 구분 안 되면 판단하지 않는다
                if (medianDb <= floorDb + DECREMENT_FLOOR_OFFSET_DB) break;
                float entry = Math.max(dbToLin(floorDb + DECREMENT_FLOOR_OFFSET_DB),
                    (1f - DECREMENT_ENTRY_REDUCTION) * medianLin);
                if (env < entry) {
                    state = ST_DECREMENT;
                    decrementStart = frameIdx;
                    baselineLin = medianLin;
                    minEnvLin = env;
                }
                break;
            }
            case ST_DECREMENT: {
                minEnvLin = Math.min(minEnvLin, env);
                long duration = frameIdx - decrementStart;
                if (duration > (long) (MAX_EVENT_DURATION_S * FRAMES_PER_SECOND)) {
                    // 2분 넘게 조용함 — 숨이 멈춘 게 아니라 소리를 놓친 것
                    state = ST_NO_SIGNAL;
                    breathingStreak = 0;
                    break;
                }
                if (env > DECREMENT_EXIT_FRACTION * baselineLin) {
                    if (duration >= (long) (MIN_EVENT_DURATION_S * FRAMES_PER_SECOND)) {
                        float reduction = Math.max(0f, Math.min(1f, 1f - minEnvLin / Math.max(baselineLin, 1e-9f)));
                        if (reduction >= HYPOPNEA_REDUCTION_LOW) {
                            int type = reduction > HYPOPNEA_REDUCTION_HIGH ? EVENT_APNEA : EVENT_HYPOPNEA;
                            events.add(new long[] {decrementStart, duration, type});
                            afterEventDeadline = frameIdx + (long) (GASP_WINDOW_AFTER_S * FRAMES_PER_SECOND);
                            state = ST_AFTER_EVENT;
                            break;
                        }
                    }
                    state = ST_BREATHING; // 너무 짧거나 얕음
                }
                break;
            }
            case ST_AFTER_EVENT: {
                if (frameIdx >= afterEventDeadline) state = ST_BREATHING;
                break;
            }
            default:
                break;
        }
    }
}
