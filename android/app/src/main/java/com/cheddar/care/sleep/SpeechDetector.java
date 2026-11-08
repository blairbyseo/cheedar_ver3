package com.cheddar.care.sleep;

/*
 * Portions adapted from DeltaSleep (https://github.com/ntufar/DeltaSleep),
 * dsp/src/apnea.rs (SyllabicTracker), dsp/src/engine.rs, dsp/src/apnea_config.rs
 * MIT License · Copyright (c) 2026 Nicolai Tufar
 */

/**
 * 이 0.01초 조각이 TV·대화 같은 '말소리'인지 판단한다.
 *
 * 말소리 대역 세기만 보면 숨소리도 걸리므로(숨소리도 그 대역에 걸침), 말 특유의
 * '음절 단위로 크기가 오르내리는 정도'를 같이 본다. 둘 다 넘어야 말소리.
 * - 0.05초마다(5조각) 말소리 대역 크기를 최근 5초(100개) 고리에 넣는다
 * - 1초마다(100조각) 고리에서 "이웃 값 차이 평균 / 평균"을 다시 계산한다
 * 숫자는 모두 DeltaSleep 원본 값.
 */
final class SpeechDetector {

    private static final int RING = 100;          // SYLLABIC_RING_SAMPLES (5초 @ 20Hz)
    private static final int DOWNSAMPLE = 5;      // PERIODICITY_DOWNSAMPLE_FRAMES
    private static final int UPDATE = 100;        // PERIODICITY_UPDATE_FRAMES (1초)
    private static final float SPEECH_RATIO_MIN = 0.35f;
    private static final float SYLLABIC_INDEX_MIN = 0.30f;

    private final float[] ring = new float[RING];
    private int head;
    private int filled;
    private float index;

    boolean update(long frameIdx, float speechRatio, float speechRms) {
        if (frameIdx % DOWNSAMPLE == 0) {
            ring[head] = speechRms;
            head = (head + 1) % RING;
            filled = Math.min(filled + 1, RING);
        }
        if (frameIdx % UPDATE == 0) recompute();
        return speechRatio > SPEECH_RATIO_MIN && index > SYLLABIC_INDEX_MIN;
    }

    private void recompute() {
        if (filled < 2) {
            index = 0f;
            return;
        }
        int start = (head + RING - filled) % RING;
        float mean = 0f;
        float diffSum = 0f;
        float prev = ring[start];
        for (int i = 0; i < filled; i++) {
            float v = ring[(start + i) % RING];
            mean += v;
            if (i > 0) diffSum += Math.abs(v - prev);
            prev = v;
        }
        mean /= filled;
        index = mean > 1e-9f ? diffSum / (filled - 1) / mean : 0f;
    }
}
