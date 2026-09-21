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
import { addDoc, collection, doc, writeBatch } from "firebase/firestore";
import { COL } from "../firestore/paths.js";
import {
  DEFAULT_INFRACTION_TYPES,
  DEFAULT_LOCATIONS,
} from "../domain/defaults.js";
import { auditDoc, type Ctx } from "./context.js";

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

/**
 * 解析貼上的名冊文字。
 * 欄位順序：班級, 座號, 學號, 姓名（以逗號或 Tab 分隔；可含標題列）。
 * 逐行回報錯誤，讓使用者知道是第幾行有問題，而不是整份失敗。
 */
export function parseRoster(text: string): {
  rows: RosterRow[];
  errors: string[];
} {
  const rows: RosterRow[] = [];
  const errors: string[] = [];
  const seen = new Set<string>();

  text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .forEach((line, index) => {
      if (!line) return;
      const cells = line.split(/[,\t]/).map((cell) => cell.trim());
      // 標題列（第一行且含「學號」字樣）直接略過
      if (index === 0 && cells.some((cell) => cell.includes("學號"))) return;
      if (cells.length < 4) {
        errors.push(`第 ${index + 1} 行：欄位不足（需 班級,座號,學號,姓名）`);
        return;
      }
      const [className, seat, studentNo, name] = cells;
      if (!className || !studentNo || !name) {
        errors.push(`第 ${index + 1} 行：班級／學號／姓名不可空白`);
        return;
      }
      if (seen.has(studentNo)) {
        errors.push(`第 ${index + 1} 行：學號 ${studentNo} 重複`);
        return;
      }
      seen.add(studentNo);
      const seatNo = seat === "" ? null : Number(seat);
      if (seatNo !== null && !Number.isInteger(seatNo)) {
        errors.push(`第 ${index + 1} 行：座號「${seat}」不是整數`);
        return;
      }
      rows.push({ className, seatNo, studentNo, name });
    });

  return { rows, errors };
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
export async function importStudents(
  ctx: Ctx,
  rows: RosterRow[],
): Promise<{ students: number; classes: number }> {
  if (rows.length === 0) throw new Error("沒有可匯入的資料");

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
        },
        { merge: true },
      ),
    );
  });

  if (queued > 0) commits.push(batch.commit());
  await Promise.all(commits);

  await addDoc(
    collection(ctx.db, COL.auditLogs),
    auditDoc(ctx, {
      action: "IMPORT_STUDENTS",
      entityType: "students",
      entityId: "roster",
      after: { students: rows.length, classes: classNames.length },
    }),
  );

  return { students: rows.length, classes: classNames.length };
}
