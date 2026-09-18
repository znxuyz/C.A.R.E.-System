# 部署指南

前端 → GitHub Pages；後端 → Firebase。兩者各自獨立部署，互不阻塞。

## 0. 前置需求

- Node.js 20 以上、npm 10 以上
- Firebase CLI：`npm i -g firebase-tools`
- 一個 Firebase 專案（建議 dev / prod 各一）

## 1. 本機開發

```bash
git clone https://github.com/znxuyz/C.A.R.E.-System.git
cd C.A.R.E.-System
npm ci

# ① 純前端預覽（不需 Firebase，使用模擬資料）
npm run dev:web            # http://localhost:5173

# ② 後端測試與型別檢查
npm test                   # vitest 39 項（純領域邏輯）
npm run test:rules         # 16 項安全規則測試（自動啟動 Firestore 模擬器，需 Java）
npm run typecheck

# ③ 連本機模擬器開發
cp .firebaserc.example .firebaserc     # 填入自己的專案 ID
npm run emulators                      # Auth 9099 / Functions 5001 / Firestore 8080 / UI 4000
FIRESTORE_EMULATOR_HOST=localhost:8080 GCLOUD_PROJECT=care-system-dev npm run seed:demo
```

## 2. Firebase 專案初始設定

1. **建立專案**（Firebase Console）並啟用：
   - Authentication → 登入方式：Email/密碼（或校內 Google Workspace）
   - Firestore Database → 正式模式、位置 `asia-east1`
   - Cloud Messaging（取得 VAPID 公鑰供前端推播使用）
   - Cloud Storage（選用，簽章筆跡與現場照片）
2. **升級為 Blaze 方案**：Cloud Functions 對外呼叫需要（用量仍在免費額度內）。
3. **安裝 Email 擴充套件**：Extensions → *Trigger Email from Firestore*
   - 集合名稱填 `mail`，並設定校方 SMTP 或 SendGrid 憑證。
4. **部署規則、索引與函式**：

```bash
firebase use --add                  # 選擇專案，別名 default
npm run deploy:backend              # firestore rules + indexes + functions + storage
```

5. **匯入初始資料**（系統參數、反思卡題目、地點）：

```bash
# 服務帳號金鑰：Console → 專案設定 → 服務帳戶 → 產生新的私密金鑰
GOOGLE_APPLICATION_CREDENTIALS=./serviceAccountKey.json npm run seed
# 需要示範班級與情境資料時改用：npm run seed:demo
```

> `serviceAccountKey.json` 已列入 `.gitignore`，**切勿提交**。

6. **建立帳號並指派角色**（角色存於 custom claims）：

```bash
# 先在 Authentication 建立使用者，取得 uid 後由管理者呼叫 callable
firebase functions:shell
> setUserRoles({ uid: 'UID', roles: ['DISCIPLINE_STAFF'] })
> setUserRoles({ uid: 'UID', roles: ['HOMEROOM_TEACHER'] })
> setUserRoles({ uid: 'UID', roles: ['STUDENT'], studentId: 'stu_701_01' })
```

同時把導師 uid 寫入對應 `classes/{classId}.homeroomTeacherUid`
（安全規則以此判定「本班」）。

## 3. GitHub Pages（前端）

1. Repository → **Settings → Pages → Source 選 “GitHub Actions”**。
2. Repository → **Settings → Secrets and variables → Actions**，新增：

| Secret | 取得位置 |
|---|---|
| `VITE_FIREBASE_API_KEY` | 專案設定 → 一般 → 你的應用程式 |
| `VITE_FIREBASE_AUTH_DOMAIN` | 同上（`<project>.firebaseapp.com`） |
| `VITE_FIREBASE_PROJECT_ID` | 同上 |
| `VITE_FIREBASE_STORAGE_BUCKET` | 同上 |
| `VITE_FIREBASE_MESSAGING_SENDER_ID` | 同上 |
| `VITE_FIREBASE_APP_ID` | 同上 |
| `VITE_FIREBASE_VAPID_KEY` | Cloud Messaging → 網頁推送憑證 |

> 未設定這些 secrets 時，Pages 仍會部署成功，但以**示範模式（模擬資料）**執行，
> 適合先給主任、學務處看動線再決定是否導入。

3. 推送到 `main` 即自動部署；網址為
   `https://<帳號>.github.io/C.A.R.E.-System/`
4. 回到 Firebase Console → **Authentication → Settings → 授權網域**，
   加入 `<帳號>.github.io`，否則登入會被拒絕。

### 自訂網域

若使用學校網域（例如 `care.school.edu.tw`）：
Pages 設定自訂網域後，在 Actions secrets 或 workflow 環境變數加入 `VITE_BASE=/`。

## 4. 後端自動部署（選用）

`.github/workflows/firebase-deploy.yml` 會在 `functions/`、規則或索引變更時自動部署。
需設定：

| Secret | 說明 |
|---|---|
| `FIREBASE_SERVICE_ACCOUNT` | 服務帳號 JSON（Firebase Admin + Cloud Functions Admin） |
| `FIREBASE_PROJECT_ID` | 目標專案 ID |

## 5. 上線前檢查清單

- [ ] `settings/system` 的 15 天 / 3 張 / 5 節與校規一致
- [ ] `schoolCalendar` 已匯入本學期假日與補課日（影響「隔日解鎖」）
- [ ] 每個班級都有 `homeroomTeacherUid`，否則違規通知無法送達
- [ ] 生教組帳號的 `staff` 文件 `active: true`（通知對象查詢依此）
- [ ] 導師與生教組已在手機登入一次並允許推播（註冊 FCM token）
- [ ] Email 擴充套件寄信測試通過
- [ ] 以測試學生跑一次完整流程：登錄 → 填卡 → 簽章 → 蓋章 → 確認當日解除管制
- [ ] 連續建立 3 張卡，確認警示觸發、派單產生、第 4 張不再重複觸發
- [ ] 索引部署完成（Console → Firestore → 索引，狀態為「已啟用」）
- [ ] `npm run test:rules` 於部署後的規則版本仍全數通過

## 6. 維運

| 項目 | 做法 |
|---|---|
| 備份 | Firestore 排程匯出至 Cloud Storage（`gcloud firestore export`），建議每日 |
| 統計分析 | 啟用 Firestore → BigQuery 匯出，套用 `docs/sql/recidivism.sql` 的檢視 |
| 學年更新 | 更新 `classes`、`students`、`schoolCalendar`；歷史案件保留不動 |
| 稽核 | `auditLogs` 僅管理者可讀，含每次登錄／簽章／蓋章／豁免／撤銷 |
| 監控 | Cloud Functions 記錄於 Cloud Logging；排程失敗會留 `[rollForward]` 錯誤日誌 |
