/**
 * 名冊檔案讀取（Excel / CSV）
 *
 * 一律轉成「字串表格」再交給 `parseRosterRows()`，
 * 因此貼上文字與上傳檔案共用同一套欄位比對與錯誤回報。
 *
 * 兩個實務上的坑：
 *  - Excel 解析器（read-excel-file）體積不小，改用動態 import，
 *    只有真的上傳 .xlsx 時才下載那塊程式碼。
 *  - Windows 版 Excel 另存 CSV 預設是 Big5（非 UTF-8），
 *    直接以 UTF-8 解碼會整片變亂碼，因此先試 UTF-8、偵測到替代字元再退回 Big5。
 */

export interface RosterFileResult {
  table: string[][];
  /** 回報給使用者的來源說明，例如「Excel：七年級.xlsx（工作表 1）」 */
  source: string;
}

const EXCEL_EXTENSIONS = /\.(xlsx|xlsm|xltx)$/i;
const LEGACY_EXCEL = /\.xls$/i;

/** 是否出現 U+FFFD（解碼失敗的替代字元） */
const looksMojibake = (text: string): boolean => text.includes("�");

function decodeText(buffer: ArrayBuffer): string {
  const utf8 = new TextDecoder("utf-8").decode(buffer);
  if (!looksMojibake(utf8)) return utf8.replace(/^﻿/, "");
  // 台灣的校務系統與 Excel 多半輸出 Big5
  try {
    const big5 = new TextDecoder("big5").decode(buffer);
    if (!looksMojibake(big5)) return big5;
  } catch {
    /* 瀏覽器不支援 big5 時沿用 UTF-8 結果 */
  }
  return utf8.replace(/^﻿/, "");
}

/** CSV 逐字解析（支援以雙引號包住、內含逗號或換行的欄位） */
export function parseCsv(text: string): string[][] {
  const table: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        cell += char;
      }
      continue;
    }
    if (char === '"') {
      quoted = true;
    } else if (char === "," || char === "\t") {
      row.push(cell);
      cell = "";
    } else if (char === "\n") {
      row.push(cell);
      table.push(row);
      row = [];
      cell = "";
    } else if (char !== "\r") {
      cell += char;
    }
  }
  row.push(cell);
  table.push(row);
  return table;
}

export async function readRosterFile(file: File): Promise<RosterFileResult> {
  if (LEGACY_EXCEL.test(file.name)) {
    throw new Error("不支援舊版 .xls，請用 Excel 另存為 .xlsx 或 CSV 後再上傳");
  }

  if (EXCEL_EXTENSIONS.test(file.name)) {
    const { default: readXlsxFile } = await import("read-excel-file/browser");
    const sheets = await readXlsxFile(file);
    // 取第一個有資料的工作表（校務系統常在後面附空白表）
    const sheet = sheets.find((item) =>
      item.data.some((row) => row.some((cell) => cell !== null)),
    );
    if (!sheet) throw new Error("這個 Excel 檔沒有可讀取的資料");
    const table = sheet.data.map((row) =>
      row.map((cell) =>
        cell === null || cell === undefined ? "" : String(cell).trim(),
      ),
    );
    return { table, source: `Excel：${file.name}（工作表「${sheet.sheet}」）` };
  }

  const buffer = await file.arrayBuffer();
  return { table: parseCsv(decodeText(buffer)), source: `CSV：${file.name}` };
}
