package com.cheddar.care.sleep;

/**
 * 30초 한 칸의 판정 기록. 소리 자체는 들어 있지 않다 — 숫자 요약과 판정만.
 * 기록 파일 한 줄: "끝난시각ms,판정,평균크기,크기분산,말소리비율"
 */
public final class Epoch {

    // 순서 값이 곧 다듬기(중앙값)에 쓰인다 — DeltaSleep SleepPhase 와 같은 순서
    public static final int AWAKE = 0;
    public static final int LIGHT = 1;
    public static final int DEEP = 2;

    public final long endMs;
    public final int phase;
    public final float meanRms;
    public final float rmsVariance;
    /** 30초 중 TV·대화처럼 말소리로 판단된 0.01초 조각의 비율 (0~1). */
    public final float externalAudioFraction;

    public Epoch(long endMs, int phase, float meanRms, float rmsVariance, float externalAudioFraction) {
        this.endMs = endMs;
        this.phase = phase;
        this.meanRms = meanRms;
        this.rmsVariance = rmsVariance;
        this.externalAudioFraction = externalAudioFraction;
    }

    public String toLine() {
        return endMs + "," + phase + "," + meanRms + "," + rmsVariance + "," + externalAudioFraction;
    }

    /** 파일 한 줄 → Epoch. 깨진 줄(앱이 쓰다 꺼진 마지막 줄 등)은 null. */
    public static Epoch fromLine(String line) {
        if (line == null) return null;
        String[] p = line.trim().split(",");
        if (p.length != 5) return null;
        try {
            int phase = Integer.parseInt(p[1]);
            if (phase < AWAKE || phase > DEEP) return null;
            return new Epoch(Long.parseLong(p[0]), phase, Float.parseFloat(p[2]), Float.parseFloat(p[3]), Float.parseFloat(p[4]));
        } catch (NumberFormatException e) {
            return null;
        }
    }
}
