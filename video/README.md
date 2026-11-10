# 介紹影片製作流程

以**真實操作畫面**（示範模式的模擬資料）產出一支系統功能介紹影片：
1080p／30fps、繁體中文字幕燒錄、自行合成的配樂，全程可重跑。

```
video/
├── lib.mjs        錄影共用工具（虛擬游標、平滑捲動、登入與導覽）
├── record.mjs     14 段實機操作的錄影腳本
├── cards.mjs      7 張標題卡（HTML 排版後截圖）
├── music.py       配樂合成（純 numpy，無外部素材與版權疑慮）
├── compose.py     時間軸、字幕與最終合成
└── README.md
```

## 重新產出

```bash
# 1. 先把示範模式的站台跑起來（模擬資料，不會寫入 Firebase）
cd web && VITE_USE_MOCK=true npx vite build --outDir dist-demo
npx vite preview --outDir dist-demo --port 4188

# 2. 錄影 → 標題卡 → 合成（在 video/ 目錄）
node record.mjs          # 可加場景名稱只重錄某幾段，例如 node record.mjs s04-log-first
node cards.mjs
python3 compose.py       # 產生 care-system-intro.mp4
```

需求：ffmpeg（含 libass）、Playwright 的 Chromium、Python 3 + numpy、
以及一套中文字型（本片使用 WenQuanYi Zen Hei）。

## 內容結構

| 段落 | 內容 |
|---|---|
| 片頭與問題 | 「他這是第幾次了？」—— 紙本照舊，難的是計次 |
| 每日作業 | 登入 → 儀表板 → 登錄（兩種找人方式）→ 第一次只記錄勸導 → 第二次發卡凍結 → 回收解除 → 管制名單 |
| 追蹤輔導 | 初犯名單 → 再犯警示與依據 → 安全觀察員值勤 → 學生歷程 |
| 設定與權限 | 參數可調、違規類型與反思卡自訂、Excel 名冊匯入、帳號授權、公開看板 |
| 收尾 | 架構與成本（免費方案、29 項安全規則測試）、正向管教的提醒 |

## 調整方式

- **字幕與分段**：改 `compose.py` 的 `TIMELINE`，每段是
  `(類型, 來源, 起, 迄, [(字幕起, 字幕迄, 文字)…])`，時間皆相對該段起點。
- **轉場**：`XFADE`（預設 0.5 秒）。
- **配樂**：`music.py` 的 `PROG`（和弦進行）與 `BPM`；長度由 `compose.py` 依成品自動帶入。
- **標題卡**：`cards.mjs` 的 `CARDS`，沿用系統本身的色票與字級。

> 影片內的學生姓名、班級與違規紀錄全部來自示範模式的模擬資料，
> 不是真實學生資料。
