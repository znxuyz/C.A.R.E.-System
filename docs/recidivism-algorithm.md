# 累犯偵測核心演算法（15 天 / 3 張）

## 1. 規格與語意界定

> 系統須在每筆違規成立時，自動往前檢索 **15 天內（含當天）** 該生在系統中的累計反思卡
> 填寫紀錄；若重複填寫累計達 **3 張**（不論安全卡或好話卡），系統須立即發出警示，
> 並自動將該生排入『安全觀察員追蹤清單』。

規格落地時必須先釘住五個模糊點，否則同一句話會有不同實作結果：

| # | 模糊點 | 本系統的決定 | 理由 |
|---|---|---|---|
| 1 | 「15 天內（含當天）」的邊界 | 視窗 = `[基準日 - 14, 基準日]`，兩端皆含，共 15 天 | 含當天即第 1 天；`as_of=9/18` → `9/04 ~ 9/18` |
| 2 | 以哪一天計數 | **違規發生日** `countOn`，非填寫日 | 學生隔天才到學務處補填，不該讓視窗漂移；補填也不能規避 |
| 3 | 何謂「填寫紀錄」 | 學生**送出**即計入（`PENDING_TEACHER` 起） | 規格寫「填寫」而非「結案」；否則導師晚簽章就能延後處分 |
| 4 | 哪些卡不計入 | 草稿、退回中、導師豁免（班級活動優先）、撤銷 | 豁免的法源是「該時段不計入處分」 |
| 5 | 第 4、5 張是否再次觸發 | 不會。觸發時把計入的卡片「**認列**」給該警示，之後需再累積 3 張新卡 | 避免同一波違規被重複處分 |

## 2. 演算法

```
evaluateRecidivism(studentId, asOf, config):
    windowStart ← asOf - (config.windowDays - 1)         # 含當天
    windowEnd   ← asOf

    candidates ← 查詢 reflectionCards WHERE
                   studentId = studentId
               AND countsTowardRecidivism = true          # 排除豁免／撤銷
               AND consumedByAlertId = null               # 排除已認列
               AND status ∈ {PENDING_TEACHER, PENDING_OFFICE, COMPLETED}
               AND countOn BETWEEN windowStart AND windowEnd

    counted   ← 依 countOn 排序、依 id 去重(candidates)
    triggered ← |counted| ≥ config.threshold

    return { triggered, cardCount: |counted|,
             shortfall: max(0, threshold - |counted|),
             windowStart, windowEnd, countedCards: counted }
```

觸發後（**同一個交易內**）：

```
if triggered:
    alert ← 建立 recidivismAlerts 文件
              { windowDays, threshold, windowStart, windowEnd,
                cardCount, triggerCardId, cardIds: counted.ids, breakdown,
                status: 'ASSIGNED' }                      # 即列入追蹤清單

    for card in counted:                                  # 認列（幂等關鍵）
        card.consumedByAlertId ← alert.id

    assignment ← 建立 observerAssignments 文件
                   { dutyOn: nextSchoolDay(today),        # 依校曆順延假日
                     totalPeriods: 5, periodLogs: [1..5],
                     status: 'SCHEDULED' }

交易外：
    凍結 dutyOn 當日的下課權限（recessRestrictions）
    通知生教組、導師（警示）與學生（派單）
```

## 3. 實作位置

| 層 | 檔案 | 職責 |
|---|---|---|
| 純邏輯 | [`functions/src/domain/recidivism.ts`](../functions/src/domain/recidivism.ts) | `evaluateRecidivism()`、`buildAlert()`、`summarizeProgress()`；無 I/O |
| 視窗運算 | [`functions/src/domain/dates.ts`](../functions/src/domain/dates.ts) | `recidivismWindow()`、`nextSchoolDay()`（Asia/Taipei） |
| 查詢 | [`functions/src/data/repositories.ts`](../functions/src/data/repositories.ts) | `readRecidivismWindowCards()`（交易內讀取） |
| 交易與派單 | [`functions/src/services/recidivismService.ts`](../functions/src/services/recidivismService.ts) | `evaluateAndTrigger()`、`peekProgress()` |
| SQL 等價版 | [`sql/recidivism.sql`](sql/recidivism.sql) | `evaluate_recidivism()`、`trigger_recidivism_if_needed()` |

### 3.1 核心純函式（TypeScript）

```ts
export function evaluateRecidivism(input: {
  studentId: string;
  asOf: SchoolDate;            // 'YYYY-MM-DD'（Asia/Taipei）
  cards: CountableCard[];
  config: RecidivismConfig;    // { windowDays: 15, threshold: 3 }
}): RecidivismEvaluation {
  const { windowStart, windowEnd } = recidivismWindow(input.asOf, input.config.windowDays);

  const countedCards = input.cards
    .filter((card) => card.studentId === input.studentId)
    .filter((card) => isCountableCard(card, windowStart, windowEnd))
    .filter((card, i, all) => all.findIndex((c) => c.id === card.id) === i)   // 去重
    .sort((a, b) => (a.countOn === b.countOn ? a.id.localeCompare(b.id)
                                             : a.countOn < b.countOn ? -1 : 1));

  const cardCount = countedCards.length;
  const triggered = cardCount >= input.config.threshold;
  return { /* … */ triggered, cardCount,
           shortfall: triggered ? 0 : input.config.threshold - cardCount,
           windowStart, windowEnd, countedCards };
}

export function isCountableCard(card, windowStart, windowEnd): boolean {
  return card.countsTowardRecidivism
    && card.consumedByAlertId === null
    && COUNTABLE_CASE_STATUSES.includes(card.status)   // PENDING_TEACHER / PENDING_OFFICE / COMPLETED
    && card.countOn >= windowStart && card.countOn <= windowEnd;
}
```

### 3.2 Firestore 查詢

```ts
const query = firestore.collection('reflectionCards')
  .where('studentId', '==', studentId)
  .where('countsTowardRecidivism', '==', true)
  .where('consumedByAlertId', '==', null)
  .where('status', 'in', ['PENDING_TEACHER', 'PENDING_OFFICE', 'COMPLETED'])
  .where('countOn', '>=', windowStart)
  .where('countOn', '<=', windowEnd)
  .orderBy('countOn', 'asc')
  .limit(50);

const snap = await tx.get(query);   // ★ 必須在 Transaction 內讀取
```

需要的複合索引（欄位順序：等值在前、範圍在後）：

```
reflectionCards: studentId ASC, countsTowardRecidivism ASC,
                 consumedByAlertId ASC, status ASC, countOn ASC
```

> 注意：`consumedByAlertId` 未認列時必須**明確寫入 `null`**。
> Firestore 不索引缺漏欄位，欄位不存在的文件不會出現在查詢結果中。

### 3.3 等價 SQL（PostgreSQL / BigQuery）

```sql
-- 計入累犯的卡片
CREATE VIEW countable_cards AS
SELECT * FROM reflection_cards
 WHERE counts_toward_recidivism
   AND consumed_by_alert_id IS NULL
   AND status IN ('PENDING_TEACHER','PENDING_OFFICE','COMPLETED');

-- 單一學生於基準日的視窗張數
SELECT count(*)
  FROM countable_cards
 WHERE student_id = :student_id
   AND count_on BETWEEN (:as_of - 14) AND :as_of;    -- 含當天共 15 天
```

報表用滾動視窗（一次算出每張卡當下的累計張數，用於找「已 2 張」的關注名單）：

```sql
SELECT student_id, card_id, count_on,
       count(*) OVER (
         PARTITION BY student_id
         ORDER BY count_on
         RANGE BETWEEN INTERVAL '14 days' PRECEDING AND CURRENT ROW
       ) AS rolling_15d_count
  FROM countable_cards;
```

完整版（含原子化觸發 `trigger_recidivism_if_needed()`、關注名單檢視）見
[`sql/recidivism.sql`](sql/recidivism.sql)。

## 4. 併發與幂等

**問題**：學生可能在同一節下課連續送出兩張卡；或生教組同時蓋章兩案。
若「讀取視窗 → 判定 → 建立警示」不是原子操作，會產生兩張警示 → 學生被罰兩次。

**做法**：

1. Firestore：整段包在 `runTransaction()` 內。交易讀到的卡片若在提交前被其他寫入變更，
   交易會自動重試，因此不會有兩個交易同時看到「差一張就達標」而各自觸發。
2. 認列欄位：觸發時把計入的卡片標記 `consumedByAlertId`。這讓演算法本身具幂等性 —
   同一張卡重複觸發評估（例如送出後再蓋章）不會加罰。
3. SQL 版本：以 `SELECT … FOR UPDATE` 鎖住視窗內候選列，達到同樣效果。

**撤銷誤判**：`dismissAlert()` 會把該警示認列的卡片 `consumedByAlertId` 還原為 `null`，
學生不會因為一次誤判而永久損失 3 張額度。

## 5. 觸發時機

`EVALUATE_RECIDIVISM` effect 由狀態機在下列時點發出（見 `domain/workflow.ts`）：

| 事件 | 為何要重新評估 |
|---|---|
| 學生送出反思卡 | 新增一張計入的卡片 → 可能達標 |
| 導師勾選班級活動優先（豁免） | 該卡不再計入 → 重新計算目前張數 |
| 生教組撤銷違規 | 同上 |

## 6. 複雜度與成本

- 時間：查詢受 `limit(50)` 約束，實務上一位學生 15 天內的卡片不會超過個位數；
  判定為 O(n log n)（排序），n ≤ 50。
- Firestore 讀取：每次評估 1 次查詢（讀取數 = 命中文件數，通常 ≤ 3）。
- 觸發時寫入：1（警示）+ n（認列）+ 1（派單）+ 1（管制帳）≈ 6 次。

## 7. 測試覆蓋

`functions/test/recidivism.test.ts`（13 項）＋ `dates.test.ts`（9 項）＋
`workflow.test.ts`（17 項）＝ **39 項，全數通過**；
`docs/sql/recidivism_test.sql` 另有 **10 項 SQL 斷言**（PostgreSQL 16 驗證）。

| 案例 | 期望 |
|---|---|
| 2 張 | 未觸發，`shortfall = 1` |
| 第 3 張送出 | 觸發，回傳視窗與 3 張明細 |
| 安全卡 + 好話卡混合 | 合併計算（不論卡種） |
| `countOn = asOf - 14` | 計入（視窗第 1 天） |
| `countOn = asOf - 15` | 排除 |
| 草稿 / 退回中 | 不計入 |
| 導師豁免（班級活動優先） | 不計入 |
| 已認列的 3 張 + 第 4 張 | 不再觸發（幂等） |
| 同班同學的卡片 | 不互相干擾 |
| 重複傳入同一張卡 | 只算一次 |
| 門檻 2 張 / 視窗 7 天 | 依參數正確觸發 |
| 未達門檻卻建立警示 | 擲出錯誤（防呆） |

## 8. 參數調整

`settings/system` 可調整而無須改程式：

```jsonc
{ "recidivismWindowDays": 15, "recidivismThreshold": 3, "observerPeriods": 5 }
```

每張警示都會留存觸發當時的 `windowDays` 與 `threshold` 快照，
因此校規調整後，既有案件的判定依據仍可追溯（申訴時尤其重要）。

## 9. 輔導前置：關注名單

`summarizeProgress()` / `peekProgress()` 提供**只讀**進度，不寫入任何資料：
儀表板因此能顯示「15 天內已 2 張、再 1 張即觸發」的學生，
讓生教組在處分發生前先介入晤談 —— 這是把累犯偵測從「處分工具」
轉為「預警工具」的關鍵設計。
