/** 校曆載入（決定「隔日解鎖」是否順延假日） */
import { collection, getDocs, query, where } from 'firebase/firestore';
import type { Firestore } from 'firebase/firestore';
import { COL } from '../firestore/paths.js';
import { createSchoolCalendar, type SchoolCalendar } from '../domain/dates.js';
import type { SchoolDate } from '../domain/types.js';

export async function loadCalendar(
  db: Firestore,
  from: SchoolDate,
  to: SchoolDate,
): Promise<SchoolCalendar> {
  const snap = await getDocs(
    query(collection(db, COL.schoolCalendar), where('date', '>=', from), where('date', '<=', to)),
  );
  const overrides: Record<SchoolDate, boolean> = {};
  for (const docSnap of snap.docs) {
    const date = docSnap.get('date') as SchoolDate | undefined;
    const isSchoolDay = docSnap.get('isSchoolDay');
    if (date && typeof isSchoolDay === 'boolean') overrides[date] = isSchoolDay;
  }
  return createSchoolCalendar(overrides);
}
