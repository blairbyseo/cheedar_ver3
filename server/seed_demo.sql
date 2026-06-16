-- ============================================================
-- 데모/프레젠테이션용 시드 데이터 (캡처 후 폐기)
-- 멱등성: 대상 사용자들의 기존 데모 데이터를 먼저 지우고 다시 넣는다.
-- ============================================================
BEGIN;

-- 1) 랭킹 동료 계정 (로그인 불필요 — 랭킹/분석/보상용 더미)
INSERT INTO users (user_id, xp, cp, onboarded, nickname) VALUES
  ('champion_kim', 1320, 900, true, '김챔피언'),
  ('health_lee',    760, 540, true, '이건강'),
  ('runner_son',    680, 500, true, '손러너'),
  ('fit_park',      520, 300, true, '박핏'),
  ('jogging_choi',  410, 210, true, '최조깅'),
  ('salad_jung',    300, 150, true, '정샐러드')
ON CONFLICT (user_id) DO UPDATE
  SET xp = EXCLUDED.xp, cp = EXCLUDED.cp, onboarded = true, nickname = EXCLUDED.nickname;

-- 2) demo_user: Lv.4 도달(현금보상 자격) + 닉네임
UPDATE users SET xp = 820, cp = 620, onboarded = true, nickname = '데모' WHERE user_id = 'demo_user';
UPDATE users SET onboarded = true WHERE user_id = 'demo_admin';

-- 멱등성: 데모 대상 사용자들의 기존 활동 데이터 정리
DELETE FROM point_history WHERE user_id IN (SELECT id FROM users WHERE user_id IN
  ('demo_user','champion_kim','health_lee','runner_son','fit_park','jogging_choi','salad_jung'));
DELETE FROM meals WHERE user_id IN (SELECT id FROM users WHERE user_id IN
  ('demo_user','champion_kim','health_lee','runner_son','fit_park','jogging_choi','salad_jung'));
DELETE FROM exercise_logs WHERE user_id IN (SELECT id FROM users WHERE user_id IN
  ('demo_user','champion_kim','health_lee','runner_son','fit_park','jogging_choi','salad_jung'));
DELETE FROM chat_messages WHERE user_id IN (SELECT id FROM users WHERE user_id IN ('demo_user'));
DELETE FROM page_time_logs WHERE user_id IN (SELECT id FROM users WHERE user_id IN
  ('demo_user','champion_kim','health_lee','runner_son','fit_park'));
DELETE FROM user_flow_logs WHERE user_id IN (SELECT id FROM users WHERE user_id IN
  ('demo_user','champion_kim','health_lee','runner_son','fit_park'));

-- 3) demo_user 포인트 적립 내역(최근순)
INSERT INTO point_history (user_id, rule, amount, label, dedup_key, created_at)
SELECT u.id, v.rule, v.amount, v.label, v.dk, now() - v.ago::interval
FROM users u CROSS JOIN (VALUES
  ('survey-done',   50, '설문 완료',          'survey:demo1',       '2 hours'),
  ('exercise-week', 80, '주 3일 운동 보너스', 'week:exw-demo',      '1 day'),
  ('weekly-goal',  100, '주 5일 기록 달성',   'week:wg-demo',       '1 day'),
  ('three-meals',   20, '하루 3끼 완료',      'day:demo-0615',      '1 day'),
  ('meal-check',    10, '저녁 기록 완료',     'meal:demo-d1',       '1 day'),
  ('exercise-log',  10, '운동 1회 기록',      'ex:demo-1',          '2 days'),
  ('meal-check',    10, '점심 기록 완료',     'meal:demo-l1',       '2 days')
) AS v(rule, amount, label, dk, ago)
WHERE u.user_id = 'demo_user';

-- 4) 현금 보상 신청 (관리자 화면용): 대기 2 + 지급완료 1
INSERT INTO reward_claims (user_id, kind, level_at_claim, xp_at_claim, amount, status, requested_at)
SELECT id, 'final-level', 5, 1320, 20000, 'pending'::reward_claim_status, now() - interval '6 hours'
FROM users WHERE user_id = 'champion_kim'
ON CONFLICT (user_id, kind) DO UPDATE SET status = 'pending', processed_at = NULL, processed_by_id = NULL;

INSERT INTO reward_claims (user_id, kind, level_at_claim, xp_at_claim, amount, status, requested_at)
SELECT id, 'final-level', 4, 760, 20000, 'pending'::reward_claim_status, now() - interval '20 hours'
FROM users WHERE user_id = 'health_lee'
ON CONFLICT (user_id, kind) DO UPDATE SET status = 'pending', processed_at = NULL, processed_by_id = NULL;

INSERT INTO reward_claims (user_id, kind, level_at_claim, xp_at_claim, amount, status, requested_at, processed_at, processed_by_id, admin_note)
SELECT u.id, 'final-level', 4, 680, 20000, 'paid'::reward_claim_status, now() - interval '3 days', now() - interval '2 days', a.id, '계좌이체 완료(데모)'
FROM users u, users a WHERE u.user_id = 'runner_son' AND a.user_id = 'demo_admin'
ON CONFLICT (user_id, kind) DO UPDATE SET status = 'paid';

-- 5) 식단(meals) — demo_user는 과거 6일(오늘 비워서 업로드 화면 노출),
--    동료들은 오늘 포함 7일치(대시보드 '오늘 기록된 식단' + 분석 차트용)
INSERT INTO meals (user_id, meal_type, eaten_on, menu, calories, protein_g, carbs_g, fat_g, ai_summary)
SELECT u.id, mt.t::meal_type, (current_date - d), mt.menu, mt.kcal, mt.p, mt.c, mt.f, mt.s
FROM users u
CROSS JOIN generate_series(1, 6) AS d
CROSS JOIN (VALUES
  ('breakfast','오트밀과 바나나',     380, 14, 55,  9, '균형 잡힌 아침'),
  ('lunch',    '닭가슴살 샐러드',     520, 42, 30, 18, '단백질이 풍부해요'),
  ('dinner',   '현미밥과 된장찌개',   610, 25, 80, 15, '든든한 한 끼')
) AS mt(t, menu, kcal, p, c, f, s)
WHERE u.user_id = 'demo_user';

INSERT INTO meals (user_id, meal_type, eaten_on, menu, calories, protein_g, carbs_g, fat_g, ai_summary)
SELECT u.id, mt.t::meal_type, (current_date - d), mt.menu, mt.kcal, mt.p, mt.c, mt.f, '자동 분석'
FROM users u
CROSS JOIN generate_series(0, 6) AS d
CROSS JOIN (VALUES
  ('breakfast','토스트와 계란',  420, 18, 45, 16),
  ('lunch',    '비빔밥',         650, 22, 95, 18),
  ('dinner',   '연어구이 정식',  580, 38, 40, 22)
) AS mt(t, menu, kcal, p, c, f)
WHERE u.user_id IN ('champion_kim','health_lee','runner_son','fit_park')
  AND random() < 0.8;   -- 일부 끼니는 비워 자연스러운 빈도 분포

-- 6) 운동(exercise_logs) — 사용자·날짜당 1행
INSERT INTO exercise_logs (user_id, done_on, is_skipped, calories_burned, items)
SELECT u.id, (current_date - d), false, (200 + (random()*300))::int,
  '[{"exercise_name":"달리기","met":8.3,"duration_minutes":30,"intensity":3,"calories_burned":280}]'
FROM users u
CROSS JOIN generate_series(0, 6) AS d
WHERE u.user_id IN ('demo_user','champion_kim','health_lee','runner_son','fit_park')
  AND random() < 0.7
ON CONFLICT (user_id, done_on) DO NOTHING;

-- 7) 채팅(chat_messages) — demo_user 대화 샘플(채팅 화면 + 대시보드 누적 메시지)
INSERT INTO chat_messages (user_id, role, text, created_at)
SELECT u.id, v.role::chat_role, v.text, now() - v.ago::interval
FROM users u CROSS JOIN (VALUES
  ('user', '오늘 점심으로 뭘 먹는 게 좋을까요?',                          '40 minutes'),
  ('ai',   '최근 기록을 보면 단백질이 충분하니, 채소를 곁들인 가벼운 한 끼를 추천해요. 닭가슴살 샐러드 어떠세요?', '39 minutes'),
  ('user', '어제 저녁은 뭐였지?',                                          '20 minutes'),
  ('ai',   '어제 저녁은 현미밥과 된장찌개(약 610kcal)를 드셨어요. 균형 잡힌 한 끼였습니다!', '19 minutes'),
  ('user', '운동을 더 늘리는 게 좋을까?',                                  '5 minutes'),
  ('ai',   '이번 주 3일 운동하셨네요. 주 4~5회로 늘리면 칼로리 소모와 컨디션에 도움이 돼요.', '4 minutes')
) AS v(role, text, ago)
WHERE u.user_id = 'demo_user';

-- 8) 텔레메트리: 페이지 체류시간(page-time 차트) — 사용자×페이지×7일
INSERT INTO page_time_logs (user_id, page_path, time_spent_seconds, metric_type, created_at)
SELECT u.id, p.path, (8 + random()*70)::numeric(10,2), 'sample', now() - (d || ' days')::interval - (random()*8 || ' hours')::interval
FROM users u
CROSS JOIN generate_series(0, 6) AS d
CROSS JOIN (VALUES ('/home'),('/diet'),('/chat'),('/point'),('/ranking')) AS p(path)
CROSS JOIN generate_series(1, 3) AS rep
WHERE u.user_id IN ('demo_user','champion_kim','health_lee','runner_son','fit_park')
  AND random() < 0.7;

-- 9) 텔레메트리: 사용자 동선(user-flow Sankey)
INSERT INTO user_flow_logs (user_id, from_page, to_page, created_at)
SELECT u.id, e.f, e.t, now() - (d || ' days')::interval
FROM users u
CROSS JOIN generate_series(0, 6) AS d
CROSS JOIN (VALUES
  ('/home','/diet'), ('/home','/chat'), ('/home','/point'),
  ('/diet','/home'), ('/point','/ranking'), ('/chat','/home'),
  ('/home','/ranking'), ('/ranking','/home')
) AS e(f, t)
CROSS JOIN generate_series(1, 2) AS rep
WHERE u.user_id IN ('demo_user','champion_kim','health_lee','runner_son','fit_park')
  AND random() < 0.6;

COMMIT;

-- 확인
SELECT 'users'        AS t, count(*) FROM users WHERE user_id LIKE 'demo%' OR user_id IN ('champion_kim','health_lee','runner_son','fit_park','jogging_choi','salad_jung')
UNION ALL SELECT 'meals',          count(*) FROM meals
UNION ALL SELECT 'exercise_logs',  count(*) FROM exercise_logs
UNION ALL SELECT 'chat_messages',  count(*) FROM chat_messages
UNION ALL SELECT 'reward_claims',  count(*) FROM reward_claims
UNION ALL SELECT 'page_time_logs', count(*) FROM page_time_logs
UNION ALL SELECT 'user_flow_logs', count(*) FROM user_flow_logs;
