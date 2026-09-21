/**
 * 名冊索引（省讀取次數的關鍵）
 *
 * 搜尋學生若逐份讀 `students`，一所 1000 人的學校每次載入就是 1000 次讀取。
 * 因此把「搜尋需要的欄位」壓成少數幾份聚合文件：
 *
 *   rosterIndex/chunk_0 … chunk_n   每份最多 500 人的精簡陣列
 *
 * 讀取量從 O(學生數) 降為 O(分片數)（1000 人 → 2 次讀取）。
 * 只在匯入名冊時重寫，平時完全不動，因此不會有寫入熱點。
 *
 * 索引**不含**再犯次數：那個數字每次登錄都會變，放進來就得跟著改寫。
 * 選定學生後再讀他那一份文件即可（1 次讀取），既即時又便宜。
 */
import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  serverTimestamp,
  writeBatch,
} from "firebase/firestore";
import { COL } from "../firestore/paths.js";
import type { Ctx } from "./context.js";
import type { StudentIndexEntry } from "../domain/studentSearch.js";

/** 每份文件的人數上限（Firestore 單一文件 1 MiB；500 人約 30 KB，留大量餘裕） */
export const CHUNK_SIZE = 500;

export type RosterIndexRow = Omit<StudentIndexEntry, "window">;

const chunkId = (index: number): string => `chunk_${index}`;

/** 重寫整份索引（匯入名冊後呼叫） */
export async function writeRosterIndex(
  ctx: Ctx,
  rows: RosterIndexRow[],
): Promise<number> {
  const chunks: RosterIndexRow[][] = [];
  for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
    chunks.push(rows.slice(i, i + CHUNK_SIZE));
  }
  if (chunks.length === 0) chunks.push([]);

  const existing = await getDocs(collection(ctx.db, COL.rosterIndex));
  const batch = writeBatch(ctx.db);
  chunks.forEach((students, index) => {
    batch.set(doc(ctx.db, COL.rosterIndex, chunkId(index)), {
      students,
      count: students.length,
      updatedAt: serverTimestamp(),
    });
  });
  await batch.commit();

  // 人數變少時清掉多出來的舊分片，避免搜尋到已被覆蓋的殘留資料
  const keep = new Set(chunks.map((_, index) => chunkId(index)));
  await Promise.all(
    existing.docs
      .filter((d) => !keep.has(d.id))
      .map((d) => deleteDoc(doc(ctx.db, COL.rosterIndex, d.id))),
  );

  return chunks.length;
}

/** 讀取索引；回傳 null 代表尚未建立（呼叫端可退回逐份讀取） */
export async function readRosterIndex(
  ctx: Pick<Ctx, "db">,
): Promise<RosterIndexRow[] | null> {
  const snap = await getDocs(collection(ctx.db, COL.rosterIndex));
  if (snap.empty) return null;
  return snap.docs
    .sort((a, b) => a.id.localeCompare(b.id))
    .flatMap((d) => (d.get("students") as RosterIndexRow[] | undefined) ?? []);
}
