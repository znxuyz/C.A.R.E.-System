# Firebase 設定手冊（照著做即可）

**完全使用 Firebase 免費方案（Spark），不需要信用卡。**
第一次導入從頭到尾約 **20 分鐘**，只需要瀏覽器 + 終端機。

> 為什麼不需要付費方案：本系統**不使用 Cloud Functions**（那才需要 Blaze）。
> 所有邏輯在前端執行，以 Firestore 交易保證原子性，
> 由**安全規則**驗證權限與每一筆寫入的形狀（規則有 27 項自動化測試把關）。

---

## 0. 事前準備

| 項目 | 說明 |
|---|---|
| Google 帳號 | 建議用學校的 Google Workspace 帳號建立專案 |
| Node.js 20 以上 | https://nodejs.org 下載 LTS 版 |
| 專案原始碼 | `git clone https://github.com/znxuyz/C.A.R.E.-System.git` |

只是想先看畫面？`npm ci && npm run dev:web` 就會以「示範模式」執行（模擬資料，可完整操作），完全不碰 Firebase。

---

## 1. Firebase Console 設定（瀏覽器，約 10 分鐘）

### 1-1. 建立專案

1. 開啟 https://console.firebase.google.com
2. **「建立專案」（Create a project）**
3. 專案名稱輸入 `care-system`（或校名縮寫）→ 繼續
4. Google Analytics：**可以關閉**（本系統用不到）→ 建立專案
5. 等待約 30 秒 → 繼續

> 方案維持預設的 **Spark（免費）** 即可，**不要升級**。

### 1-2. 啟用 Google 登入

1. 左側 **建構（Build）→ Authentication（驗證）** → **開始使用**
2. **Sign-in method（登入方式）** 分頁 → 點 **Google** → 右上角開關 **啟用**
3. 「專案的公開名稱」填 `C.A.R.E. System`；「專案支援電子郵件」選你的信箱
4. **儲存**

### 1-3. 建立 Firestore 資料庫

1. 左側 **建構 → Firestore Database** → **建立資料庫**
2. 位置（Location）選 **`asia-east1`（台灣）**
   > ⚠️ **位置建立後不能更改**，確認後再繼續。
3. 規則模式選 **「以正式版模式啟動」**（稍後會用指令部署本專案的規則覆蓋它）
4. **建立**

### 1-4. 新增網頁應用程式並複製設定

1. 回 **專案總覽** → 點 **`</>`（網頁）** 圖示
2. 暱稱填 `care-web`，**不要勾** Firebase Hosting（我們用 GitHub Pages）→ 註冊應用程式
3. 畫面顯示的 `firebaseConfig` 六個值**複製下來**（§3 要用）：

```js
const firebaseConfig = {
  apiKey: "AIza...",
  authDomain: "care-system-a1b2c.firebaseapp.com",
  projectId: "care-system-a1b2c",
  storageBucket: "care-system-a1b2c.firebasestorage.app",
  messagingSenderId: "123456789012",
  appId: "1:123456789012:web:abcdef1234567890"
};
```

> 這些值屬**公開識別資訊**，被看到不等於資料外洩 ——
> 真正的防線是 Firestore 安全規則（本專案已寫好並有測試）。

---

## 2. 部署安全規則與索引（終端機，約 5 分鐘）

```bash
npm install -g firebase-tools
firebase login                 # 瀏覽器會跳出 Google 授權

git clone https://github.com/znxuyz/C.A.R.E.-System.git
cd C.A.R.E.-System
npm ci

firebase use --add             # 選剛建立的專案，別名輸入 default
npm run deploy:rules           # 部署 firestore.rules 與複合索引
```

**確認索引已建立**：Console → Firestore Database → **索引（Indexes）** 分頁，
應有數筆複合索引，狀態逐一變成 **「已啟用」**（約 1–2 分鐘）。

> 沒有 Cloud Functions 要部署，所以這一步很快，也不會有任何計費項目。

---

## 3. 部署前端到 GitHub Pages（約 5 分鐘）

### 3-1. 設定 Secrets

GitHub repository → **Settings → Secrets and variables → Actions → New repository secret**，
逐一新增（值就是 §1-4 複製的六個）：

| Secret 名稱 | 對應 firebaseConfig 欄位 |
|---|---|
| `VITE_FIREBASE_API_KEY` | `apiKey` |
| `VITE_FIREBASE_AUTH_DOMAIN` | `authDomain` |
| `VITE_FIREBASE_PROJECT_ID` | `projectId` |
| `VITE_FIREBASE_STORAGE_BUCKET` | `storageBucket` |
| `VITE_FIREBASE_MESSAGING_SENDER_ID` | `messagingSenderId` |
| `VITE_FIREBASE_APP_ID` | `appId` |

（選填）只想讓學校網域登入 → 再加 `VITE_GOOGLE_HD` = `example.edu.tw`。

### 3-2. 確認 Pages 來源

**Settings → Pages → Build and deployment → Source** 必須是 **「GitHub Actions」**。
若是「Deploy from a branch」，首頁會變成 README 而不是系統畫面。

### 3-3. 觸發部署

推一個 commit，或 **Actions → Deploy web to GitHub Pages → Run workflow**。
完成後網址：`https://<你的帳號>.github.io/C.A.R.E.-System/`

### 3-4. 把網址加入授權網域（**忘了會無法登入**）

Console → **Authentication → 設定（Settings）→ 已授權網域** → **新增網域**
→ 輸入 `<你的帳號>.github.io` → 儲存。

---

## 4. 建立第一位管理者（授權鏈的起點）

系統的角色存在 Firestore 的 `staff/{uid}`，而誰能取得角色則由 `accessGrants/{信箱}` 決定。
第一筆授權必須由你手動建立，**兩種方式擇一**：

### 方式 A：在 Console 手動建立（最簡單，不需金鑰）

1. Console → **Firestore Database** → **開始集合（Start collection）**
2. 集合 ID 輸入 `accessGrants`
3. 文件 ID 輸入**你的 Google 信箱（全小寫）**，例如 `you@example.edu.tw`
4. 新增以下欄位：

| 欄位 | 型別 | 值 |
|---|---|---|
| `email` | string | you@example.edu.tw（與文件 ID 相同） |
| `roles` | array | 兩個 string 元素：`ADMIN`、`DISCIPLINE_STAFF` |
| `active` | boolean | true |

5. 儲存

### 方式 B：用指令匯入（順便建立違規類型與地點）

需要一把服務帳戶金鑰：Console → ⚙️ **專案設定 → 服務帳戶** →
**產生新的私密金鑰** → 下載後改名為 `serviceAccountKey.json` 放在專案根目錄
（此檔名已在 `.gitignore`）。

```bash
GOOGLE_APPLICATION_CREDENTIALS=./serviceAccountKey.json \
ADMIN_EMAILS="you@example.edu.tw" \
npm run seed
```

會一併匯入：系統參數（15 天 / 3 次 / 5 節）、兩種違規類型、七個校園地點、示範校曆。

> 用方式 A 的話，違規類型與地點也要自己建；建議至少用一次方式 B 比較省事。
> 想先用假資料跑流程：把 `npm run seed` 換成 `npm run seed:demo`。

---

## 5. 首次登入與授權同仁

1. 開啟 `https://<你的帳號>.github.io/C.A.R.E.-System/` → 先看到**公開看板**（免登入）
2. 右上角 **「生教組登入」** → **使用 Google 帳號登入** → 選 §4 設定的那個帳號
3. 登入後應直接進入儀表板，左側出現 **管理 → 帳號管理 / 系統設定**

   > 看到「尚未授權」：表示 `accessGrants` 那筆文件的**文件 ID 與登入信箱不一致**
   > （注意全小寫、前後不要有空白），或 `active` 不是 true。修正後按「重新檢查授權」。

4. **帳號管理** → 輸入生教組長的 Google 信箱 → 勾「生活教育組長」→ **授權**
   - 對方**不需事先註冊**，首次用 Google 登入時自動生效
5. **系統設定** → 確認 15 天 / 3 次 / 5 節與校規一致（可直接改）

---

## 6. 匯入學生名單

Console → Firestore Database → **開始集合**：

**`classes`**（文件 ID 例如 `cls_701`）

| 欄位 | 型別 | 範例 |
|---|---|---|
| `name` | string | 七年一班 |
| `homeroomTeacherName` | string | 陳怡君（選填） |

**`students`**（文件 ID 例如 `stu_701_01`）

| 欄位 | 型別 | 範例 |
|---|---|---|
| `studentNo` | string | 1140101 |
| `name` | string | 王小明 |
| `classId` | string | cls_701 |
| `className` | string | 七年一班 |
| `seatNo` | number | 1 |

> `recidivismWindow` 欄位不必建，系統第一次登錄違規時會自動寫入。

全校人數多時手動建很慢 —— 需要 CSV 批次匯入的話告訴我，可以加。

---

## 7. 驗收測試

- [ ] 登錄違規 → 「今日下課管制名單」出現該生
- [ ] 待回收紙本 → 按「已回收」→ 管制解除
- [ ] 連續登錄同一位學生 3 次 → 跳出再犯警示、產生安全觀察員派單
- [ ] 再登錄第 4 次 → **不會**重複觸發新警示
- [ ] 值勤台 5 節打卡 → 「檢討書已回收」→ 顯示隔日解鎖日
- [ ] 用無痕視窗開公開看板 → **看不到**任何姓名
- [ ] 測試完把測試資料刪掉

---

## 8. 費用

以 1,000 名學生、每日 10 件違規估算，**全部落在 Spark 免費額度內**：

| 項目 | 免費額度（每日） | 預估用量 |
|---|---|---|
| Firestore 讀取 | 50,000 | < 2,000 |
| Firestore 寫入 | 20,000 | < 300 |
| Firestore 儲存 | 1 GiB | < 10 MB |
| Authentication | 無限制（Google 登入） | — |
| GitHub Pages | 免費 | — |

> 安全規則每次判定會讀取一次 `staff` 文件（同一請求內會快取），
> 已計入上表估算。真的成長到超出免費額度時再升級即可，程式不需改動。

---

## 9. 疑難排解

| 症狀 | 原因與解法 |
|---|---|
| 首頁顯示 README | Pages Source 不是「GitHub Actions」→ §3-2；改完強制重新整理（Ctrl/Cmd+Shift+R） |
| 登入跳錯 `auth/unauthorized-domain` | 網域沒加入授權清單 → §3-4 |
| 一直顯示「尚未授權」 | `accessGrants` 文件 ID 與登入信箱不符（需全小寫）、或 `active` 不是 true → §4 |
| 操作時出現 `Missing or insufficient permissions` | 規則尚未部署 → `npm run deploy:rules`；或該帳號未被授權 |
| 畫面轉圈、Console 顯示 `The query requires an index` | 索引尚未啟用 → 等 1–2 分鐘或到 Firestore → 索引 確認 |
| 登入後資料是假的 | GitHub Secrets 沒設好，前端退回示範模式 → §3-1，設定後重新部署 |
| 想完全離線試跑 | `npm run emulators`，另開終端機 `FIRESTORE_EMULATOR_HOST=localhost:8080 GCLOUD_PROJECT=demo npm run seed:demo` |

---

## 10. 之後的維護

| 情境 | 做法 |
|---|---|
| 換生教組長 | 帳號管理 → 舊的「取消授權」、新的用信箱授權（**下一次請求即生效**） |
| 調整校規參數 | 系統設定頁直接改，不需重新部署 |
| 新增管理者 | 帳號管理頁指派「系統管理者」角色 |
| 新學年 | 更新 `classes`、`students`、`schoolCalendar`；歷史紀錄保留不動 |
| 程式更新 | `git pull` → `npm ci` → `npm run deploy:rules`（前端推上 GitHub 後自動部署） |
| 備份 | Console → Firestore → 匯入/匯出（需 Blaze）；免費方案可用 `npm run emulators` 搭配腳本自行匯出，或定期以服務帳戶金鑰跑匯出腳本 |
