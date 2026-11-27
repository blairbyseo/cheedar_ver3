package com.cheddar.care.sleep;

/*
 * Portions adapted from DeltaSleep (https://github.com/ntufar/DeltaSleep),
 * dsp/src/engine.rs (EpochAccumulator / compute_epoch)
 * MIT License · Copyright (c) 2026 Nicolai Tufar
 */

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

/**
 * 0.01초 조각을 받아 숫자로 바꾸고, 3,000개(30초)가 모이면 판정 한 칸을 돌려준다.
 * 녹음 서비스가 밤새 같은 객체 하나에 계속 넣는다. 안드로이드 API 를 쓰지 않아 기기 없이 시험 가능.
 *
 * 30초는 시계가 아니라 조각 수(3,000개)로 센다 — DeltaSleep 과 같음.
 * 2026-11-27: 숨소리 추적(BreathingTracker)을 붙여 렘 판정·숨 주기·무호흡/저호흡 사건을 만든다.
 */
public final class SleepAnalyzer {

    public static final int SAMPLE_RATE = 16_000;
    public static final int FRAME_SAMPLES = 160;      // 0.01초
    public static final int FRAMES_PER_EPOCH = 3_000; // 30초
    private static final long FRAME_MS = 1000L / BreathingTracker.FRAMES_PER_SECOND;

    private final SoundFeatures features = new SoundFeatures();
    private final SpeechDetector speech = new SpeechDetector();
    private final BreathingTracker breathing = new BreathingTracker();
    private long frameIdx;

    // 30초 메모장 — 소리는 없고 숫자 합계만
    private double rmsSum;
    private double rmsSqSum;
    private int count;
    private int speechFrames;

    /** 끝난 사건 {가운데 시각ms, 종류(0 무호흡·1 저호흡), 길이ms}. drainEvents 로 꺼낸다. */
    private final List<long[]> events = new ArrayList<>();

    /** 조각 하나 처리. 30초가 찼으면 그 칸을, 아니면 null. nowMs 는 칸의 끝 시각으로 쓰인다. */
    public Epoch process(short[] frame, long nowMs) {
        features.compute(frame, FRAME_SAMPLES);
        boolean isSpeech = speech.update(frameIdx, features.speechRatio, features.speechRms);
        breathing.process(frame, FRAME_SAMPLES, frameIdx);

        // 사건은 '몇 번째 조각'으로 나오므로 지금 시각에서 거슬러 실제 시각으로 바꾼다
        for (long[] ev : breathing.drainEvents()) {
            long midFrame = ev[0] + ev[1] / 2;
            long midMs = nowMs - (frameIdx - midFrame) * FRAME_MS;
            events.add(new long[] {midMs, ev[2], ev[1] * FRAME_MS});
        }
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
        BreathingTracker.EpochBreath b = breathing.takeEpoch();
        int phase = EpochClassifier.classify(meanRms, variance, b.breathingPresent, b.breathPeriodCv, external);
        Epoch e = new Epoch(nowMs, phase, meanRms, variance, external, b.breathPeriodS);

        rmsSum = 0;
        rmsSqSum = 0;
        count = 0;
        speechFrames = 0;
        return e;
    }

    /** 끝난 무호흡·저호흡 의심 사건을 꺼낸다. 각 원소 {가운데 시각ms, 종류, 길이ms}. */
    public List<long[]> drainEvents() {
        if (events.isEmpty()) return Collections.emptyList();
        List<long[]> out = new ArrayList<>(events);
        events.clear();
        return out;
    }
}
