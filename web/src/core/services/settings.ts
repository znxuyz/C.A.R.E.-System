/** 系統設定讀寫（15 天 / 3 次 / 5 節等，管理者可於後台調整） */
import { addDoc, collection, doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore';
import { COL, SETTINGS_DOC } from '../firestore/paths.js';
import { DEFAULT_SETTINGS, type SystemSettings } from '../domain/types.js';
import { auditDoc, type Ctx } from './context.js';

export async function loadSettings(db: Ctx['db']): Promise<SystemSettings> {
  const snap = await getDoc(doc(db, COL.settings, SETTINGS_DOC));
  if (!snap.exists()) return DEFAULT_SETTINGS;
  const data = snap.data() as Partial<SystemSettings>;
  return {
    ...DEFAULT_SETTINGS,
    ...data,
    publicBoard: { ...DEFAULT_SETTINGS.publicBoard, ...(data.publicBoard ?? {}) },
  };
}

const intInRange = (value: unknown, min: number, max: number, label: string): number => {
  const num = Number(value);
  if (!Number.isInteger(num) || num < min || num > max) {
    throw new Error(`${label} 須為 ${min}–${max} 的整數`);
  }
  return num;
};

/**
 * 更新設定（僅管理者；安全規則亦會驗證範圍）。
 * 已發出的警示會留存觸發當時的參數快照，故調整不影響既有案件的可追溯性。
 */
export async function updateSettings(
  ctx: Ctx,
  patch: Partial<SystemSettings>,
): Promise<SystemSettings> {
  const before = await loadSettings(ctx.db);
  const next: SystemSettings = { ...before };

  if (patch.recidivismWindowDays !== undefined) {
    next.recidivismWindowDays = intInRange(patch.recidivismWindowDays, 1, 90, '回溯天數');
  }
  if (patch.recidivismThreshold !== undefined) {
    next.recidivismThreshold = intInRange(patch.recidivismThreshold, 1, 20, '觸發次數');
  }
  if (patch.observerPeriodNumbers !== undefined) {
    const periods = [...new Set(patch.observerPeriodNumbers.map((p) => intInRange(p, 1, 12, '值勤節次')))].sort(
      (a, b) => a - b,
    );
    if (periods.length === 0) throw new Error('請至少選擇一節值勤節次');
    next.observerPeriodNumbers = periods;
    next.observerPeriods = periods.length;
  }
  if (typeof patch.carryOverUnfinished === 'boolean') {
    next.carryOverUnfinished = patch.carryOverUnfinished;
  }
  if (patch.publicBoard) {
    next.publicBoard = {
      enabled: Boolean(patch.publicBoard.enabled),
      showRoster: Boolean(patch.publicBoard.showRoster),
    };
  }

  await setDoc(doc(ctx.db, COL.settings, SETTINGS_DOC), { ...next, updatedAt: serverTimestamp() });
  await addDoc(
    collection(ctx.db, COL.auditLogs),
    auditDoc(ctx, {
      action: 'SETTINGS_UPDATED',
      entityType: COL.settings,
      entityId: SETTINGS_DOC,
      before,
      after: next,
    }),
  );
  return next;
}
