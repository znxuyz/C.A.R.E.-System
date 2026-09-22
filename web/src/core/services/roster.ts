/**
 * 基本資料建置（違規類型／地點／學生名冊）
 *
 * 免費方案沒有後端匯入工具，這裡以用戶端批次寫入取代：
 *  - `seedBaseData()`：把內建的違規類型與地點寫入 Firestore（可重複執行）
 *  - `importStudents()`：貼上 CSV 名冊即可建立／更新學生與班級
 *
 * 去重策略：文件 ID 採自然鍵（`stu_{學號}`、`cls_{班級}`），
 * 因此同一份名冊重複匯入只會覆寫既有欄位，不會產生重複學生。
 * 學生既有的 `recidivismWindow`（再犯計次快取）以 merge 保留，不會被匯入清空。
 */
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  setDoc,
  writeBatch,
} from "firebase/firestore";
import { COL } from "../firestore/paths.js";
import {
  DEFAULT_INFRACTION_TYPES,
  DEFAULT_LOCATIONS,
} from "../domain/defaults.js";
import { auditDoc, type Ctx } from "./context.js";
import type { PaperCard } from "../domain/types.js";
import { writeRosterIndex } from "./rosterIndex.js";

/** Firestore 單次批次上限 500 筆；留一點餘裕 */
const BATCH_LIMIT = 400;

export interface RosterRow {
  className: string;
  seatNo: number | null;
  studentNo: string;
  name: string;
}

/** 文件 ID 不得含 `/`，其餘字元（含中文）皆可 */
const safeId = (value: string): string => value.trim().replace(/[/\s]+/g, "_");

export const studentDocId = (studentNo: string): string =>
  `stu_${safeId(studentNo)}`;
export const classDocId = (className: string): string =>
  `cls_${safeId(className)}`;

/** 名冊欄位的常見標題寫法（校務系統匯出的 Excel 標題不盡相同） */
const HEADER_ALIASES: Record<keyof RosterRow, string[]> = {
  className: ["班級", "班別", "班級名稱", "class"],
  seatNo: ["座號", "座位號碼", "seat"],
  studentNo: ["學號", "學生證號", "學籍號碼", "studentno", "id"],
  name: ["姓名", "學生姓名", "名字", "name"],
};

const DEFAULT_ORDER: Array<keyof RosterRow> = [
  "className",
  "seatNo",
  "studentNo",
  "name",
];

const normalizeHeader = (cell: string): string =>
  cell.trim().toLowerCase().replace(/\s+/g, "");

/**
 * 從標題列推出欄位位置。
 * 找不到標題列時回傳 null，由呼叫端退回「班級,座號,學號,姓名」的固定順序。
 */
function detectColumns(
  cells: string[],
): Record<keyof RosterRow, number> | null {
  const normalized = cells.map(normalizeHeader);
  const found = {} as Record<keyof RosterRow, number>;
  let hits = 0;
  (Object.keys(HEADER_ALIASES) as Array<keyof RosterRow>).forEach((field) => {
    const index = normalized.findIndex((cell) =>
      HEADER_ALIASES[field].some(
        (alias) => cell === alias || cell.includes(alias),
      ),
    );
    found[field] = index;
    if (index >= 0) hits += 1;
  });
  // 至少要認得學號與姓名，才算是標題列
  if (found.studentNo < 0 || found.name < 0 || hits < 3) return null;
  return found;
}

/**
 * 解析名冊表格（貼上的文字與 Excel 走同一條路）。
 *
 * - 有標題列：依標題對應欄位，欄位順序可任意（校務系統匯出格式不一）
 * - 無標題列：沿用 班級, 座號, 學號, 姓名 的固定順序
 * - 逐列回報錯誤，讓使用者知道是第幾列有問題，而不是整份失敗
 */
export function parseRosterRows(table: string[][]): {
  rows: RosterRow[];
  errors: string[];
} {
  const rows: RosterRow[] = [];
  const errors: string[] = [];
  const seen = new Set<string>();

  let columns: Record<keyof RosterRow, number> | null = null;
  let headerRow = -1;
  for (let i = 0; i < Math.min(table.length, 5); i += 1) {
    const detected = detectColumns(table[i] ?? []);
    if (detected) {
      columns = detected;
      headerRow = i;
      break;
    }
  }

  table.forEach((cells, index) => {
    if (index <= headerRow) return;
    const trimmed = cells.map((cell) => (cell ?? "").trim());
    if (trimmed.every((cell) => cell === "")) return;

    const pick = (field: keyof RosterRow): string => {
      const position = columns ? columns[field] : DEFAULT_ORDER.indexOf(field);
      return position >= 0 ? (trimmed[position] ?? "") : "";
    };

    if (!columns && trimmed.length < 4) {
      errors.push(`第 ${index + 1} 列：欄位不足（需 班級,座號,學號,姓名）`);
      return;
    }
    const className = pick("className");
    const studentNo = pick("studentNo");
    const name = pick("name");
    const seat = pick("seatNo");

    if (!className || !studentNo || !name) {
      errors.push(`第 ${index + 1} 列：班級／學號／姓名不可空白`);
      return;
    }
    if (seen.has(studentNo)) {
      errors.push(`第 ${index + 1} 列：學號 ${studentNo} 重複`);
      return;
    }
    seen.add(studentNo);

    const seatNo = seat === "" ? null : Number(seat);
    if (seatNo !== null && !Number.isInteger(seatNo)) {
      errors.push(`第 ${index + 1} 列：座號「${seat}」不是整數`);
      return;
    }
    rows.push({ className, seatNo, studentNo, name });
  });

  return { rows, errors };
}

/** 解析貼上的名冊文字（逗號或 Tab 分隔） */
export function parseRoster(text: string): {
  rows: RosterRow[];
  errors: string[];
} {
  const table = text.split(/\r?\n/).map((line) => line.split(/[,\t]/));
  return parseRosterRows(table);
}

/** 寫入內建違規類型與地點（已存在者覆寫，不影響既有違規紀錄） */
export async function seedBaseData(
  ctx: Ctx,
): Promise<{ types: number; locations: number }> {
  const batch = writeBatch(ctx.db);
  DEFAULT_INFRACTION_TYPES.forEach((type) => {
    const { code, ...rest } = type;
    batch.set(doc(ctx.db, COL.infractionTypes, code), rest, { merge: true });
  });
  DEFAULT_LOCATIONS.forEach((location) => {
    const { code, ...rest } = location;
    batch.set(doc(ctx.db, COL.locations, code), rest, { merge: true });
  });
  await batch.commit();

  await addDoc(
    collection(ctx.db, COL.auditLogs),
    auditDoc(ctx, {
      action: "SEED_BASE_DATA",
      entityType: "settings",
      entityId: "baseData",
      after: {
        types: DEFAULT_INFRACTION_TYPES.length,
        locations: DEFAULT_LOCATIONS.length,
      },
    }),
  );

  return {
    types: DEFAULT_INFRACTION_TYPES.length,
    locations: DEFAULT_LOCATIONS.length,
  };
}

/**
 * 匯入學生名冊（同時建立班級）。
 * 以 merge 寫入：既有學生的再犯計次快取與其他欄位不會被清掉。
 */
/** 目前名冊中的一位學生（比對用的最小欄位） */
export interface ExistingStudent {
  id: string;
  studentNo: string;
  name: string;
  className: string;
  seatNo: number | null;
  active: boolean;
}

export interface RosterDiff {
  /** 檔案中有、系統沒有 → 新生／轉入 */
  created: RosterRow[];
  /** 兩邊都有且班級或座號有變 → 重新編班 */
  reclassed: Array<{ row: RosterRow; before: ExistingStudent }>;
  /** 兩邊都有且資料相同 */
  unchanged: RosterRow[];
  /** 系統有、檔案沒有 → 畢業／轉出（完整名冊模式才會停用） */
  missing: ExistingStudent[];
  /** 已停用但出現在檔案中 → 重新啟用 */
  reactivated: RosterRow[];
}

/**
 * 比對「檔案名冊」與「系統現有名冊」。
 *
 * 每學年重新編班時，同一位學生的學號不變、班級與座號會變，
 * 因此一律以**學號**為鍵：
 *  - 學號在檔案中、不在系統 → 新生或轉入
 *  - 兩邊都有但班級／座號不同 → 重新編班（更新即可，歷程全部留著）
 *  - 學號在系統、不在檔案 → 畢業或轉出
 */
export function diffRoster(
  existing: ExistingStudent[],
  rows: RosterRow[],
): RosterDiff {
  const byStudentNo = new Map(
    existing.map((student) => [student.studentNo, student]),
  );
  const diff: RosterDiff = {
    created: [],
    reclassed: [],
    unchanged: [],
    missing: [],
    reactivated: [],
  };

  rows.forEach((row) => {
    const before = byStudentNo.get(row.studentNo);
    if (!before) {
      diff.created.push(row);
      return;
    }
    byStudentNo.delete(row.studentNo);
    if (!before.active) diff.reactivated.push(row);
    if (
      before.className !== row.className ||
      before.seatNo !== row.seatNo ||
      before.name !== row.name
    ) {
      diff.reclassed.push({ row, before });
    } else if (before.active) {
      diff.unchanged.push(row);
    }
  });

  diff.missing = [...byStudentNo.values()].filter((student) => student.active);
  return diff;
}

export interface ImportOptions {
  /**
   * 完整名冊模式：把「系統有、檔案沒有」的學生標記為停用（畢業／轉出）。
   * 停用不是刪除 —— 違規歷程、再犯紀錄全部保留，只是不再出現在登錄與查詢的預設清單。
   */
  deactivateMissing?: boolean;
  /** 現有名冊（完整名冊模式必填，用來算出要停用哪些人） */
  existing?: ExistingStudent[];
}

export async function importStudents(
  ctx: Ctx,
  rows: RosterRow[],
  options: ImportOptions = {},
): Promise<{
  students: number;
  classes: number;
  created: number;
  reclassed: number;
  deactivated: number;
  /** 學生資料已寫入，但搜尋索引未建立（通常是安全規則未更新） */
  indexWritten: boolean;
  indexError?: string;
}> {
  if (rows.length === 0) throw new Error("沒有可匯入的資料");

  const diff = diffRoster(options.existing ?? [], rows);
  const toDeactivate = options.deactivateMissing ? diff.missing : [];
  const classNames = [...new Set(rows.map((row) => row.className))].sort();
  let batch = writeBatch(ctx.db);
  let queued = 0;
  const commits: Array<Promise<void>> = [];

  const enqueue = (write: (b: ReturnType<typeof writeBatch>) => void) => {
    write(batch);
    queued += 1;
    if (queued >= BATCH_LIMIT) {
      commits.push(batch.commit());
      batch = writeBatch(ctx.db);
      queued = 0;
    }
  };
  classNames.forEach((className, index) => {
    enqueue((b) =>
      b.set(
        doc(ctx.db, COL.classes, classDocId(className)),
        { name: className, order: index + 1 },
        { merge: true },
      ),
    );
  });

  rows.forEach((row) => {
    enqueue((b) =>
      b.set(
        doc(ctx.db, COL.students, studentDocId(row.studentNo)),
        {
          studentNo: row.studentNo,
          name: row.name,
          className: row.className,
          classId: classDocId(row.className),
          seatNo: row.seatNo,
          active: true,
          // 回來的學生（休學復學、轉出又轉回）沿用原本的學號與歷程
          leftOn: null,
        },
        { merge: true },
      ),
    );
  });

  toDeactivate.forEach((student) => {
    enqueue((b) =>
      b.set(
        doc(ctx.db, COL.students, student.id),
        { active: false, leftOn: ctx.clock.today() },
        { merge: true },
      ),
    );
  });

  if (queued > 0) commits.push(batch.commit());
  await Promise.all(commits);

  // 重建搜尋索引：把匯入後的完整名冊壓成少數幾份聚合文件，
  // 之後搜尋只要讀那幾份，不必逐份讀 students
  const deactivated = new Set(toDeactivate.map((student) => student.id));
  const byId = new Map(
    (options.existing ?? []).map((student) => [
      student.id,
      {
        id: student.id,
        studentNo: student.studentNo,
        name: student.name,
        className: student.className,
        seatNo: student.seatNo,
        active: student.active && !deactivated.has(student.id),
      },
    ]),
  );
  rows.forEach((row) => {
    const id = studentDocId(row.studentNo);
    byId.set(id, {
      id,
      studentNo: row.studentNo,
      name: row.name,
      className: row.className,
      seatNo: row.seatNo,
      active: true,
    });
  });
  // 索引只是搜尋用的加速結構：學生資料已經寫入，索引失敗不該讓整批匯入變成失敗。
  // 常見原因是安全規則還沒發布 rosterIndex 那一段。
  let indexWritten = true;
  let indexError: string | undefined;
  try {
    await writeRosterIndex(ctx, [...byId.values()]);
  } catch (error) {
    indexWritten = false;
    indexError = error instanceof Error ? error.message : String(error);
  }

  const summary = {
    students: rows.length,
    classes: classNames.length,
    created: diff.created.length,
    reclassed: diff.reclassed.length,
    deactivated: toDeactivate.length,
    indexWritten,
    ...(indexError ? { indexError } : {}),
  };

  await addDoc(
    collection(ctx.db, COL.auditLogs),
    auditDoc(ctx, {
      action: options.deactivateMissing ? "REPLACE_ROSTER" : "IMPORT_STUDENTS",
      entityType: "students",
      entityId: "roster",
      after: summary,
    }),
  );

  return summary;
}

/* --------------------------- 地點維護（管理者） --------------------------- */

export const locationDocId = (name: string): string => `loc_${safeId(name)}`;

/**
 * 新增（或更新）地點。
 * 文件 ID 由名稱推得，重複新增同名地點只會覆寫，不會產生兩張一樣的圖卡。
 */
export async function upsertLocation(
  ctx: Ctx,
  input: { name: string; isHotspot: boolean; code?: string },
): Promise<{ code: string; name: string; isHotspot: boolean }> {
  const name = input.name.trim();
  if (!name) throw new Error("請輸入地點名稱");
  if (name.length > 20) throw new Error("地點名稱請控制在 20 字以內");

  const code = input.code ?? locationDocId(name);
  await setDoc(
    doc(ctx.db, COL.locations, code),
    { name, isHotspot: input.isHotspot },
    { merge: true },
  );
  await addDoc(
    collection(ctx.db, COL.auditLogs),
    auditDoc(ctx, {
      action: input.code ? "UPDATE_LOCATION" : "CREATE_LOCATION",
      entityType: "location",
      entityId: code,
      after: { name, isHotspot: input.isHotspot },
    }),
  );
  return { code, name, isHotspot: input.isHotspot };
}

/**
 * 刪除地點。
 * 既有違規紀錄已存下當時的 `locationName`，因此刪除不影響歷史資料，
 * 只是之後登錄時不再出現這個選項。
 */
export async function removeLocation(ctx: Ctx, code: string): Promise<void> {
  await deleteDoc(doc(ctx.db, COL.locations, code));
  await addDoc(
    collection(ctx.db, COL.auditLogs),
    auditDoc(ctx, {
      action: "DELETE_LOCATION",
      entityType: "location",
      entityId: code,
    }),
  );
}

/* ------------------------- 違規類型維護（管理者） ------------------------- */

export const infractionTypeDocId = (name: string): string =>
  `type_${safeId(name)}`;

export interface InfractionTypeInput {
  /** 既有類型才有；新增時由名稱推得 */
  code?: string;
  name: string;
  /** 紙本卡名稱，可自訂（例：校園安全反思卡、愛整潔反思卡） */
  paperCardLabel: string;
  /** 統計分類：儀表板趨勢圖以此分色 */
  paperCard: PaperCard;
  /** 是否計入再犯次數（勸導性質的類型可關掉） */
  countsTowardRecidivism: boolean;
  icon?: string;
  order?: number;
}

/**
 * 新增或更新違規類型。
 *
 * 既有的違規事件已存下當時的 `typeName` 與 `paperCardLabel`，
 * 因此改名或改卡名都不會動到歷史紀錄。
 */
export async function upsertInfractionType(
  ctx: Ctx,
  input: InfractionTypeInput,
): Promise<{ code: string }> {
  const name = input.name.trim();
  const label = input.paperCardLabel.trim();
  if (!name) throw new Error("請輸入違規類型名稱");
  if (!label) throw new Error("請輸入反思卡名稱");
  if (name.length > 20) throw new Error("類型名稱請控制在 20 字以內");
  if (label.length > 20) throw new Error("反思卡名稱請控制在 20 字以內");

  const code = input.code ?? infractionTypeDocId(name);
  await setDoc(
    doc(ctx.db, COL.infractionTypes, code),
    {
      name,
      paperCardLabel: label,
      paperCard: input.paperCard,
      countsTowardRecidivism: input.countsTowardRecidivism,
      icon: input.icon?.trim() || "📋",
      order: input.order ?? 99,
    },
    { merge: true },
  );

  await addDoc(
    collection(ctx.db, COL.auditLogs),
    auditDoc(ctx, {
      action: input.code ? "UPDATE_INFRACTION_TYPE" : "CREATE_INFRACTION_TYPE",
      entityType: "infractionType",
      entityId: code,
      after: { name, paperCardLabel: label, paperCard: input.paperCard },
    }),
  );
  return { code };
}

/**
 * 刪除違規類型。
 * 既有違規事件不受影響（已存下當時的類型與卡名），只是之後不再能選這一類。
 */
export async function removeInfractionType(
  ctx: Ctx,
  code: string,
): Promise<void> {
  await deleteDoc(doc(ctx.db, COL.infractionTypes, code));
  await addDoc(
    collection(ctx.db, COL.auditLogs),
    auditDoc(ctx, {
      action: "DELETE_INFRACTION_TYPE",
      entityType: "infractionType",
      entityId: code,
    }),
  );
}
