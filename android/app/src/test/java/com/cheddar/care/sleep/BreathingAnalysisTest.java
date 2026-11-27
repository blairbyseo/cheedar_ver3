package com.cheddar.care.sleep;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import java.time.ZoneId;
import java.util.ArrayList;
import java.util.List;
import java.util.Random;
import org.junit.Test;

/** 2026-11-27 추가: 숨소리 추적(호흡수·무호흡) · 렘 판정 · 밤 요약 추가 지표. */
public class BreathingAnalysisTest {

    private static final ZoneId SEOUL = ZoneId.of("Asia/Seoul");
    private static final int FS = SleepAnalyzer.SAMPLE_RATE;

    // ───── 렘 판정 (DeltaSleep classifier.rs 테스트 그대로) ─────

    @Test
    public void classifier_remRuleMatchesDeltaSleep() {
        // 고른 숨 → 렘 아님
        assertEquals(Epoch.DEEP, EpochClassifier.classify(0.003f, 1e-5f, true, 0.02f, 0f));
        assertEquals(Epoch.LIGHT, EpochClassifier.classify(0.010f, 1e-5f, true, 0.02f, 0f));
        // 거의 안 움직이고 숨이 불규칙 → 렘
        assertEquals(Epoch.REM, EpochClassifier.classify(0.010f, 5e-5f, true, 0.35f, 0f));
        assertEquals(Epoch.REM, EpochClassifier.classify(0.003f, 5e-5f, true, 0.40f, 0.1f));
        // 조건 하나라도 빠지면 렘 아님
        assertTrue(EpochClassifier.classify(0.010f, 5e-5f, false, 0.90f, 0f) != Epoch.REM); // 숨 없음
        assertTrue(EpochClassifier.classify(0.010f, 5e-5f, true, 0.10f, 0f) != Epoch.REM);  // 고른 숨
        assertEquals(Epoch.AWAKE, EpochClassifier.classify(0.050f, 0.002f, true, 0.90f, 0f)); // 많이 움직임
        assertEquals(Epoch.LIGHT, EpochClassifier.classify(0.010f, 5e-4f, true, 0.90f, 0f));  // 꽤 움직임
        assertEquals(Epoch.LIGHT, EpochClassifier.classify(0.010f, 5e-5f, true, 0.90f, 0.7f)); // TV 소리
    }

    // ───── 숨 리듬 → 호흡수 ─────

    @Test
    public void tracker_findsFourSecondBreathing() {
        BreathingTracker t = new BreathingTracker();
        Random r = new Random(3);
        long frames = 60L * 100; // 60초
        for (long i = 0; i < frames; i++) t.process(breath(r, i, 4.0, false), 160, i);
        assertTrue("숨이 잡혀야 함", t.breathingPresent());
        assertEquals(4.0, t.periodSeconds(), 0.3);
    }

    @Test
    public void tracker_quietRoomHasNoBreathing() {
        BreathingTracker t = new BreathingTracker();
        Random r = new Random(4);
        for (long i = 0; i < 60L * 100; i++) t.process(noise(r, 0.001), 160, i);
        assertFalse(t.breathingPresent());
    }

    @Test
    public void analyzer_epochCarriesBreathPeriod() {
        SleepAnalyzer a = new SleepAnalyzer();
        Random r = new Random(5);
        Epoch last = null;
        for (long i = 0; i < 3000L * 3; i++) {
            Epoch e = a.process(breath(r, i, 4.0, false), 1_000_000L + i * 10L);
            if (e != null) last = e;
        }
        assertNotNull(last);
        assertEquals(4.0, last.breathPeriodS, 0.3); // 호흡수 15회/분
    }

    // ───── 무호흡 ─────

    @Test
    public void analyzer_twentySecondPauseIsApnea() {
        SleepAnalyzer a = new SleepAnalyzer();
        Random r = new Random(6);
        long t0 = 1_000_000L;
        long apneaStart = 120L * 100, apneaEnd = 140L * 100; // 2:00~2:20 숨 멈춤
        List<long[]> events = new ArrayList<>();
        for (long i = 0; i < 200L * 100; i++) {
            boolean pause = i >= apneaStart && i < apneaEnd;
            a.process(breath(r, i, 4.0, pause), t0 + i * 10L);
            events.addAll(a.drainEvents());
        }
        assertEquals("사건 " + events.size() + "개", 1, events.size());
        long[] ev = events.get(0);
        assertEquals(BreathingTracker.EVENT_APNEA, ev[1]);
        assertTrue("길이 " + ev[2], ev[2] >= 10_000 && ev[2] <= 40_000);
        long mid = t0 + (apneaStart + apneaEnd) / 2 * 10L;
        assertTrue("가운데 시각이 멈춘 구간 근처", Math.abs(ev[0] - mid) < 10_000);
    }

    @Test
    public void analyzer_steadyBreathingHasNoEvents() {
        SleepAnalyzer a = new SleepAnalyzer();
        Random r = new Random(7);
        int count = 0;
        for (long i = 0; i < 300L * 100; i++) {
            a.process(breath(r, i, 4.0, false), 1_000_000L + i * 10L);
            count += a.drainEvents().size();
        }
        assertEquals(0, count);
    }

    // ───── 밤 요약 추가 지표 ─────

    @Test
    public void summary_stagesWakeEfficiencyBreathingAndEvents() {
        long t0 = java.time.ZonedDateTime.of(2026, 11, 26, 23, 0, 0, 0, SEOUL).toInstant().toEpochMilli();
        List<Epoch> night = new ArrayList<>();
        long t = t0;
        t = add(night, t, Epoch.DEEP, 60, 4f);   // 23:00 잠듦 — 깊은 잠 60분
        t = add(night, t, Epoch.AWAKE, 5, 0f);   // 5분 깸 (1회)
        t = add(night, t, Epoch.LIGHT, 60, 4f);
        long apneaAt = t + 10 * 60_000L;          // 얕은 잠 중간
        t = add(night, t, Epoch.REM, 30, 3f);    // 잠든 지 125분 뒤 렘 30분
        t = add(night, t, Epoch.AWAKE, 2, 0f);   // 2분 깸 (2회째)
        t = add(night, t, Epoch.LIGHT, 60, 0f);  // 숨 안 잡힌 얕은 잠
        long awakeEventAt = t + 30_000L;
        add(night, t, Epoch.AWAKE, 30, 0f);      // 일어난 뒤

        List<long[]> events = new ArrayList<>();
        events.add(new long[] {apneaAt - 30 * 60_000L, 0}); // 얕은 잠 중 무호흡
        events.add(new long[] {apneaAt, 1});                // 렘 중 저호흡
        events.add(new long[] {awakeEventAt, 0});           // 깬 뒤 — 버림

        NightSummary.Result r = NightSummary.compute("s1", night, events, false, SEOUL);
        assertNotNull(r);
        assertEquals(60 + 60 + 30 + 60, r.asleepMinutes);
        assertEquals(60, r.deepMinutes);
        assertEquals(30, r.remMinutes);
        assertEquals(120, r.lightMinutes);
        assertEquals(r.asleepMinutes, r.deepMinutes + r.lightMinutes + r.remMinutes);
        assertEquals(7, r.awakeMinutes);
        assertEquals(2, r.awakenings);
        assertEquals(Math.round(210 * 100.0 / 217), r.sleepEfficiency);
        // 숨 잡힌 칸: 깊은 60분(15회) + 얕은 60분(15회) + 렘 30분(20회) → 중앙값 15
        assertEquals(15.0f, r.breathingRate, 0.01f);
        assertEquals(Math.round(150 * 100f / 210), r.breathingDetectedPct);
        assertEquals(1, r.apneaCount);
        assertEquals(1, r.hypopneaCount);
    }

    @Test
    public void summary_earlyAndShortRemBecomeLight() {
        long t0 = java.time.ZonedDateTime.of(2026, 11, 26, 23, 0, 0, 0, SEOUL).toInstant().toEpochMilli();
        List<Epoch> night = new ArrayList<>();
        long t = t0;
        t = add(night, t, Epoch.REM, 30, 4f);    // 잠든 지 60분 안 → 얕은 잠
        t = add(night, t, Epoch.LIGHT, 90, 4f);
        t = addEpochs(night, t, Epoch.REM, 3);   // 3칸(1.5분) 렘 → 다듬기에서 사라지거나 얕은 잠
        t = add(night, t, Epoch.LIGHT, 60, 4f);
        NightSummary.Result r = NightSummary.compute("s2", night, false, SEOUL);
        assertNotNull(r);
        assertEquals(0, r.remMinutes);
        assertEquals(r.asleepMinutes, r.lightMinutes + r.deepMinutes);
    }

    @Test
    public void summary_noBreathingMeansNullRate() {
        long t0 = java.time.ZonedDateTime.of(2026, 11, 26, 23, 0, 0, 0, SEOUL).toInstant().toEpochMilli();
        List<Epoch> night = new ArrayList<>();
        add(night, t0, Epoch.LIGHT, 180, 0f);
        NightSummary.Result r = NightSummary.compute("s3", night, false, SEOUL);
        assertNotNull(r);
        assertNull(r.breathingRate);
        assertEquals(0, r.breathingDetectedPct);
        assertEquals(0, r.apneaCount);
    }

    @Test
    public void epoch_oldFiveFieldLineStillReads_newLineKeepsPeriod() {
        Epoch old = Epoch.fromLine("1000,2,0.003,1.0E-5,0.0");
        assertNotNull(old);
        assertEquals(0f, old.breathPeriodS, 0f);
        Epoch e = new Epoch(2000L, Epoch.REM, 0.01f, 5e-5f, 0.1f, 3.5f);
        Epoch back = Epoch.fromLine(e.toLine());
        assertNotNull(back);
        assertEquals(Epoch.REM, back.phase);
        assertEquals(3.5f, back.breathPeriodS, 0f);
        assertNull("사건 줄은 칸이 아님", Epoch.fromLine("E,123,0,15000"));
    }

    // ───── 가짜 소리 ─────

    /**
     * 숨소리 흉내: 800Hz 소리의 크기를 periodS 주기로 0.002~0.02 사이에서 오르내린다(+ 작은 잡음).
     * pause 면 잡음만(숨 멈춤).
     */
    private static short[] breath(Random r, long frame, double periodS, boolean pause) {
        short[] out = new short[160];
        double phase = (frame / 100.0) / periodS * 2 * Math.PI;
        double amp = pause ? 0.0 : 0.002 + 0.018 * (0.5 - 0.5 * Math.cos(phase));
        for (int i = 0; i < 160; i++) {
            double s = amp * Math.sin(2 * Math.PI * 800 * (frame * 160 + i) / FS) + r.nextGaussian() * 0.0003;
            out[i] = clip(s);
        }
        return out;
    }

    private static short[] noise(Random r, double rms) {
        short[] out = new short[160];
        for (int i = 0; i < 160; i++) out[i] = clip(r.nextGaussian() * rms);
        return out;
    }

    private static short clip(double v) {
        return (short) Math.max(-32768, Math.min(32767, Math.round(v * 32768)));
    }

    private static long add(List<Epoch> out, long t, int phase, int minutes, float breathPeriodS) {
        for (int i = 0; i < minutes * 2; i++) {
            t += 30_000L;
            out.add(new Epoch(t, phase, phase == Epoch.AWAKE ? 0.05f : 0.003f, 1e-5f, 0f, breathPeriodS));
        }
        return t;
    }

    private static long addEpochs(List<Epoch> out, long t, int phase, int epochs) {
        for (int i = 0; i < epochs; i++) {
            t += 30_000L;
            out.add(new Epoch(t, phase, 0.003f, 1e-5f, 0f, 4f));
        }
        return t;
    }
}
