package com.cheddar.care.sleep;

/*
 * Portions adapted from DeltaSleep (https://github.com/ntufar/DeltaSleep),
 * dsp/src/engine.rs (EpochAccumulator / compute_epoch)
 * MIT License · Copyright (c) 2026 Nicolai Tufar
 */

/**
 * 0.01초 조각을 받아 숫자로 바꾸고, 3,000개(30초)가 모이면 판정 한 칸을 돌려준다.
 * 녹음 서비스가 밤새 같은 객체 하나에 계속 넣는다. 안드로이드 API 를 쓰지 않아 기기 없이 시험 가능.
 *
 * 30초는 시계가 아니라 조각 수(3,000개)로 센다 — DeltaSleep 과 같음.
 */
public final class SleepAnalyzer {

    public static final int SAMPLE_RATE = 16_000;
    public static final int FRAME_SAMPLES = 160;      // 0.01초
    public static final int FRAMES_PER_EPOCH = 3_000; // 30초

    private final SoundFeatures features = new SoundFeatures();
    private final SpeechDetector speech = new SpeechDetector();
    private long frameIdx;

    // 30초 메모장 — 소리는 없고 숫자 합계만
    private double rmsSum;
    private double rmsSqSum;
    private int count;
    private int speechFrames;

    /** 조각 하나 처리. 30초가 찼으면 그 칸을, 아니면 null. nowMs 는 칸의 끝 시각으로 쓰인다. */
    public Epoch process(short[] frame, long nowMs) {
        features.compute(frame, FRAME_SAMPLES);
        boolean isSpeech = speech.update(frameIdx, features.speechRatio, features.speechRms);
        frameIdx++;

        rmsSum += features.rms;
        rmsSqSum += (double) features.rms * features.rms;
        count++;
        if (isSpeech) speechFrames++;

        if (count < FRAMES_PER_EPOCH) return null;

        double mean = rmsSum / count;
        float meanRms = (float) mean;
        float variance = (float) Math.max(0.0, rmsSqSum / count - mean * mean);
        float external = speechFrames / (float) count;
        Epoch e = new Epoch(nowMs, EpochClassifier.classify(meanRms, variance), meanRms, variance, external);

        rmsSum = 0;
        rmsSqSum = 0;
        count = 0;
        speechFrames = 0;
        return e;
    }
}
