# 部署指南

前端 → GitHub Pages；後端 → Firebase。兩者各自獨立部署。

## 0. 前置需求

- Node.js 20 以上、npm 10 以上
- Java（JDK）21 以上 —— 僅本機跑安全規則測試時需要
- 一個 Firebase 專案（建議 dev / prod 各一）

## 1. 本機開發

```bash
git clone https://github.com/znxuyz/C.A.R.E.-System.git
cd C.A.R.E.-System
npm ci

# ① 純前端預覽（不需 Firebase，使用模擬資料，可完整走完流程）
npm run dev:web            # http://localhost:5173

# ② 測試與型別檢查
npm test                   # 33 項單元測試（純領域邏輯）
npm run test:rules         # 9 項安全規則測試（自動啟動 Firestore 模擬器，需 JDK 21）
npm run typecheck

# ③ 連本機模擬器開發
cp .firebaserc.example .firebaserc     # 填入自己的專案 ID
npm run emulators
FIRESTORE_EMULATOR_HOST=localhost:8080 GCLOUD_PROJECT=care-system-dev npm run seed:demo
```

## 2. Firebase 專案設定

1. **建立專案**（Firebase Console）並啟用：
   - Authentication → 登入方式：**Google**
     （若學校使用 Google Workspace，建議一併於前端設定 `VITE_GOOGLE_HD`
     限定只有校內網域可登入）
   - Firestore Database → 正式模式、位置 `asia-east1`
2. **升級為 Blaze 方案**：Cloud Functions 對外呼叫需要（用量仍在免費額度內）。
3. **（選用）Email 通知**：若要在登錄違規時寄信給導師，
   安裝 Extensions → *Trigger Email from Firestore*（集合名稱填 `mail`），
   並在 `settings/system` 把 `emailHomeroom` 設為 `true`、
   於 `classes/{id}.homeroomEmail` 填入導師信箱。
4. **設定管理者信箱白名單**：複製 `functions/.env.example` 為 `functions/.env`，
   填入你自己的 Google 信箱（可多筆，逗號分隔）：

```bash
cp functions/.env.example functions/.env
# ADMIN_EMAILS="you@example.edu.tw"
```

   這份名單決定「誰用 Google 登入後會自動取得系統管理者權限」，
   是整個授權鏈的起點，因此只放必要的人（通常 1–2 位）。

5. **部署規則、索引與函式**：

```bash
firebase use --add                  # 選擇專案，別名 default
npm run deploy:backend              # firestore rules + indexes + functions
```

6. **匯入初始資料**（系統參數、違規類型、地點）：

```bash
# 服務帳號金鑰：Console → 專案設定 → 服務帳戶 → 產生新的私密金鑰
GOOGLE_APPLICATION_CREDENTIALS=./serviceAccountKey.json npm run seed
# 需要示範資料時改用：npm run seed:demo
```

> `serviceAccountKey.json` 已列入 `.gitignore`，**切勿提交**。

7. **授權使用者**（全部在畫面上完成，不需再用指令）：

   1. 你（管理者）用 **Google 登入**系統 → 信箱在 `ADMIN_EMAILS` 內，
      系統自動指派 `ADMIN` + `DISCIPLINE_STAFF`。
   2. 進入 **帳號管理** 頁，輸入生教組長的 Google 信箱、勾選「生活教育組長」→ 授權。
      對方**不需要事先註冊**：授權會先存起來，待其首次以 Google 登入時自動生效。
   3. 若要取消，於同頁按「取消授權」；系統會清除角色並讓該帳號的登入憑證立即失效。

> 若登入後看到「尚未授權」畫面，表示信箱不在 `ADMIN_EMAILS` 也沒有被授權；
> 確認信箱無誤後按「重新檢查授權」即可。

8. **匯入學生與班級名單**：
   `students`（`studentNo`、`name`、`classId`、`className`、`seatNo`）與
   `classes`（`name`）。可用 Firebase Console 匯入，或擴充 `seed/seed.mjs`
   讀取校務系統匯出的 CSV。

## 3. GitHub Pages（前端）

1. Repository → **Settings → Pages → Source 選 “GitHub Actions”**
   （若維持預設的 “Deploy from a branch”，Pages 會直接把 README 當網頁顯示）。
2. Repository → **Settings → Secrets and variables → Actions**，新增：

| Secret | 取得位置 |
|---|---|
| `VITE_FIREBASE_API_KEY` | 專案設定 → 一般 → 你的應用程式 |
| `VITE_FIREBASE_AUTH_DOMAIN` | 同上（`<project>.firebaseapp.com`） |
| `VITE_FIREBASE_PROJECT_ID` | 同上 |
| `VITE_FIREBASE_STORAGE_BUCKET` | 同上 |
| `VITE_FIREBASE_MESSAGING_SENDER_ID` | 同上 |
| `VITE_FIREBASE_APP_ID` | 同上 |

> 未設定這些 secrets 時，Pages 仍會部署成功，但以**示範模式（模擬資料）**執行，
> 適合先給主任、學務處看動線再決定是否導入。

3. 推送到預設分支即自動部署；網址為
   `https://<帳號>.github.io/C.A.R.E.-System/`
4. 回到 Firebase Console → **Authentication → Settings → 授權網域**，
   加入 `<帳號>.github.io`，否則 Google 登入會被拒絕。

### 自訂網域

Pages 設定自訂網域後，在 workflow 環境變數加入 `VITE_BASE=/`。

## 4. 後端自動部署（選用）

`.github/workflows/firebase-deploy.yml` 會在 `functions/`、規則或索引變更時自動部署。
需設定 `FIREBASE_SERVICE_ACCOUNT`（服務帳號 JSON）與 `FIREBASE_PROJECT_ID`。

## 5. 上線前檢查清單

- [ ] `functions/.env` 的 `ADMIN_EMAILS` 只含必要的管理者信箱
- [ ] 管理者可用 Google 登入並看到「帳號管理」「系統設定」兩頁
- [ ] 生教組長已授權，且以自己的 Google 帳號登入成功
- [ ] 於「系統設定」確認 15 天 / 3 次 / 5 節與校規一致（可直接在畫面上調整）
- [ ] `settings/system.publicBoard.showRoster` 的設定已與學務主任確認
      （預設 `false`＝公開頁只顯示統計，不列個別學生）
- [ ] `schoolCalendar` 已匯入本學期假日與補課日（影響「隔日解鎖」）
- [ ] 學生名單含 `seatNo`（公開看板若開啟名單會用到）
- [ ] 生教組長帳號可正常登入，且能看到儀表板
- [ ] `npm run test:rules` 於部署後的規則版本仍全數通過
- [ ] 以測試學生跑一次完整流程：登錄 → 已回收 → 確認當日管制解除
- [ ] 連續登錄 3 次，確認警示觸發、派單產生、第 4 次不再重複觸發
- [ ] 索引部署完成（Console → Firestore → 索引，狀態為「已啟用」）

## 6. 維運

| 項目 | 做法 |
|---|---|
| 備份 | Firestore 排程匯出至 Cloud Storage（`gcloud firestore export`），建議每日 |
| 統計分析 | 啟用 Firestore → BigQuery 匯出，套用 `docs/sql/recidivism.sql` 的檢視 |
| 學年更新 | 更新 `classes`、`students`、`schoolCalendar`；歷史紀錄保留不動 |
| 稽核 | `auditLogs` 僅 `ADMIN` 可讀，含每次登錄／回收／免記／撤銷／改期 |
| 監控 | Cloud Functions 記錄於 Cloud Logging；排程失敗會留 `[rollForward]` 錯誤日誌 |
