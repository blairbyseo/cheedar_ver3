package com.cheddar.care.sleep;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertTrue;

import java.time.ZoneId;
import java.time.ZonedDateTime;
import java.util.ArrayList;
import java.util.List;
import org.junit.Test;

/** 자동 수면 측정의 밤 구간·시작·끝·멈춤 규칙. */
public class SleepAutoTest {

    private static final ZoneId SEOUL = ZoneId.of("Asia/Seoul");

    private static long at(int day, int hour, int minute) {
        return ZonedDateTime.of(2026, 11, day, hour, minute, 0, 0, SEOUL).toInstant().toEpochMilli();
    }

    @Test
    public void night_isEightPmToNoon() {
        assertFalse(SleepAuto.inNight(at(8, 19, 59), SEOUL));
        assertTrue(SleepAuto.inNight(at(8, 20, 0), SEOUL));
        assertTrue(SleepAuto.inNight(at(9, 3, 0), SEOUL));
        assertTrue(SleepAuto.inNight(at(9, 11, 59), SEOUL));
        assertFalse(SleepAuto.inNight(at(9, 12, 0), SEOUL));
        assertEquals(at(9, 20, 0), SleepAuto.nextNightStartMs(at(9, 3, 0), SEOUL));
        assertEquals(at(8, 20, 0), SleepAuto.nextNightStartMs(at(8, 15, 0), SEOUL));
    }

    @Test
    public void session_startsOncePerNight() {
        long none = 0L;
        assertTrue(SleepAuto.shouldStartSession(at(8, 22, 5), none, SEOUL));
        assertFalse("낮에는 화면을 꺼도 시작 안 함", SleepAuto.shouldStartSession(at(8, 15, 0), none, SEOUL));
        assertFalse("같은 밤에 이미 끝남", SleepAuto.shouldStartSession(at(9, 7, 0), at(9, 6, 40), SEOUL));
        assertTrue("어젯밤 측정은 오늘 밤 시작을 막지 않음", SleepAuto.shouldStartSession(at(9, 21, 0), at(9, 6, 40), SEOUL));
    }

    @Test
    public void unlock_endsOnlyInTheMorningAfterThreeHours() {
        long start = at(8, 22, 0);
        assertFalse("새벽 3시 화장실", SleepAuto.shouldEndOnUnlock(start, at(9, 3, 0), SEOUL));
        assertTrue("아침 6시 반", SleepAuto.shouldEndOnUnlock(start, at(9, 6, 30), SEOUL));
        assertFalse("시작하고 1시간", SleepAuto.shouldEndOnUnlock(at(9, 5, 0), at(9, 6, 0), SEOUL));
        assertTrue("낮 12시 넘으면 무조건", SleepAuto.shouldEndOnUnlock(at(9, 10, 0), at(9, 12, 30), SEOUL));
    }

    @Test
    public void hardEnd_isNextNoon() {
        assertEquals(at(9, 12, 0), SleepAuto.hardEndMs(at(8, 22, 0), SEOUL));
        assertEquals(at(9, 12, 0), SleepAuto.hardEndMs(at(9, 1, 0), SEOUL));
    }

    @Test
    public void awakeFill_breaksSleepRunsAcrossScreenOn() {
        // 잠 4분 → 화면 켜고 20초 → 잠 4분: 칸을 안 채우면 8분 연속 잠으로 보일 수 있다
        assertEquals(3, SleepAuto.awakeFill(0, 20_000).size());
        assertEquals(20, SleepAuto.awakeFill(0, 10 * 60_000).size());

        List<Epoch> night = new ArrayList<>();
        long t = 0;
        for (int i = 0; i < 8; i++) { t += 30_000; night.add(new Epoch(t, Epoch.DEEP, 0.003f, 0f, 0f)); }
        night.addAll(SleepAuto.awakeFill(t, t + 20_000));
        t += 20_000;
        for (int i = 0; i < 8; i++) { t += 30_000; night.add(new Epoch(t, Epoch.DEEP, 0.003f, 0f, 0f)); }
        // 8칸+8칸 사이가 끊겨 10칸 연속 잠이 없다 → 결과 없음
        assertEquals(null, NightSummary.compute("s", night, false, SEOUL));

        // 더 길게 자면 결과가 나오고, 멈춘 구간은 잠에 안 들어간다
        for (int i = 0; i < 20; i++) { t += 30_000; night.add(new Epoch(t, Epoch.DEEP, 0.003f, 0f, 0f)); }
        NightSummary.Result r = NightSummary.compute("s", night, false, SEOUL);
        assertNotNull(r);
        assertTrue(r.asleepMinutes <= (8 + 8 + 20) / 2);
    }
}
