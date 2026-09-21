# 部署與維運

> **第一次導入請看 [Firebase 設定手冊](firebase-setup.md)** —— 那份是逐步點選的操作指引。
> 本篇是指令速查與日常維運。

前端 → GitHub Pages；資料 → Firebase Firestore。
**完全在 Firebase 免費方案（Spark）內**，沒有 Cloud Functions 需要部署。

## 0. 前置需求

| 項目 | 說明 |
|---|---|
| Node.js 20 以上 | |
| Java（JDK）21 以上 | 僅本機跑安全規則測試時需要 |
| Firebase 方案 | **免費的 Spark 即可**，不需升級、不需信用卡 |

## 1. 本機開發

```bash
git clone https://github.com/znxuyz/C.A.R.E.-System.git
cd C.A.R.E.-System
npm ci

# ① 純前端預覽（不需 Firebase，使用模擬資料，可完整走完流程）
npm run dev:web            # http://localhost:5173

# ② 測試與型別檢查
npm test                   # 33 項單元測試（純領域邏輯）
npm run test:rules         # 27 項安全規則測試（自動啟動 Firestore 模擬器，需 JDK 21）
npm run typecheck

# ③ 連本機模擬器開發
cp .firebaserc.example .firebaserc     # 填入自己的專案 ID
npm run emulators
FIRESTORE_EMULATOR_HOST=localhost:8080 GCLOUD_PROJECT=care-system-dev npm run seed:demo
```

## 2. 部署

```bash
firebase use --add        # 選擇專案（僅第一次）
npm run deploy:rules      # 部署 firestore.rules 與複合索引
```

前端由 GitHub Actions 自動部署（推送到預設分支即觸發），
或到 **Actions → Deploy web to GitHub Pages → Run workflow** 手動執行。

> 安全規則是本架構的唯一防線，**每次改動規則後務必先跑 `npm run test:rules`**，
> CI 也會擋。

## 3. 初始資料

```bash
# 建立第一位管理者的授權 + 匯入違規類型、地點、系統參數
GOOGLE_APPLICATION_CREDENTIALS=./serviceAccountKey.json \
ADMIN_EMAILS="you@example.edu.tw" \
npm run seed

# 需要示範班級/學生/情境時
... npm run seed:demo
```

也可以完全不用指令：在 Firebase Console 手動建立一筆 `accessGrants/{你的信箱}`
（欄位見 [設定手冊 §4](firebase-setup.md#4-建立第一位管理者授權鏈的起點)）。

## 4. 上線前檢查清單

- [ ] `npm run test:rules` 全數通過，且規則已部署（`npm run deploy:rules`）
- [ ] 索引狀態為「已啟用」（Console → Firestore → 索引）
- [ ] 管理者可用 Google 登入並看到「帳號管理」「系統設定」
- [ ] 生教組長已授權並登入成功
- [ ] 「系統設定」的 15 天 / 3 次 / 5 節與校規一致
- [ ] `settings/system.publicBoard.showRoster` 已與學務主任確認（預設關閉）
- [ ] `schoolCalendar` 已匯入本學期假日與補課日（影響「隔日解鎖」）
- [ ] GitHub Pages 網址已加入 Firebase 授權網域
- [ ] 跑過一次完整流程：登錄 → 已回收 → 確認管制解除 → 連 3 次觸發 → 第 4 次不重複觸發

## 5. 日常維運

| 情境 | 做法 |
|---|---|
| 換生教組長 | 帳號管理 → 舊的「取消授權」、新的以信箱授權（下一次請求即生效） |
| 調整校規參數 | 系統設定頁直接改，不需重新部署 |
| 新增管理者 | 帳號管理頁指派「系統管理者」角色 |
| 新學年 | 更新 `classes`、`students`、`schoolCalendar`；歷史紀錄保留不動 |
| 程式更新 | `git pull` → `npm ci` → `npm run deploy:rules`（前端推上 GitHub 後自動部署） |
| 稽核 | `auditLogs` 僅管理者可讀，含每次登錄／回收／免記／撤銷／改期／設定變更 |
| 備份 | 以服務帳戶金鑰定期執行匯出腳本；或用 `firebase emulators:export` 於本機留存 |

## 6. 監控與排錯

* 使用者端錯誤會直接顯示在畫面上（例如「Missing or insufficient permissions」
  代表規則拒絕，多半是未授權或資料形狀不符）。
* Firestore 用量：Console → Firestore → **使用量** 分頁，可確認是否仍在免費額度內。
* 規則除錯：`npm run emulators` 啟動後，模擬器 UI（http://localhost:4000）的
  **Firestore → Requests** 會逐條顯示規則判定過程。
