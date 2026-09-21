# Firebase 設定手冊（照著做即可）

第一次導入時從頭到尾約 **30 分鐘**。
全程只需要瀏覽器 + 終端機，不需要寫任何程式。

> 名詞對照：Firebase Console 介面語言可切換中英文，本文以中文為主、
> 括號內附英文，避免你在不同語言版本找不到按鈕。

---

## 0. 事前準備

| 項目 | 說明 |
|---|---|
| Google 帳號 | 建議用學校的 Google Workspace 帳號建立專案 |
| 信用卡 | Cloud Functions 需要 Blaze（隨用隨付）方案。**校園規模幾乎不會產生費用**，詳見 §7 |
| Node.js 20 以上 | https://nodejs.org 下載 LTS 版 |
| 專案原始碼 | `git clone https://github.com/znxuyz/C.A.R.E.-System.git` |

只是想先看畫面、還不想開 Firebase？直接跑 `npm ci && npm run dev:web`，
系統會以「示範模式」執行（模擬資料，可完整操作）。

---

## 1. Firebase Console 設定（瀏覽器，約 15 分鐘）

### 1-1. 建立專案

1. 開啟 https://console.firebase.google.com
2. 點 **「建立專案」（Create a project）**
3. 專案名稱輸入 `care-system`（或校名縮寫），按「繼續」
4. Google Analytics：**可以關閉**（本系統用不到），按「建立專案」
5. 等待約 30 秒 → 「繼續」

建立完成後，網址列會看到專案 ID（例如 `care-system-a1b2c`），**待會要用到**。
也可在 ⚙️ **專案設定（Project settings）→ 一般** 找到「專案 ID」。

### 1-2. 升級為 Blaze 方案

1. 左下角點 **「升級」（Upgrade）** 或齒輪旁的方案名稱
2. 選 **Blaze（隨用隨付 / Pay as you go）**
3. 綁定付款方式 → 確認

> 為什麼一定要：Cloud Functions（本系統的所有寫入邏輯）在免費的 Spark 方案不能對外提供服務。
> 升級後仍有每月免費額度，校園用量幾乎用不完（§7 有試算）。
> 保險起見可在升級畫面設定 **預算警示**，例如每月 NT$100 就寄信通知。

### 1-3. 啟用 Google 登入

1. 左側 **建構（Build）→ Authentication（驗證）**
2. 點 **「開始使用」（Get started）**
3. 切到 **Sign-in method（登入方式）** 分頁
4. 點 **Google** → 右上角開關切到 **啟用（Enable）**
5. 「專案的公開名稱」填 `C.A.R.E. System`
6. 「專案支援電子郵件」選你自己的信箱
7. 按 **儲存**

### 1-4. 建立 Firestore 資料庫

1. 左側 **建構（Build）→ Firestore Database**
2. 點 **「建立資料庫」（Create database）**
3. 位置（Location）選 **`asia-east1`（台灣）**
   > ⚠️ **位置建立後不能更改**，請確認選對再繼續。
4. 規則模式選 **「以正式版模式啟動」（Start in production mode）**
   > 選正式版即可，稍後會用指令把本專案的安全規則部署上去，覆蓋預設規則。
5. 按 **建立**

### 1-5. 新增網頁應用程式並複製設定

1. 回到 **專案總覽（Project Overview）**
2. 點 **`</>`（網頁）** 圖示
3. 應用程式暱稱填 `care-web`，**不要勾** 「同時為這個應用程式設定 Firebase Hosting」
   （我們用 GitHub Pages）
4. 按 **註冊應用程式**
5. 畫面會顯示一段 `firebaseConfig`，像這樣：

```js
const firebaseConfig = {
  apiKey: "AIzaSyXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
  authDomain: "care-system-a1b2c.firebaseapp.com",
  projectId: "care-system-a1b2c",
  storageBucket: "care-system-a1b2c.firebasestorage.app",
  messagingSenderId: "123456789012",
  appId: "1:123456789012:web:abcdef1234567890"
};
```

**把這六個值複製下來**（§3 設定 GitHub 時要貼）。
之後也可在 ⚙️ 專案設定 → 一般 → 「你的應用程式」再次查看。

> 這些值屬於**公開識別資訊**，被人看到不等於資料外洩 ——
> 真正的防線是 Firestore 安全規則與 Cloud Functions 授權（都已寫好且有測試）。

---

## 2. 部署後端（終端機，約 10 分鐘）

### 2-1. 安裝 Firebase CLI 並登入

```bash
npm install -g firebase-tools
firebase login
```

瀏覽器會跳出 Google 授權頁，選擇剛才建立專案的帳號並允許。
（若在沒有瀏覽器的機器上，改用 `firebase login --no-localhost`）

### 2-2. 取得程式碼並指定專案

```bash
git clone https://github.com/znxuyz/C.A.R.E.-System.git
cd C.A.R.E.-System
npm ci

firebase use --add
```

`firebase use --add` 會列出你的專案 → 選剛建立的那個 → 別名輸入 `default`。

### 2-3. 設定管理者信箱（關鍵步驟）

```bash
cp functions/.env.example functions/.env
```

用編輯器打開 `functions/.env`，把你的 Google 信箱填進去：

```
ADMIN_EMAILS="你的信箱@example.edu.tw"
```

> 這份名單決定「誰用 Google 登入後會自動成為系統管理者」，是整個授權鏈的起點。
> 建議只放 1–2 人。多筆用逗號分隔，不要有空白。
> **日後修改這個檔案後要重新部署**（`npm run deploy:backend`）才會生效。

### 2-4. 部署規則、索引與 Cloud Functions

```bash
npm run deploy:backend
```

第一次部署時 CLI 會問幾個問題：

| 提問 | 怎麼回答 |
|---|---|
| 要啟用 Cloud Functions / Cloud Build / Artifact Registry 等 API 嗎？ | **Yes**（必要） |
| Artifact Registry 是否設定清理政策（cleanup policy）？ | **Yes**，天數用預設（例如 3 天），可避免舊映像檔佔用儲存費用 |

整個過程約 3–5 分鐘。成功後會看到 `✔ Deploy complete!`。

**確認索引已建立**：Console → Firestore Database → **索引（Indexes）** 分頁，
應有 8 筆複合索引，狀態逐一變成 **「已啟用」（Enabled）**（約 1–2 分鐘）。

### 2-5. 匯入基本資料（違規類型、地點、系統參數）

需要一把服務帳戶金鑰：

1. Console → ⚙️ **專案設定 → 服務帳戶（Service accounts）**
2. 按 **「產生新的私密金鑰」（Generate new private key）** → 確認 → 會下載一個 `.json`
3. 把它改名成 `serviceAccountKey.json`，放到專案根目錄
   （此檔名已在 `.gitignore`，不會被提交）

```bash
GOOGLE_APPLICATION_CREDENTIALS=./serviceAccountKey.json npm run seed
```

會匯入：系統參數（15 天 / 3 次 / 5 節）、兩種違規類型、七個校園地點、一筆示範校曆。

> 想先用假資料試跑整套流程，改用 `npm run seed:demo`，
> 會多建立 3 個班級、5 位學生與幾筆違規情境。正式上線前記得清掉。

---

## 3. 部署前端到 GitHub Pages（約 5 分鐘）

### 3-1. 設定 Secrets

到你的 GitHub repository → **Settings → Secrets and variables → Actions → New repository secret**，
逐一新增（值就是 §1-5 複製的那六個）：

| Secret 名稱 | 對應 firebaseConfig 的欄位 |
|---|---|
| `VITE_FIREBASE_API_KEY` | `apiKey` |
| `VITE_FIREBASE_AUTH_DOMAIN` | `authDomain` |
| `VITE_FIREBASE_PROJECT_ID` | `projectId` |
| `VITE_FIREBASE_STORAGE_BUCKET` | `storageBucket` |
| `VITE_FIREBASE_MESSAGING_SENDER_ID` | `messagingSenderId` |
| `VITE_FIREBASE_APP_ID` | `appId` |

（選填）若只想讓學校網域的帳號能登入，再加一筆
`VITE_GOOGLE_HD` = `example.edu.tw`，並在 `.github/workflows/deploy-pages.yml`
的 `env:` 區塊加上同名變數。

### 3-2. 確認 Pages 來源

**Settings → Pages → Build and deployment → Source** 必須是 **「GitHub Actions」**。
若是「Deploy from a branch」，首頁會變成 README 而不是系統畫面。

### 3-3. 觸發部署

推一個 commit（或到 **Actions → Deploy web to GitHub Pages → Run workflow** 手動執行）。
完成後網址是：

```
https://<你的帳號>.github.io/C.A.R.E.-System/
```

### 3-4. 把網址加入 Firebase 授權網域（**忘了會無法登入**）

Console → **Authentication → 設定（Settings）→ 已授權網域（Authorized domains）**
→ **新增網域** → 輸入 `<你的帳號>.github.io` → 儲存。

---

## 4. 首次登入與授權

1. 開啟 `https://<你的帳號>.github.io/C.A.R.E.-System/`
   → 先看到**公開看板**（統計數字，免登入）
2. 右上角 **「生教組登入」** → **「使用 Google 帳號登入」**
3. 選擇你在 `ADMIN_EMAILS` 填的那個帳號
4. 登入後應直接進入儀表板，左側出現 **管理 → 帳號管理 / 系統設定**

   > 若看到「尚未授權」：表示信箱與 `ADMIN_EMAILS` 不一致。
   > 確認拼字（含大小寫無妨、前後不要有空白）後按「重新檢查授權」；
   > 若改過 `.env` 記得重新 `npm run deploy:backend`。

5. 進 **帳號管理** → 輸入生教組長的 Google 信箱 → 勾「生活教育組長」→ **授權**
   - 對方**不需事先註冊**，首次用 Google 登入時自動生效
6. 進 **系統設定** → 確認 15 天 / 3 次 / 5 節與校規一致（可直接改）

---

## 5. 匯入學生名單

目前需要手動建立 `students` 與 `classes` 兩個集合。
Console → Firestore Database → **開始集合**：

**`classes`** 文件 ID 自訂（例如 `cls_701`）：

| 欄位 | 型別 | 範例 |
|---|---|---|
| `name` | string | 七年一班 |
| `homeroomTeacherName` | string | 陳怡君（選填） |
| `homeroomEmail` | string | teacher@example.edu.tw（選填，開啟 Email 通知才需要） |

**`students`** 文件 ID 自訂（例如 `stu_701_01`）：

| 欄位 | 型別 | 範例 |
|---|---|---|
| `studentNo` | string | 1140101 |
| `name` | string | 王小明 |
| `classId` | string | cls_701 |
| `className` | string | 七年一班 |
| `seatNo` | number | 1 |

全校人數多時手動建很慢 —— 需要 CSV 批次匯入功能的話告訴我，可以加。

---

## 6. 驗收測試（建議用一位測試學生跑一遍）

- [ ] 登錄違規 → 確認「今日下課管制名單」出現該生
- [ ] 待回收紙本 → 按「已回收」→ 確認管制解除
- [ ] 連續登錄同一位學生 3 次 → 確認跳出再犯警示、產生安全觀察員派單
- [ ] 再登錄第 4 次 → 確認**不會**重複觸發新警示
- [ ] 安全觀察員值勤台 → 5 節打卡 → 「檢討書已回收」→ 確認顯示隔日解鎖日
- [ ] 用無痕視窗開公開看板 → 確認**看不到**任何姓名
- [ ] 測試完把測試資料刪掉（Console → Firestore 逐筆刪除）

---

## 7. 費用試算

以 1,000 名學生、每日 10 件違規估算：

| 項目 | 月用量 | 免費額度 | 費用 |
|---|---|---|---|
| Firestore 讀取 | < 20 萬次 | 5 萬次/日 | 0 |
| Firestore 寫入 | < 1 萬次 | 2 萬次/日 | 0 |
| Cloud Functions 呼叫 | < 5 千次 | 200 萬次/月 | 0 |
| Cloud Storage（函式映像檔） | 極小 | 5 GB | 0 |
| GitHub Pages | — | 免費 | 0 |

實務上幾乎都落在免費額度內。仍建議在 Google Cloud 設定**預算警示**：
Cloud Console → 帳單 → 預算與快訊 → 建立預算（例如 NT$100）。

---

## 8. 疑難排解

| 症狀 | 原因與解法 |
|---|---|
| 首頁顯示 README 而不是系統 | Pages Source 不是「GitHub Actions」→ 見 §3-2；改完後強制重新整理（Ctrl/Cmd+Shift+R） |
| 登入跳錯 `auth/unauthorized-domain` | 網域沒加入授權清單 → §3-4 |
| 登入後一直顯示「尚未授權」 | `ADMIN_EMAILS` 與登入信箱不符，或改了 `.env` 沒重新部署 → §2-3、§2-4 |
| 部署失敗 `Your project must be on the Blaze plan` | 尚未升級方案 → §1-2 |
| 部署失敗 `HTTP Error: 403, Permission denied` | CLI 登入的帳號不是該專案的擁有者 → `firebase logout` 後重登正確帳號 |
| 畫面一直轉圈、Console 顯示 `The query requires an index` | 索引尚未啟用 → 等 1–2 分鐘，或到 Firestore → 索引 分頁確認 |
| 登入後看得到畫面但資料是假的 | GitHub Secrets 沒設好，前端退回示範模式 → §3-1，設定後重新部署 |
| 想先不花錢試整套 | 用模擬器：`npm run emulators`，另開終端機跑 `FIRESTORE_EMULATOR_HOST=localhost:8080 GCLOUD_PROJECT=demo npm run seed:demo` |

---

## 9. 之後的維護

| 情境 | 做法 |
|---|---|
| 換生教組長 | 帳號管理 → 舊的「取消授權」、新的用信箱授權 |
| 調整校規參數 | 系統設定頁直接改（不需重新部署） |
| 新增管理者 | 改 `functions/.env` 的 `ADMIN_EMAILS` → `npm run deploy:backend`；或由現任管理者在帳號管理頁指派「系統管理者」角色 |
| 新學年 | 更新 `classes`、`students`、`schoolCalendar`；歷史紀錄保留不動 |
| 程式更新 | `git pull` → `npm ci` → `npm run deploy:backend`（前端推到 GitHub 後自動部署） |
| 備份 | `gcloud firestore export gs://<bucket>/backup-$(date +%F)`，建議排程每日 |
