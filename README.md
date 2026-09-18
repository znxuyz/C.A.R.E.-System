# C.A.R.E. System

**Conduct Assessment & Reflection Education System**
校園生活管教數位化行為反思與追蹤系統

線上串聯「學生填寫 → 導師簽章 → 生教組審核」工作流，全面取代傳統紙本，
並具備自動化累犯警示機制。把「走廊奔跑」與「口出穢言」等違規行為，
轉化為即時、透明且符合正向管教規範的教育反思歷程。

```
前端：GitHub Pages（React + Vite + TypeScript）
後端：Firebase（Firestore + Cloud Functions + Auth + Cloud Messaging）
```

![生教組戰情儀表板](docs/images/office-dashboard.png)

## 核心功能

| 模組 | 說明 |
|---|---|
| **違規事件登錄與通報** | 生教組／糾察隊／巡堂教師 30 秒完成登錄；系統自動凍結該生當日自由下課權限，並以 App 推播與 Email 通知班導師 |
| **雙軌反思卡工作流** | 走廊奔跑 👉 校園安全反思卡；口出穢言 👉 口說好話反思卡。學生於學務處填寫 → 導師線上簽章（可勾選「導師班級活動優先」不計處分）→ 生教組蓋章 → **當日自動解除管制** |
| **自動化累犯偵測** | 每筆違規成立時回溯 **15 天（含當天）**；累計達 **3 張**反思卡即發出警示並排入安全觀察員追蹤清單 |
| **安全觀察員制度** | 一日下課共 5 節（扣除打掃時間與 5 分鐘短下課）至學務處值勤；值勤後提交行為檢討書，經雙重審核後**隔日**解鎖 |
| **正向管教保障** | 管制期間**可正常飲水與如廁**（介面常駐提示）；退回須填原因；每次簽章留存 SHA-256 憑據與完整稽核軌跡 |

## 文件

| 文件 | 內容 |
|---|---|
| [技術架構](docs/architecture.md) | 系統組成、技術選型理由、分層原則、安全模型、成本概估 |
| [資料庫綱要](docs/database-schema.md) | Firestore 集合與文件結構、ER 圖、複合索引、安全規則要點 |
| [累犯偵測演算法](docs/recidivism-algorithm.md) | 15 天/3 張的語意界定、TypeScript 與 Firestore 交易實作、SQL 等價版、併發與幂等 |
| [生教組端 UI 規劃](docs/ui-spec-discipline.md) | 使用情境、資訊架構、逐頁版面與設計決定、狀態色彩系統、無障礙規範 |
| [業務流程與狀態機](docs/workflow.md) | 全流程時序圖、案件狀態機、副作用、下課管制生命週期、排程作業 |
| [部署指南](docs/deployment.md) | 本機開發、Firebase 初始設定、GitHub Pages 部署、上線檢查清單 |
| [SQL 參考實作](docs/sql/recidivism.sql) | 關聯式等價版本 + [10 項自我驗證斷言](docs/sql/recidivism_test.sql)（PostgreSQL 16 驗證通過） |

## 快速開始

```bash
npm ci

# 免 Firebase 直接預覽介面（示範模式：模擬資料，可完整走完流程）
npm run dev:web        # http://localhost:5173

npm test               # 39 項單元測試（累犯演算法、日期視窗、工作流狀態機）
npm run test:rules     # 16 項 Firestore 安全規則測試（自動啟動模擬器）
npm run typecheck      # functions + web
npm run build
```

部署步驟見 [部署指南](docs/deployment.md)。未設定 Firebase 金鑰時，
前端會自動以**示範模式**運作，適合先向學務處演示操作動線。

## 專案結構

```
functions/src/domain/     ★ 純領域層：累犯演算法、日期視窗、雙重審核狀態機（可單元測試）
functions/src/services/     違規登錄、案件審核、累犯交易、觀察員值勤、下課管制帳
functions/src/handlers/     callable 端點、排程作業（每日續帳 / 待簽提醒）、角色管理
web/src/pages/              生教組 6 頁 + 導師簽章 + 學生填卡
firestore.rules             角色化授權（業務寫入預設全拒，一律經 callable）
firestore.indexes.json      16 組複合索引（含累犯視窗查詢）
seed/                       系統參數、雙軌反思卡與行為檢討書題目、示範資料
docs/                       架構、綱要、演算法、UI 規劃、部署文件
```

## 關鍵設計決定

1. **累犯基準日用「違規發生日」而非填寫日** — 學生隔天補填不會讓 15 天視窗漂移，
   也無法藉拖延規避。
2. **卡片認列（`consumedByAlertId`）** — 觸發警示時把計入的卡片標記給該次警示，
   第 4、5 張不會對同一波違規重複處分；演算法因此具備幂等性。
3. **累犯偵測必須在交易內執行** — 學生同一節下課連送兩張卡時，
   避免產生兩張警示（double punishment）。
4. **前端不持有規則** — 安全規則禁止前端寫入業務集合，
   簽章時間、認列欄位、管制狀態都無法偽造；規則本身有 16 項模擬器測試把關
   （含「學生不可藉暫存作答夾帶狀態或累犯欄位」）。
5. **下課管制採「每日一筆」帳** — 對應紙本每日重開一頁；
   同日多重來源須全部解除才解鎖，未完成者由排程續帳。
6. **參數外置於 `settings/system`** — 校規調整（15 天 / 3 張 / 5 節）不需改程式，
   且每張警示留存當時參數快照以便申訴追溯。

## 授權

MIT
