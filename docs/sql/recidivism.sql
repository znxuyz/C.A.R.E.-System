-- =============================================================================
-- C.A.R.E. System — 累犯偵測：關聯式（SQL）等價實作
--
-- 本系統正式的資料庫為 Firestore（見 docs/database-schema.md）；
-- 此檔提供**等價的 SQL 版本**，用途有三：
--   1. 規格驗證：以集合運算明確定義「15 天內 3 張」的邊界語意。
--   2. 報表分析：Firestore 可排程匯出至 BigQuery，本檔查詢可直接套用
--      （BigQuery 標準 SQL 相容；僅 DDL 型別需微調）。
--   3. 若校方選擇自建關聯式後端（Cloud SQL / PostgreSQL），可直接採用。
--
-- 已於 PostgreSQL 16 實際執行驗證（含邊界、豁免、認列、多學生等案例）。
-- =============================================================================

-- ----------------------------------------------------------------------------
-- 1. 最小結構（對應 Firestore 的 reflectionCards / recidivismAlerts）
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS students (
  id           text PRIMARY KEY,
  student_no   text UNIQUE NOT NULL,
  name         text        NOT NULL,
  class_id     text        NOT NULL,
  class_name   text        NOT NULL
);

CREATE TABLE IF NOT EXISTS recidivism_alerts (
  id            bigserial PRIMARY KEY,
  student_id    text NOT NULL REFERENCES students (id),
  triggered_at  timestamptz NOT NULL DEFAULT now(),
  window_days   int  NOT NULL,
  threshold     int  NOT NULL,
  window_start  date NOT NULL,
  window_end    date NOT NULL,
  card_count    int  NOT NULL,
  status        text NOT NULL DEFAULT 'OPEN'
                CHECK (status IN ('OPEN','ACKNOWLEDGED','ASSIGNED','CLOSED','DISMISSED'))
);

CREATE TABLE IF NOT EXISTS reflection_cards (
  id                        bigserial PRIMARY KEY,
  student_id                text NOT NULL REFERENCES students (id),
  form_kind                 text NOT NULL
                            CHECK (form_kind IN ('SAFETY_REFLECTION','KIND_WORDS_REFLECTION')),
  status                    text NOT NULL
                            CHECK (status IN ('DRAFT','PENDING_TEACHER','PENDING_OFFICE',
                                              'COMPLETED','RETURNED','EXEMPTED','VOIDED')),
  -- 累犯基準日 = 違規發生日（非填寫日），避免補填造成視窗漂移
  count_on                  date NOT NULL,
  -- 導師勾選「班級活動優先」或案件撤銷 → false
  counts_toward_recidivism  boolean NOT NULL DEFAULT true,
  -- 已被某次警示「認列」的卡片不再參與後續計數（幂等關鍵）
  consumed_by_alert_id      bigint REFERENCES recidivism_alerts (id),
  submitted_at              timestamptz
);

-- 視窗查詢用索引：等值條件在前、範圍條件在後（與 Firestore 複合索引同理）
CREATE INDEX IF NOT EXISTS idx_cards_window
  ON reflection_cards (student_id, counts_toward_recidivism, consumed_by_alert_id, status, count_on);

-- ----------------------------------------------------------------------------
-- 2. 核心查詢：某生於基準日回溯 N 天（含當天）的有效反思卡張數
--
--    參數： :student_id  學生
--           :as_of       基準日（= 觸發卡片的 count_on）
--           :window_days 回溯天數（含當天，預設 15）
--
--    邊界語意：視窗為 [as_of - (window_days - 1), as_of]，兩端皆含。
--    window_days = 15、as_of = 2026-09-18 → 2026-09-04 ~ 2026-09-18。
-- ----------------------------------------------------------------------------

-- 計入累犯的卡片狀態：學生一旦送出即列入「填寫紀錄」
CREATE OR REPLACE VIEW countable_cards AS
SELECT *
  FROM reflection_cards
 WHERE counts_toward_recidivism
   AND consumed_by_alert_id IS NULL
   AND status IN ('PENDING_TEACHER', 'PENDING_OFFICE', 'COMPLETED');

-- 2a. 單一學生計數（後端每次違規成立時呼叫）
CREATE OR REPLACE FUNCTION count_recidivism_cards(
  p_student_id  text,
  p_as_of       date,
  p_window_days int DEFAULT 15
) RETURNS int
LANGUAGE sql STABLE AS $$
  SELECT count(*)::int
    FROM countable_cards c
   WHERE c.student_id = p_student_id
     AND c.count_on BETWEEN (p_as_of - (p_window_days - 1)) AND p_as_of;
$$;

-- 2b. 是否達門檻（含視窗與明細，供警示文件留存）
CREATE OR REPLACE FUNCTION evaluate_recidivism(
  p_student_id  text,
  p_as_of       date,
  p_window_days int DEFAULT 15,
  p_threshold   int DEFAULT 3
) RETURNS TABLE (
  triggered    boolean,
  card_count   int,
  shortfall    int,
  window_start date,
  window_end   date,
  card_ids     bigint[]
)
LANGUAGE sql STABLE AS $$
  WITH w AS (
    SELECT (p_as_of - (p_window_days - 1))::date AS window_start, p_as_of::date AS window_end
  ),
  counted AS (
    SELECT c.id, c.count_on
      FROM countable_cards c, w
     WHERE c.student_id = p_student_id
       AND c.count_on BETWEEN w.window_start AND w.window_end
     ORDER BY c.count_on, c.id
  )
  SELECT (SELECT count(*) FROM counted) >= p_threshold,
         (SELECT count(*) FROM counted)::int,
         GREATEST(0, p_threshold - (SELECT count(*) FROM counted))::int,
         w.window_start,
         w.window_end,
         COALESCE((SELECT array_agg(id ORDER BY count_on, id) FROM counted), '{}'::bigint[])
    FROM w;
$$;

-- ----------------------------------------------------------------------------
-- 3. 原子化觸發（對應 Cloud Functions 的 Firestore Transaction）
--
--    以「鎖定該生卡片列 → 計數 → 建立警示 → 認列卡片」在單一交易內完成，
--    避免兩張卡同時送出造成重複觸發（double punishment）。
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION trigger_recidivism_if_needed(
  p_student_id  text,
  p_as_of       date,
  p_window_days int DEFAULT 15,
  p_threshold   int DEFAULT 3
) RETURNS bigint   -- 回傳新建立的 alert id；未達門檻回傳 NULL
LANGUAGE plpgsql AS $$
DECLARE
  v_window_start date := p_as_of - (p_window_days - 1);
  v_card_ids     bigint[];
  v_count        int;
  v_alert_id     bigint;
BEGIN
  -- FOR UPDATE：鎖住視窗內的候選卡片，序列化併發送出
  SELECT array_agg(id ORDER BY count_on, id), count(*)
    INTO v_card_ids, v_count
    FROM (
      SELECT id, count_on
        FROM reflection_cards
       WHERE student_id = p_student_id
         AND counts_toward_recidivism
         AND consumed_by_alert_id IS NULL
         AND status IN ('PENDING_TEACHER','PENDING_OFFICE','COMPLETED')
         AND count_on BETWEEN v_window_start AND p_as_of
       FOR UPDATE
    ) locked;

  IF COALESCE(v_count, 0) < p_threshold THEN
    RETURN NULL;
  END IF;

  INSERT INTO recidivism_alerts
    (student_id, window_days, threshold, window_start, window_end, card_count, status)
  VALUES
    (p_student_id, p_window_days, p_threshold, v_window_start, p_as_of, v_count, 'ASSIGNED')
  RETURNING id INTO v_alert_id;

  -- 認列：本次計入的卡片不再參與後續視窗計數
  UPDATE reflection_cards
     SET consumed_by_alert_id = v_alert_id
   WHERE id = ANY (v_card_ids);

  RETURN v_alert_id;
END;
$$;

-- ----------------------------------------------------------------------------
-- 4. 報表：滾動視窗（一次算出全校每張卡當下的累計張數）
--    用於期末統計、找出「已 2 張」的關注名單。
--    RANGE BETWEEN INTERVAL '14 days' PRECEDING 即為「含當天共 15 天」。
-- ----------------------------------------------------------------------------

CREATE OR REPLACE VIEW recidivism_rolling AS
SELECT c.student_id,
       s.class_name,
       s.name AS student_name,
       c.id   AS card_id,
       c.count_on,
       c.form_kind,
       count(*) OVER (
         PARTITION BY c.student_id
         ORDER BY c.count_on
         RANGE BETWEEN INTERVAL '14 days' PRECEDING AND CURRENT ROW
       )::int AS rolling_15d_count
  FROM countable_cards c
  JOIN students s ON s.id = c.student_id;

-- 關注名單：15 天內已累計 2 張（再 1 張即觸發）
CREATE OR REPLACE VIEW watchlist AS
SELECT student_id, class_name, student_name, max(rolling_15d_count) AS cards_in_window
  FROM recidivism_rolling
 WHERE count_on > (CURRENT_DATE - 15)
 GROUP BY student_id, class_name, student_name
HAVING max(rolling_15d_count) BETWEEN 1 AND 2
 ORDER BY cards_in_window DESC, class_name;
