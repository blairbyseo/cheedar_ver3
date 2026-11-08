package com.cheddar.care.sleep;

/*
 * Portions adapted from DeltaSleep (https://github.com/ntufar/DeltaSleep), dsp/src/features.rs
 * MIT License · Copyright (c) 2026 Nicolai Tufar
 * (전문: android/app/src/main/assets/licenses/DeltaSleep-LICENSE.txt)
 */

/**
 * 0.01초 조각(16kHz 샘플 160개) → 숫자 몇 개.
 *
 * - rms         : 소리 크기 (샘플을 -1~1 로 맞춘 뒤 제곱평균제곱근)
 * - zcr         : 날카로움 (0을 지나는 횟수 / 샘플 수)
 * - speechRatio : 말소리 대역(300~3,000Hz) 세기 / 전체 세기
 * - speechRms   : 말소리 대역의 크기 (SpeechDetector 가 씀)
 *
 * DeltaSleep features.rs 의 계산을 그대로 옮겼다. 코골이 대역(20~300Hz)은 Cheddar 에서
 * 쓰지 않아 뺐다. 필터 상태가 조각 사이에 이어지므로 밤새 같은 객체를 써야 한다.
 * 호출마다 새 객체를 만들지 않도록 결과는 필드에 담는다(밤새 30만 번 호출).
 */
final class SoundFeatures {

    private static final float FS = 16_000f;
    private static final float DT = 1f / FS;
    private static final float RC_SPEECH_LP = (float) (1.0 / (2.0 * Math.PI * 3000.0));
    private static final float RC_SPEECH_HP = (float) (1.0 / (2.0 * Math.PI * 300.0));
    private static final float ALPHA_SPEECH_LP = DT / (RC_SPEECH_LP + DT);
    private static final float ALPHA_SPEECH_HP = RC_SPEECH_HP / (RC_SPEECH_HP + DT);

    // 1차 필터 상태 (저역통과 3,000Hz → 고역통과 300Hz)
    private float lpPrevOut;
    private float hpPrevIn;
    private float hpPrevOut;

    float rms;
    float zcr;
    float speechRatio;
    float speechRms;

    void compute(short[] samples, int n) {
        if (n <= 0) {
            rms = zcr = speechRatio = speechRms = 0f;
            return;
        }
        float sumSq = 0f;
        float speechSq = 0f;
        int zeroCrossings = 0;
        boolean prevSign = samples[0] >= 0;

        for (int i = 0; i < n; i++) {
            float x = samples[i] / 32_768f;
            sumSq += x * x;

            boolean sign = x >= 0f;
            if (sign != prevSign) zeroCrossings++;
            prevSign = sign;

            lpPrevOut = ALPHA_SPEECH_LP * x + (1f - ALPHA_SPEECH_LP) * lpPrevOut;
            float hp = ALPHA_SPEECH_HP * (hpPrevOut + lpPrevOut - hpPrevIn);
            hpPrevIn = lpPrevOut;
            hpPrevOut = hp;
            speechSq += hp * hp;
        }

        float totalPower = sumSq / n;
        float speechPower = speechSq / n;
        rms = (float) Math.sqrt(totalPower);
        zcr = zeroCrossings / (float) n;
        speechRatio = totalPower > 1e-10f ? speechPower / totalPower : 0f;
        speechRms = (float) Math.sqrt(speechPower);
    }
}
