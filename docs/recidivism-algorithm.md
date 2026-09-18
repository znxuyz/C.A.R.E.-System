# 再犯偵測核心演算法（15 天 / 3 次）

## 1. 規格與語意界定

> 系統須在每筆違規成立時，自動往前檢索 **15 天內（含當天）** 該生的累計紀錄；
> 若重複達 **3 次**（不論走廊奔跑或口出穢言），系統須立即發出警示，
> 並自動將該生排入「安全觀察員追蹤清單」。

規格落地時必須先釘住五個模糊點，否則同一句話會有不同實作結果：

| # | 模糊點 | 本系統的決定 | 理由 |
|---|---|---|---|
| 1 | 「15 天內（含當天）」的邊界 | 視窗 = `[基準日 - 14, 基準日]`，兩端皆含，共 15 天 | 含當天即第 1 天；`as_of=9/18` → `9/04 ~ 9/18` |
| 2 | 以哪一天計數 | **違規發生日** `occurredOn`，非登錄日 | 事後補登錄不該讓視窗漂移 |
| 3 | 何時算一次 | 違規**登錄即成立**，紙本是否回收不影響次數 | 否則學生拖延繳卡就能降低次數 |
| 4 | 哪些不計入 | 免記（班級活動優先等）、撤銷（誤報） | 兩者皆非有效違規 |
| 5 | 第 4、5 次是否再次觸發 | 不會。觸發時把計入的違規「**認列**」給該警示，之後需再累積 3 次新紀錄 | 避免同一波違規被重複處分 |

## 2. 演算法

```
evaluateRecidivism(studentId, asOf, config):
    windowStart ← asOf - (config.windowDays - 1)         # 含當天
    windowEnd   ← asOf

    candidates ← 查詢 infractions WHERE
                   studentId = studentId
               AND countsTowardRecidivism = true          # 排除免記／撤銷
               AND consumedByAlertId = null               # 排除已認列
               AND status ∈ {OPEN, DONE}
               AND occurredOn BETWEEN windowStart AND windowEnd

    counted   ← 依 occurredOn 排序、依 id 去重(candidates)
    triggered ← |counted| ≥ config.threshold

    return { triggered, count: |counted|,
             shortfall: max(0, threshold - |counted|),
             windowStart, windowEnd, counted }
```

觸發後（**同一個交易內**）：

```
if triggered:
    alert ← 建立 recidivismAlerts 文件
              { windowDays, threshold, windowStart, windowEnd,
                count, triggerInfractionId, infractionIds, breakdown,
                status: 'ASSIGNED' }                      # 即列入追蹤清單

    for item in counted:                                  # 認列（幂等關鍵）
        item.consumedByAlertId ← alert.id

    assignment ← 建立 observerAssignments 文件
                   { dutyOn: nextSchoolDay(today),        # 依校曆順延假日
                     totalPeriods: 5, periodLogs: [1..5],
                     status: 'SCHEDULED' }

交易外：
    凍結 dutyOn 當日的下課權限（recessRestrictions）
```

## 3. 實作位置

| 層 | 檔案 | 職責 |
|---|---|---|
| 純邏輯 | [`functions/src/domain/recidivism.ts`](../functions/src/domain/recidivism.ts) | `evaluateRecidivism()`、`buildAlert()`、`summarizeProgress()`；無 I/O |
| 視窗運算 | [`functions/src/domain/dates.ts`](../functions/src/domain/dates.ts) | `recidivismWindow()`、`nextSchoolDay()`（Asia/Taipei） |
| 查詢 | [`functions/src/data/repositories.ts`](../functions/src/data/repositories.ts) | `readRecidivismWindow()`（交易內讀取） |
| 交易與派單 | [`functions/src/services/recidivismService.ts`](../functions/src/services/recidivismService.ts) | `evaluateAndTrigger()`、`peekProgress()` |
| SQL 等價版 | [`sql/recidivism.sql`](sql/recidivism.sql) | `evaluate_recidivism()`、`trigger_recidivism_if_needed()` |

### 3.1 核心純函式（TypeScript）

```ts
export function evaluateRecidivism(input: {
  studentId: string;
  asOf: SchoolDate;            // 'YYYY-MM-DD'（Asia/Taipei）
  infractions: CountableInfraction[];
  config: RecidivismConfig;    // { windowDays: 15, threshold: 3 }
}): RecidivismEvaluation {
  const { windowStart, windowEnd } = recidivismWindow(input.asOf, input.config.windowDays);

  const counted = input.infractions
    .filter((item) => item.studentId === input.studentId)
    .filter((item) => isCountable(item, windowStart, windowEnd))
    .filter((item, i, all) => all.findIndex((c) => c.id === item.id) === i)   // 去重
    .sort(/* occurredOn, id */);

  const count = counted.length;
  const triggered = count >= input.config.threshold;
  return { /* … */ triggered, count,
           shortfall: triggered ? 0 : input.config.threshold - count,
           windowStart, windowEnd, counted };
}

export function isCountable(item, windowStart, windowEnd): boolean {
  return item.countsTowardRecidivism
    && item.consumedByAlertId === null
    && COUNTABLE_STATUSES.includes(item.status)          // OPEN / DONE
    && item.occurredOn >= windowStart && item.occurredOn <= windowEnd;
}
```

### 3.2 Firestore 查詢

```ts
const query = firestore.collection('infractions')
  .where('studentId', '==', studentId)
  .where('countsTowardRecidivism', '==', true)
  .where('consumedByAlertId', '==', null)
  .where('status', 'in', ['OPEN', 'DONE'])
  .where('occurredOn', '>=', windowStart)
  .where('occurredOn', '<=', windowEnd)
  .orderBy('occurredOn', 'asc')
  .limit(50);

const snap = await tx.get(query);   // ★ 必須在 Transaction 內讀取
```

需要的複合索引（欄位順序：等值在前、範圍在後）：

```
infractions: studentId ASC, countsTowardRecidivism ASC,
             consumedByAlertId ASC, status ASC, occurredOn ASC
```

> 注意：`consumedByAlertId` 未認列時必須**明確寫入 `null`**。
> Firestore 不索引缺漏欄位，欄位不存在的文件不會出現在查詢結果中。

### 3.3 等價 SQL（PostgreSQL / BigQuery）

```sql
-- 計入再犯的違規
CREATE VIEW countable_infractions AS
SELECT * FROM infractions
 WHERE counts_toward_recidivism
   AND consumed_by_alert_id IS NULL
   AND status IN ('OPEN','DONE');

-- 某生於基準日的視窗次數
SELECT count(*)
  FROM countable_infractions
 WHERE student_id = :student_id
   AND occurred_on BETWEEN (:as_of - 14) AND :as_of;    -- 含當天共 15 天
```

報表用滾動視窗（一次算出每筆當下的累計次數，用於找「已 2 次」的關注名單）：

```sql
SELECT student_id, id, occurred_on,
       count(*) OVER (
         PARTITION BY student_id
         ORDER BY occurred_on
         RANGE BETWEEN INTERVAL '14 days' PRECEDING AND CURRENT ROW
       ) AS rolling_15d_count
  FROM countable_infractions;
```

完整版（含原子化觸發 `trigger_recidivism_if_needed()`、關注名單檢視）見
[`sql/recidivism.sql`](sql/recidivism.sql)。

## 4. 併發與幂等

**問題**：同一節下課可能連續登錄兩筆違規。若「讀取視窗 → 判定 → 建立警示」
不是原子操作，會產生兩張警示 → 學生被罰兩次。

**做法**：

1. Firestore：整段包在 `runTransaction()` 內；交易讀到的文件若在提交前被變更，
   交易會自動重試，不會有兩個交易同時看到「差一次就達標」而各自觸發。
2. 認列欄位：觸發時把計入的違規標記 `consumedByAlertId`，演算法因此具幂等性。
3. SQL 版本：以 `SELECT … FOR UPDATE` 鎖住視窗內候選列，達到同樣效果。

**撤銷誤判**：`dismissAlert()` 會把該警示認列的違規 `consumedByAlertId` 還原為 `null`，
學生不會因一次誤判而永久損失 3 次額度。

## 5. 觸發時機

`evaluateAndTrigger()` 在**違規登錄當下**執行一次（`infractionService.logInfraction`）。
免記／撤銷只會讓該筆不再計入，不需重新觸發判定 —— 因為門檻是「達到就觸發」，
少一筆不會讓已發生的警示失效（需要撤銷時由生教組長於警示板操作）。

## 6. 複雜度與成本

- 時間：查詢受 `limit(50)` 約束，實務上一位學生 15 天內不會超過個位數；
  判定為 O(n log n)（排序），n ≤ 50。
- Firestore 讀取：每次登錄 1 次視窗查詢（讀取數 = 命中文件數，通常 ≤ 3）。
- 觸發時寫入：1（警示）+ n（認列）+ 1（派單）+ 1（管制帳）≈ 6 次。

## 7. 測試覆蓋

`functions/test/recidivism.test.ts`（14 項）＋ `dates.test.ts`（9 項）＋
`caseRules.test.ts`（10 項）＝ **33 項，全數通過**；
`docs/sql/recidivism_test.sql` 另有 **10 項 SQL 斷言**（PostgreSQL 16 驗證）。

| 案例 | 期望 |
|---|---|
| 2 次 | 未觸發，`shortfall = 1` |
| 第 3 次登錄 | 觸發，回傳視窗與 3 筆明細 |
| 走廊奔跑 + 口出穢言混合 | 合併計算（不論類型） |
| 紙本已回收（DONE）與未回收（OPEN） | 皆計入 |
| `occurredOn = asOf - 14` | 計入（視窗第 1 天） |
| `occurredOn = asOf - 15` | 排除 |
| 免記（班級活動優先） | 不計入 |
| 撤銷（誤報） | 不計入 |
| 已認列的 3 筆 + 第 4 筆 | 不再觸發（幂等） |
| 同班同學的紀錄 | 不互相干擾 |
| 重複傳入同一筆 | 只算一次 |
| 門檻 2 次 / 視窗 7 天 | 依參數正確觸發 |
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
儀表板因此能顯示「15 天內已 2 次、再 1 次即觸發」的學生，
讓生教組長在處分發生前先介入晤談 —— 這是把再犯偵測從「處分工具」
轉為「預警工具」的關鍵設計。
