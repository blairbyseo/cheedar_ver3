package com.cheddar.care.sleep;

/*
 * Portions adapted from DeltaSleep (https://github.com/ntufar/DeltaSleep),
 * dsp/src/classifier.rs, dsp/src/phase_config.rs
 * MIT License · Copyright (c) 2026 Nicolai Tufar
 */

/**
 * 30초 요약 → 깸 / 얕은 잠 / 깊은 잠 / 렘(추정).
 *
 * 기준값은 DeltaSleep 원작자가 정한 고정값 그대로다(컴퓨터로 만든 가짜 밤 소리로 맞춘 값,
 * 실제 사람으로는 검증 안 됨). 마이크가 완전히 무음(0)이면 깸으로 보는 것도 원본(EpochProcessor.kt) 규칙.
 *
 * 렘(2026-11-27 추가, 원작자도 '검증 안 된 후보'로 표시): 몸이 거의 안 움직이고(소리 흔들림이
 * 깸 기준의 절반 미만) + 숨이 잡히고 + 숨 간격이 불규칙하고(변동계수 0.25 초과) + TV·대화 소리가
 * 절반 미만일 때. 움직임이 깸 기준을 넘으면 숨과 상관없이 깸.
 */
final class EpochClassifier {

    static final float AWAKE_RMS = 0.04f;
    static final float AWAKE_VAR = 0.0010f;
    static final float DEEP_RMS = 0.005f;
    static final float REM_MOVEMENT_MAX = 0.5f;
    static final float REM_BREATH_CV_MIN = 0.25f;
    static final float EXTERNAL_AUDIO_MAX = 0.5f;

    private EpochClassifier() {}

    /** 숨 정보 없이(예전 방식) 판정 — 렘은 나오지 않는다. */
    static int classify(float meanRms, float rmsVariance) {
        return classify(meanRms, rmsVariance, false, 0f, 0f);
    }

    static int classify(float meanRms, float rmsVariance, boolean breathingPresent,
                        float breathPeriodCv, float externalAudioFraction) {
        if (meanRms == 0f) return Epoch.AWAKE;
        if (meanRms > AWAKE_RMS || rmsVariance > AWAKE_VAR) return Epoch.AWAKE;
        float movementScore = rmsVariance / AWAKE_VAR;
        if (breathingPresent
            && movementScore < REM_MOVEMENT_MAX
            && breathPeriodCv > REM_BREATH_CV_MIN
            && externalAudioFraction < EXTERNAL_AUDIO_MAX) {
            return Epoch.REM;
        }
        if (meanRms < DEEP_RMS) return Epoch.DEEP;
        return Epoch.LIGHT;
    }
}
