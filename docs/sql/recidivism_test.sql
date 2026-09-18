-- =============================================================================
-- 累犯偵測 SQL 實作的自我驗證腳本
--
-- 執行：psql -v ON_ERROR_STOP=1 -f docs/sql/recidivism.sql \
--             -f docs/sql/recidivism_test.sql
-- 任一斷言失敗即中止並顯示訊息；全部通過會印出 ALL SQL ASSERTIONS PASSED。
-- 對應 functions/test/recidivism.test.ts 的同名案例，確保兩種實作語意一致。
-- =============================================================================

BEGIN;

-- 固定基準日，讓斷言不受執行日期影響
CREATE TEMP TABLE t AS SELECT '2026-09-18'::date AS as_of;

TRUNCATE reflection_cards, recidivism_alerts, students RESTART IDENTITY CASCADE;

INSERT INTO students (id, student_no, name, class_id, class_name) VALUES
  ('stu_001', '1140101', '王小明', 'cls_701', '七年一班'),
  ('stu_002', '1140102', '李小華', 'cls_701', '七年一班');

-- 輔助：插入一張已送出的反思卡
CREATE OR REPLACE FUNCTION add_card(
  p_student text, p_count_on date,
  p_kind text DEFAULT 'SAFETY_REFLECTION',
  p_status text DEFAULT 'PENDING_TEACHER',
  p_counts boolean DEFAULT true
) RETURNS bigint LANGUAGE sql AS $$
  INSERT INTO reflection_cards
    (student_id, form_kind, status, count_on, counts_toward_recidivism, submitted_at)
  VALUES (p_student, p_kind, p_status, p_count_on, p_counts, now())
  RETURNING id;
$$;

DO $$
DECLARE
  v_as_of   date := '2026-09-18';
  v_count   int;
  v_trig    boolean;
  v_short   int;
  v_start   date;
  v_alert   bigint;
  v_alert2  bigint;
  v_ids     bigint[];
BEGIN
  -- ① 視窗邊界：含當天共 15 天 → 起日為 as_of - 14
  SELECT window_start INTO v_start FROM evaluate_recidivism('stu_001', v_as_of);
  ASSERT v_start = '2026-09-04', format('視窗起日應為 2026-09-04，實際 %s', v_start);

  -- ② 2 張未達門檻，回報還差 1 張
  PERFORM add_card('stu_001', '2026-09-10');
  PERFORM add_card('stu_001', '2026-09-15');
  SELECT triggered, card_count, shortfall INTO v_trig, v_count, v_short
    FROM evaluate_recidivism('stu_001', v_as_of);
  ASSERT v_trig = false AND v_count = 2 AND v_short = 1,
    format('2 張時應未觸發，實際 triggered=%s count=%s', v_trig, v_count);

  -- ③ 第 3 張（不同卡種）即觸發，且卡種不影響計數
  PERFORM add_card('stu_001', v_as_of, 'KIND_WORDS_REFLECTION');
  SELECT triggered, card_count, card_ids INTO v_trig, v_count, v_ids
    FROM evaluate_recidivism('stu_001', v_as_of);
  ASSERT v_trig AND v_count = 3, format('3 張時應觸發，實際 count=%s', v_count);
  ASSERT array_length(v_ids, 1) = 3, '應回傳 3 張卡片明細';

  -- ④ 同班同學的卡片不互相干擾
  PERFORM add_card('stu_002', '2026-09-11');
  PERFORM add_card('stu_002', '2026-09-12');
  SELECT card_count INTO v_count FROM evaluate_recidivism('stu_002', v_as_of);
  ASSERT v_count = 2, format('stu_002 應為 2 張，實際 %s', v_count);
  SELECT card_count INTO v_count FROM evaluate_recidivism('stu_001', v_as_of);
  ASSERT v_count = 3, format('stu_001 應仍為 3 張，實際 %s', v_count);

  -- ⑤ 原子化觸發：建立警示並認列 3 張卡
  v_alert := trigger_recidivism_if_needed('stu_001', v_as_of);
  ASSERT v_alert IS NOT NULL, '應建立累犯警示';
  SELECT count(*) INTO v_count
    FROM reflection_cards WHERE consumed_by_alert_id = v_alert;
  ASSERT v_count = 3, format('應認列 3 張卡，實際 %s', v_count);

  -- ⑥ 幂等：已認列後再次評估不重複觸發（第 4 張也不會）
  SELECT triggered, card_count INTO v_trig, v_count
    FROM evaluate_recidivism('stu_001', v_as_of);
  ASSERT v_trig = false AND v_count = 0,
    format('認列後應歸零，實際 triggered=%s count=%s', v_trig, v_count);
  PERFORM add_card('stu_001', v_as_of);          -- 第 4 張
  v_alert2 := trigger_recidivism_if_needed('stu_001', v_as_of);
  ASSERT v_alert2 IS NULL, '第 4 張不應觸發新的警示';
  ASSERT (SELECT count(*) FROM recidivism_alerts) = 1, '警示總數應仍為 1';

  -- ⑦ 邊界日：第 15 天（as_of-14）計入、第 16 天（as_of-15）排除
  TRUNCATE reflection_cards RESTART IDENTITY;
  PERFORM add_card('stu_001', '2026-09-04');     -- 視窗第 1 天
  PERFORM add_card('stu_001', '2026-09-11');
  PERFORM add_card('stu_001', v_as_of);
  SELECT triggered INTO v_trig FROM evaluate_recidivism('stu_001', v_as_of);
  ASSERT v_trig, '2026-09-04 的卡片應計入視窗';

  TRUNCATE reflection_cards RESTART IDENTITY;
  PERFORM add_card('stu_001', '2026-09-03');     -- 超出視窗 1 天
  PERFORM add_card('stu_001', '2026-09-11');
  PERFORM add_card('stu_001', v_as_of);
  SELECT triggered, card_count INTO v_trig, v_count
    FROM evaluate_recidivism('stu_001', v_as_of);
  ASSERT v_trig = false AND v_count = 2,
    format('2026-09-03 的卡片應排除，實際 count=%s', v_count);

  -- ⑧ 草稿與退回不計入「填寫紀錄」
  TRUNCATE reflection_cards RESTART IDENTITY;
  PERFORM add_card('stu_001', '2026-09-10', 'SAFETY_REFLECTION', 'DRAFT');
  PERFORM add_card('stu_001', '2026-09-12', 'SAFETY_REFLECTION', 'RETURNED');
  PERFORM add_card('stu_001', v_as_of,      'SAFETY_REFLECTION', 'PENDING_TEACHER');
  SELECT card_count INTO v_count FROM evaluate_recidivism('stu_001', v_as_of);
  ASSERT v_count = 1, format('草稿/退回應排除，實際 count=%s', v_count);

  -- ⑨ 導師「班級活動優先」豁免的卡片不計入
  TRUNCATE reflection_cards RESTART IDENTITY;
  PERFORM add_card('stu_001', '2026-09-10');
  PERFORM add_card('stu_001', '2026-09-12', 'SAFETY_REFLECTION', 'EXEMPTED', false);
  PERFORM add_card('stu_001', v_as_of);
  SELECT triggered, card_count INTO v_trig, v_count
    FROM evaluate_recidivism('stu_001', v_as_of);
  ASSERT v_trig = false AND v_count = 2,
    format('豁免卡片應排除，實際 count=%s', v_count);

  -- ⑩ 可調參數：門檻 2 張 / 視窗 7 天
  TRUNCATE reflection_cards RESTART IDENTITY;
  PERFORM add_card('stu_001', '2026-09-12');
  PERFORM add_card('stu_001', v_as_of);
  SELECT triggered, window_start INTO v_trig, v_start
    FROM evaluate_recidivism('stu_001', v_as_of, 7, 2);
  ASSERT v_trig AND v_start = '2026-09-12',
    format('7 天/2 張參數應觸發且起日為 2026-09-12，實際 %s / %s', v_trig, v_start);

  RAISE NOTICE 'ALL SQL ASSERTIONS PASSED (10 cases)';
END $$;

ROLLBACK;
