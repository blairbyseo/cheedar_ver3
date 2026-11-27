package com.cheddar.care.sleep;

/**
 * 30초 한 칸의 판정 기록. 소리 자체는 들어 있지 않다 — 숫자 요약과 판정만.
 * 기록 파일 한 줄: "끝난시각ms,판정,평균크기,크기분산,말소리비율,숨주기초"
 * (2026-11-27 전 버전은 숨주기 없이 5개 — 그대로 읽는다.)
 */
public final class Epoch {

    // 순서 값이 곧 다듬기(중앙값)에 쓰인다 — DeltaSleep SleepPhase 와 같은 순서
    public static final int AWAKE = 0;
    public static final int LIGHT = 1;
    public static final int DEEP = 2;
    /** 렘(추정) — 검증 안 된 후보 규칙. */
    public static final int REM = 3;

    public final long endMs;
    public final int phase;
    public final float meanRms;
    public final float rmsVariance;
    /** 30초 중 TV·대화처럼 말소리로 판단된 0.01초 조각의 비율 (0~1). */
    public final float externalAudioFraction;
    /** 숨 쉬는 동안의 평균 숨 주기(초). 숨이 안 잡혔거나 예전 기록이면 0. 호흡수 = 60 / 이 값. */
    public final float breathPeriodS;

    public Epoch(long endMs, int phase, float meanRms, float rmsVariance, float externalAudioFraction) {
        this(endMs, phase, meanRms, rmsVariance, externalAudioFraction, 0f);
    }

    public Epoch(long endMs, int phase, float meanRms, float rmsVariance, float externalAudioFraction, float breathPeriodS) {
        this.endMs = endMs;
        this.phase = phase;
        this.meanRms = meanRms;
        this.rmsVariance = rmsVariance;
        this.externalAudioFraction = externalAudioFraction;
        this.breathPeriodS = breathPeriodS;
    }

    /**
     * 마이크로 잰 칸이 아니라 '화면이 켜져 있던 시간'을 채운 칸인지(SleepAuto.awakeFill — 크기 0의 깸).
     * 마이크가 실제로 0을 읽은 칸도 같은 모양이지만, 그것도 '재지 못한 시간'이라 똑같이 다룬다.
     */
    public boolean isScreenOnFill() {
        return phase == AWAKE && meanRms == 0f;
    }

    public String toLine() {
        return endMs + "," + phase + "," + meanRms + "," + rmsVariance + "," + externalAudioFraction + "," + breathPeriodS;
    }

    /** 파일 한 줄 → Epoch. 깨진 줄(앱이 쓰다 꺼진 마지막 줄 등)·사건 줄("E,…")은 null. */
    public static Epoch fromLine(String line) {
        if (line == null) return null;
        String[] p = line.trim().split(",");
        if (p.length != 5 && p.length != 6) return null;
        try {
            int phase = Integer.parseInt(p[1]);
            if (phase < AWAKE || phase > REM) return null;
            float period = p.length == 6 ? Float.parseFloat(p[5]) : 0f;
            return new Epoch(Long.parseLong(p[0]), phase, Float.parseFloat(p[2]), Float.parseFloat(p[3]), Float.parseFloat(p[4]), period);
        } catch (NumberFormatException e) {
            return null;
        }
    }
}
