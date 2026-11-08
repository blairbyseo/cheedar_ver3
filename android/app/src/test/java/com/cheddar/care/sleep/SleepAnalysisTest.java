package com.cheddar.care.sleep;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import java.time.ZoneId;
import java.util.ArrayList;
import java.util.List;
import java.util.Random;
import org.junit.Test;

/** 소리 계산 → 30초 판정 → 밤 요약. 가짜 소리를 넣어 기기 없이 확인한다. */
public class SleepAnalysisTest {

    private static final ZoneId SEOUL = ZoneId.of("Asia/Seoul");

    // ───── 판정 규칙 (DeltaSleep classifier.rs 테스트 중 렘 외 케이스) ─────

    @Test
    public void classifier_followsDeltaSleepThresholds() {
        assertEquals(Epoch.DEEP, EpochClassifier.classify(0.003f, 1e-5f));
        assertEquals(Epoch.LIGHT, EpochClassifier.classify(0.010f, 1e-5f));
        assertEquals(Epoch.AWAKE, EpochClassifier.classify(0.050f, 0.002f)); // 시끄럽고 출렁임
        assertEquals(Epoch.LIGHT, EpochClassifier.classify(0.010f, 5e-4f));  // 출렁이지만 기준 아래
        assertEquals(Epoch.AWAKE, EpochClassifier.classify(0.010f, 0.0011f)); // 출렁임만 넘음
        assertEquals(Epoch.AWAKE, EpochClassifier.classify(0f, 0f));          // 완전 무음 = 마이크 문제
    }

    // ───── 0.01초 숫자 계산 ─────

    @Test
    public void features_sineAmplitudeAndSpeechBand() {
        SoundFeatures f = new SoundFeatures();
        short[] tone = sine(1000, 0.5, 160, 0);
        // 필터가 자리 잡도록 몇 조각 먼저 흘린다
        for (int i = 0; i < 20; i++) f.compute(sine(1000, 0.5, 160, i * 160), 160);
        f.compute(tone, 160);
        assertEquals(0.5 / Math.sqrt(2), f.rms, 0.01);
        assertTrue("1kHz 는 말소리 대역", f.speechRatio > 0.35f);

        SoundFeatures low = new SoundFeatures();
        for (int i = 0; i < 20; i++) low.compute(sine(60, 0.5, 160, i * 160), 160);
        assertTrue("60Hz 웅 소리는 말소리 대역 아님", low.speechRatio < 0.35f);

        SoundFeatures silent = new SoundFeatures();
        silent.compute(new short[160], 160);
        assertEquals(0f, silent.rms, 0f);
        assertEquals(0f, silent.speechRatio, 0f);
    }

    // ───── 30초 판정 ─────

    @Test
    public void analyzer_emitsOneEpochPer3000Frames() {
        SleepAnalyzer a = new SleepAnalyzer();
        Random r = new Random(1);
        int emitted = 0;
        for (int i = 0; i < 3000 * 3; i++) {
            Epoch e = a.process(noise(r, 0.003), 1000L + i * 10L);
            if (e != null) {
                emitted++;
                assertEquals(1000L + i * 10L, e.endMs);
            }
        }
        assertEquals(3, emitted);
    }

    @Test
    public void analyzer_quietRoomIsDeep_softNoiseIsLight_loudIsAwake() {
        assertEquals(Epoch.DEEP, oneEpoch(r -> noise(r, 0.002)).phase);
        assertEquals(Epoch.LIGHT, oneEpoch(r -> noise(r, 0.015)).phase);
        assertEquals(Epoch.AWAKE, oneEpoch(r -> noise(r, 0.08)).phase);
    }

    @Test
    public void analyzer_burstyMovementIsAwake() {
        // 대부분 조용하다가 가끔 큰 소리(뒤척임) → 평균은 낮아도 출렁임이 커서 깸
        int[] i = {0};
        Epoch e = oneEpoch(r -> noise(r, (i[0]++ % 50 < 3) ? 0.3 : 0.002));
        assertEquals(Epoch.AWAKE, e.phase);
    }

    @Test
    public void analyzer_syllabicToneCountsAsSpeech() {
        // 1kHz 를 4Hz 로 껐다 켰다(말의 음절처럼) → 말소리 비율 높음
        int[] i = {0};
        Epoch speech = oneEpoch(r -> {
            int frame = i[0]++;
            double amp = ((frame / 12) % 2 == 0) ? 0.02 : 0.002;
            return sine(1000, amp, 160, frame * 160);
        });
        assertTrue("말소리 비율 " + speech.externalAudioFraction, speech.externalAudioFraction > 0.5f);

        // 일정한 1kHz 는 크기가 안 오르내려 말소리 아님
        int[] j = {0};
        Epoch steady = oneEpoch(r -> sine(1000, 0.01, 160, (j[0]++) * 160));
        assertTrue("일정한 소리 " + steady.externalAudioFraction, steady.externalAudioFraction < 0.1f);
    }

    // ───── 아침 다듬기 ─────

    @Test
    public void smooth_removesIsolatedSpikes_keepsEdges() {
        // 문서 예시와 같은 줄: 깊은 잠 사이 깸 1칸(5번째), 얕은 잠 사이 깊은 잠 1칸(13번째)
        int[] before = {2, 2, 2, 2, 0, 2, 2, 2, 2, 1, 1, 1, 2, 1, 1, 1, 1};
        int[] after = NightSummary.smooth(before);
        int[] expected = {2, 2, 2, 2, 2, 2, 2, 2, 2, 1, 1, 1, 1, 1, 1, 1, 1};
        for (int k = 0; k < before.length; k++) assertEquals("칸 " + (k + 1), expected[k], after[k]);

        int[] edges = {0, 2, 2, 2, 0};
        int[] e2 = NightSummary.smooth(edges);
        assertEquals(0, e2[0]);
        assertEquals(0, e2[4]);
    }

    // ───── 밤 요약 ─────

    @Test
    public void summary_onsetWakeAndMinutes() {
        // 22:40 시작: 깸 25분 → 잠 3시간 → 깸 3분 → 잠 4시간 → 깸 40분
        long t0 = java.time.ZonedDateTime.of(2026, 11, 8, 22, 40, 0, 0, SEOUL).toInstant().toEpochMilli();
        List<Epoch> night = new ArrayList<>();
        long t = t0;
        t = add(night, t, Epoch.AWAKE, 25);
        t = add(night, t, Epoch.LIGHT, 180);
        t = add(night, t, Epoch.AWAKE, 3);
        t = add(night, t, Epoch.DEEP, 240);
        add(night, t, Epoch.AWAKE, 40);

        NightSummary.Result r = NightSummary.compute("s1", night, false, SEOUL);
        assertNotNull(r);
        assertEquals(180 + 240, r.asleepMinutes);
        assertEquals("2026-11-09", r.day);
        assertEquals("2026-11-08T14:05:00Z", r.bedStartIso()); // 23:05 KST
        // 22:40 + 25 + 180 + 3 + 240분 = 06:08 KST
        assertEquals("2026-11-08T21:08:00Z", r.wakeEndIso());
    }

    @Test
    public void summary_tvTimeIsNotSleep() {
        long t0 = 1_762_600_000_000L;
        List<Epoch> night = new ArrayList<>();
        long t = t0;
        // 조용하지만 TV 소리가 대부분인 30분 → 잠 아님
        for (int i = 0; i < 60; i++) { t += 30_000; night.add(new Epoch(t, Epoch.LIGHT, 0.01f, 1e-5f, 0.8f)); }
        t = add(night, t, Epoch.DEEP, 60);
        NightSummary.Result r = NightSummary.compute("s2", night, false, SEOUL);
        assertNotNull(r);
        assertEquals(60, r.asleepMinutes);
        assertEquals(t0 + 60 * 30_000L, r.bedStartMs);
    }

    @Test
    public void summary_nullWhenNoFiveMinuteSleep() {
        // 잠 3칸, 깸 3칸 반복 — 다듬기 후에도 10칸 연속 잠이 없으면 null
        NightSummary.Result r = NightSummary.compute("s3", alternate(), false, SEOUL);
        assertNull(r);
        assertNull(NightSummary.compute("s4", new ArrayList<>(), false, SEOUL));
    }

    @Test
    public void epoch_lineRoundTrip() {
        Epoch e = new Epoch(123L, Epoch.LIGHT, 0.0121f, 0.00031f, 0.25f);
        Epoch back = Epoch.fromLine(e.toLine());
        assertNotNull(back);
        assertEquals(123L, back.endMs);
        assertEquals(Epoch.LIGHT, back.phase);
        assertEquals(0.25f, back.externalAudioFraction, 1e-6);
        assertNull(Epoch.fromLine("123,1,0.01"));   // 쓰다 끊긴 줄
        assertNull(Epoch.fromLine("abc,1,0,0,0"));
    }

    // ───── 도우미 ─────

    private interface FrameMaker { short[] make(Random r); }

    private static Epoch oneEpoch(FrameMaker maker) {
        SleepAnalyzer a = new SleepAnalyzer();
        Random r = new Random(42);
        for (int i = 0; i < SleepAnalyzer.FRAMES_PER_EPOCH; i++) {
            Epoch e = a.process(maker.make(r), i);
            if (e != null) return e;
        }
        throw new AssertionError("no epoch");
    }

    private static short[] noise(Random r, double rms) {
        short[] s = new short[160];
        for (int i = 0; i < 160; i++) s[i] = clip(r.nextGaussian() * rms * 32768);
        return s;
    }

    private static short[] sine(double hz, double amp, int n, int offset) {
        short[] s = new short[n];
        for (int i = 0; i < n; i++) s[i] = clip(amp * 32768 * Math.sin(2 * Math.PI * hz * (offset + i) / 16000.0));
        return s;
    }

    private static short clip(double v) {
        return (short) Math.max(-32768, Math.min(32767, Math.round(v)));
    }

    private static long add(List<Epoch> out, long t, int phase, int minutes) {
        for (int i = 0; i < minutes * 2; i++) {
            t += 30_000;
            out.add(new Epoch(t, phase, 0.01f, 1e-5f, 0f));
        }
        return t;
    }

    /** 잠 3칸, 깸 3칸 반복 — 5칸 중앙값으로도 10칸 연속 잠이 생기지 않는 줄 */
    private static List<Epoch> alternate() {
        List<Epoch> night = new ArrayList<>();
        long t = 0;
        for (int i = 0; i < 60; i++) {
            t += 30_000;
            night.add(new Epoch(t, (i % 6) < 3 ? Epoch.LIGHT : Epoch.AWAKE, 0.01f, 1e-5f, 0f));
        }
        return night;
    }
}
