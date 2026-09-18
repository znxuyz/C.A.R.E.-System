# C.A.R.E. System

**Conduct Assessment & Reflection Education System**
校園生活管教 — 違規登錄與再犯追蹤系統

紙本反思卡照舊，系統負責最難用手算的部分：**自動追蹤每位學生 15 天內的再犯次數**，
達門檻立即警示並排入安全觀察員追蹤，同時管理每日下課管制名單。

```
使用者：生活教育組長一人操作（其他老師看公開唯讀看板）
前端：GitHub Pages（React + Vite + TypeScript）
後端：Firebase（Firestore + Cloud Functions + Auth）
```

![生教組儀表板](docs/images/dashboard.png)

## 核心功能

| 模組 | 說明 |
|---|---|
| **違規登錄** | 學號一輸入即帶出姓名、班級與「15 天內已幾次」；選類型（走廊奔跑／口出穢言）、地點、節次即完成。系統自動凍結該生當日自由下課，並提示應發哪一張紙本反思卡 |
| **自動再犯偵測** | 每筆登錄自動回溯 **15 天（含當天）**；累計達 **3 次**即發出警示，並自動排入安全觀察員追蹤清單 |
| **紙本回收追蹤** | 學生繳回紙本反思卡後按「已回收」→ **當日**解除下課管制；未回收者由排程每日續管制 |
| **安全觀察員** | 一日下課 5 節（扣除打掃與 5 分鐘短下課）至學務處值勤，逐節打卡並記錄勸導人數；繳回紙本行為檢討書後 **隔日（下一個上課日）** 解鎖 |
| **公開唯讀看板** | 其他老師不需帳號即可查看每日概況；**預設只顯示統計數字**，不含姓名、學號與個別明細 |
| **正向管教保障** | 管制期間**可正常飲水與如廁**（介面常駐提示）；免記／撤銷須填事由；所有動作寫入稽核軌跡 |

## 畫面

| 公開唯讀看板（免登入） | 待回收紙本 |
|---|---|
| ![公開看板](docs/images/public-board.png) | ![待回收紙本](docs/images/pending-cases.png) |

## 文件

| 文件 | 內容 |
|---|---|
| [技術架構](docs/architecture.md) | 系統組成、技術選型、分層原則、權限與隱私模型、成本概估 |
| [資料庫綱要](docs/database-schema.md) | Firestore 集合與文件結構、ER 圖、複合索引、安全規則要點 |
| [再犯偵測演算法](docs/recidivism-algorithm.md) | 15 天/3 次的語意界定、TypeScript 與 Firestore 交易實作、SQL 等價版、併發與幂等 |
| [生教組端 UI 規劃](docs/ui-spec-discipline.md) | 使用情境、資訊架構、逐頁版面與設計決定、狀態色彩、無障礙規範 |
| [作業流程](docs/workflow.md) | 每日流程時序圖、案件狀態、下課管制生命週期、排程作業 |
| [部署指南](docs/deployment.md) | 本機開發、Firebase 設定、GitHub Pages 部署、上線檢查清單 |
| [SQL 參考實作](docs/sql/recidivism.sql) | 關聯式等價版本 + [10 項自我驗證斷言](docs/sql/recidivism_test.sql)（PostgreSQL 16 驗證通過） |

## 快速開始

```bash
npm ci

# 免 Firebase 直接預覽（示範模式：模擬資料，可完整走完流程）
npm run dev:web        # http://localhost:5173

npm test               # 33 項單元測試（再犯演算法、日期視窗、案件規則）
npm run test:rules     # 9 項 Firestore 安全規則測試（自動啟動模擬器，需 JDK 21）
npm run typecheck
npm run build
```

部署步驟見 [部署指南](docs/deployment.md)。未設定 Firebase 金鑰時，
前端會自動以**示範模式**運作，適合先向學務處演示操作動線。

## 專案結構

```
functions/src/domain/     ★ 純領域層：再犯演算法、日期視窗、案件規則（可單元測試）
functions/src/services/     違規登錄、再犯交易、觀察員值勤、下課管制帳、公開看板
functions/src/handlers/     callable 端點、每日排程、角色與設定管理
web/src/pages/              公開看板 + 生教組 7 頁
firestore.rules             未登入者僅可讀公開看板；業務寫入一律經 callable
firestore.indexes.json      8 組複合索引（含再犯視窗查詢）
seed/                       系統參數、違規類型、地點、示範資料
docs/                       架構、綱要、演算法、UI 規劃、部署文件
```

## 關鍵設計決定

1. **再犯以「違規紀錄」計次，不以紙本回收計次** — 紙本晚繳不影響次數，避免拖延即免責。
2. **基準日用違規發生日而非登錄日** — 事後補登錄不會讓 15 天視窗漂移。
3. **認列機制（`consumedByAlertId`）** — 觸發警示時把計入的違規標記給該次警示，
   第 4、5 次不會對同一波違規重複處分；演算法因此具幂等性，誤判撤銷時也會釋回額度。
4. **再犯偵測在 Firestore 交易內執行** — 同一節下課連續登錄兩筆時不會產生兩張警示。
5. **公開看板只讀一份去識別化摘要** — 公開頁不接觸任何業務集合；預設只有統計數字，
   即使開啟名單也只有班級＋座號，永不顯示姓名或學號。
6. **下課管制採「每日一筆」帳** — 對應紙本每日重開一頁；同日多重來源須全部解除才解鎖。
7. **參數外置於 `settings/system`** — 15 天／3 次／5 節可調，且每張警示留存當時參數快照。

## 授權

MIT
