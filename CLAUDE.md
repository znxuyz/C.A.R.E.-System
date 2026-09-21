# C.A.R.E. System — 開發須知

校園生活管教的違規登錄與再犯追蹤系統。前端部署於 GitHub Pages，
後端為 Firebase **免費 Spark 方案**。

## 分支與推送（使用者指定）

- **正式分支是 `main`**，線上網站即由 `main` 部署（`.github/workflows/deploy-pages.yml`）。
- 完成的變更**直接 commit 並 push 到 `main`**，不需另開分支或 PR，也不需等待使用者手動推送。
- 推送前一律先確認：型別檢查、單元測試、規則測試、建置全數通過。

## 架構紅線

- **不使用 Cloud Functions、不升級 Blaze 方案。** 所有業務邏輯在前端執行，
  原子性靠 Firestore 交易，權限與資料形狀由 `firestore.rules` 把關。
- 排程工作以「當天第一次開啟時續帳」取代（`core/services/dailySync.ts`）。
- 公開看板僅提供**去識別化**統計；名單即使開啟也只顯示班級＋座號，絕不顯示姓名或學號。
- 管教設計採正向管教：管制期間學生可正常飲水與如廁（`allowWaterAndRestroom`）。

## 常用指令

```bash
cd web
npm run typecheck     # tsc
npm test              # 單元測試（vitest）
npm run test:rules    # 安全規則測試（Firestore 模擬器，需 JDK 21+）
npm run build         # 建置
```

## 可調參數（後台「系統設定」，不需改程式）

回溯天數 1–365（預設 15）、觸發次數 1–20（預設 3）、值勤節次（預設第 1–5 節）、
紙本未回收是否續管制、公開看板開關。三處驗證需同步：
`core/services/settings.ts`、`firestore.rules`、`pages/Settings.tsx`。
