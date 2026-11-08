package com.cheddar.care.sleep;

/*
 * Portions adapted from DeltaSleep (https://github.com/ntufar/DeltaSleep), dsp/src/classifier.rs
 * MIT License · Copyright (c) 2026 Nicolai Tufar
 */

/**
 * 30초 요약 → 깸 / 얕은 잠 / 깊은 잠.
 *
 * 기준값은 DeltaSleep 원작자가 정한 고정값 그대로다(컴퓨터로 만든 가짜 밤 소리로 맞춘 값,
 * 실제 사람으로는 검증 안 됨). 원본의 렘수면 추정 단계는 "검증 안 된 후보"라 뺐다.
 * 마이크가 완전히 무음(0)이면 깸으로 보는 것도 원본(EpochProcessor.kt) 규칙.
 */
final class EpochClassifier {

    static final float AWAKE_RMS = 0.04f;
    static final float AWAKE_VAR = 0.0010f;
    static final float DEEP_RMS = 0.005f;

    private EpochClassifier() {}

    static int classify(float meanRms, float rmsVariance) {
        if (meanRms == 0f) return Epoch.AWAKE;
        if (meanRms > AWAKE_RMS || rmsVariance > AWAKE_VAR) return Epoch.AWAKE;
        if (meanRms < DEEP_RMS) return Epoch.DEEP;
        return Epoch.LIGHT;
    }
}
