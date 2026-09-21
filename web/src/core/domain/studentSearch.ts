/**
 * 學生搜尋（純函式，便於測試）
 *
 * Firestore 只能做前綴比對，且每次查詢都要付讀取費用，因此名冊是整份讀進
 * 記憶體後在前端比對。這裡只負責「怎麼比、怎麼排」，不碰任何 I/O。
 */
import type { SchoolDate } from './types.js';

export interface StudentIndexEntry {
  id: string;
  studentNo: string;
  name: string;
  className: string;
  seatNo: number | null;
  active: boolean;
  /** 再犯視窗內尚未認列的違規日期 */
  window: SchoolDate[];
}

export interface StudentSearchHit {
  id: string;
  studentNo: string;
  name: string;
  className: string;
  seatNo?: number;
  active: boolean;
  windowCount: number;
}

/**
 * 以學號、姓名或班級做**子字串**比對（打「小明」也找得到王小明）。
 *
 * 排序：學號完全相符 → 在校生 → 班級 → 座號。
 * 不截斷結果，截斷與否由畫面決定（先前寫死 8 筆會讓使用者誤以為只有 8 位）。
 */
export function matchStudents(
  index: StudentIndexEntry[],
  keyword: string,
  windowStart: SchoolDate,
): StudentSearchHit[] {
  const trimmed = keyword.trim();
  if (!trimmed) return [];
  const needle = trimmed.toLowerCase();

  return index
    .filter(
      (student) =>
        student.studentNo.toLowerCase().includes(needle) ||
        student.name.toLowerCase().includes(needle) ||
        student.className.includes(trimmed),
    )
    .map((student) => ({
      id: student.id,
      studentNo: student.studentNo,
      name: student.name,
      className: student.className,
      ...(student.seatNo === null ? {} : { seatNo: student.seatNo }),
      active: student.active,
      windowCount: student.window.filter((day) => day >= windowStart).length,
    }))
    .sort(
      (x, y) =>
        Number(y.studentNo === trimmed) - Number(x.studentNo === trimmed) ||
        Number(y.active) - Number(x.active) ||
        x.className.localeCompare(y.className, 'zh-Hant') ||
        (x.seatNo ?? 0) - (y.seatNo ?? 0),
    );
}
