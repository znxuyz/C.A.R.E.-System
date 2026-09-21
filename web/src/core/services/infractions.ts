/**
 * 違規登錄與紙本回收（前端執行，Firestore 交易保證原子性）
 *
 * 為何不用查詢而改用「學生文件上的再犯視窗快取」：
 *   Firestore **用戶端 SDK 的交易只能依文件參照讀取，不能在交易內下查詢**。
 *   因此把該生 15 天內尚未認列的違規摘要存在 `students/{id}.recidivismWindow`，
 *   交易只讀這一份文件即可完成「計數 → 判定 → 觸發」的原子操作，
 *   同時也讓儀表板的進度查詢從一次集合查詢降為一次文件讀取。
 *   `infractions` 仍是完整的事件帳本，快取只是計數用的投影。
 */
import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit as fsLimit,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  where,
} from "firebase/firestore";
import { COL, restrictionId } from "../firestore/paths.js";
import {
  addDays,
  nextSchoolDay,
  type SchoolCalendar,
} from "../domain/dates.js";
import {
  assertCanAnnotate,
  assertCanReturnPaper,
  unlockDateForPaperReturn,
} from "../domain/caseRules.js";
import {
  ASSIGNMENT_STATUS,
  INFRACTION_STATUS,
  PAPER_CARD_LABEL,
  RESTRICTION_REASONS,
  type PaperCard,
  type RecidivismWindowEntry,
  type SchoolDate,
  type SystemSettings,
} from "../domain/types.js";
import { auditDoc, type Ctx } from "./context.js";
import {
  mergeRestriction,
  liftRestriction,
  type RestrictionStudent,
} from "./restrictions.js";

export interface LogInfractionInput {
  student: RestrictionStudent;
  type: {
    code: string;
    name: string;
    paperCard: PaperCard;
    /** 該類型要發的紙本卡名稱（後台可自訂；未設定時採卡別的預設名稱） */
    paperCardLabel?: string;
    countsTowardRecidivism?: boolean;
  };
  location: { code: string; name: string };
  periodNo: number;
  occurredOn: SchoolDate;
  occurredAt: string;
  note?: string;
}

export interface LogInfractionResult {
  infractionId: string;
  paperCardLabel: string;
  recidivism: {
    triggered: boolean;
    count: number;
    threshold: number;
    shortfall: number;
    alertId?: string;
    assignmentId?: string;
    dutyOn?: SchoolDate;
  };
}

/** 保留在快取中的視窗紀錄（超出視窗者於每次寫入時順手清掉） */
function pruneWindow(
  entries: RecidivismWindowEntry[],
  windowStart: SchoolDate,
): RecidivismWindowEntry[] {
  return entries.filter((entry) => entry.occurredOn >= windowStart);
}

/** 自訂卡名優先；沒設定時退回卡別的預設名稱 */
const paperCardLabel = (type: {
  paperCard: PaperCard;
  paperCardLabel?: string;
}): string => type.paperCardLabel?.trim() || PAPER_CARD_LABEL[type.paperCard];

export async function logInfraction(
  ctx: Ctx,
  input: LogInfractionInput,
  settings: SystemSettings,
  calendar: SchoolCalendar,
): Promise<LogInfractionResult> {
  const { db, clock } = ctx;
  const today = clock.today();
  const windowStart = addDays(
    input.occurredOn,
    -(settings.recidivismWindowDays - 1),
  );
  const dutyOn = nextSchoolDay(today, calendar);
  const counts = input.type.countsTowardRecidivism !== false;

  const infractionRef = doc(collection(db, COL.infractions));
  const alertRef = doc(collection(db, COL.recidivismAlerts));
  const assignmentRef = doc(collection(db, COL.observerAssignments));
  const studentRef = doc(db, COL.students, input.student.id);
  const paperRestrictionRef = doc(
    db,
    COL.recessRestrictions,
    restrictionId(input.student.id, input.occurredOn),
  );
  const dutyRestrictionRef = doc(
    db,
    COL.recessRestrictions,
    restrictionId(input.student.id, dutyOn),
  );
  const auditRef = doc(collection(db, COL.auditLogs));

  return runTransaction(db, async (tx) => {
    // ---- 讀取階段（交易要求先讀後寫）----
    const [studentSnap, paperSnap, dutySnap] = await Promise.all([
      tx.get(studentRef),
      tx.get(paperRestrictionRef),
      tx.get(dutyRestrictionRef),
    ]);
    if (!studentSnap.exists()) throw new Error("查無此學生");

    const cached = pruneWindow(
      (studentSnap.get("recidivismWindow") as RecidivismWindowEntry[]) ?? [],
      windowStart,
    );
    const entry: RecidivismWindowEntry = {
      infractionId: infractionRef.id,
      occurredOn: input.occurredOn,
    };
    const counted = counts ? [...cached, entry] : cached;
    const triggered = counted.length >= settings.recidivismThreshold;

    // ---- 寫入階段 ----
    tx.set(infractionRef, {
      studentId: input.student.id,
      studentNo: input.student.studentNo,
      studentName: input.student.name,
      classId: input.student.classId,
      className: input.student.className,
      seatNo: input.student.seatNo ?? null,
      typeCode: input.type.code,
      typeName: input.type.name,
      paperCard: input.type.paperCard,
      // 卡名一併存進事件裡：日後後台改名或刪除類型，歷史紀錄仍顯示當時的卡名
      paperCardLabel: paperCardLabel(input.type),
      occurredAt: input.occurredAt,
      occurredOn: input.occurredOn,
      periodNo: input.periodNo,
      locationCode: input.location.code,
      locationName: input.location.name,
      note: input.note ?? null,
      recordedBy: { uid: ctx.actor.uid, name: ctx.actor.name },
      status: INFRACTION_STATUS.OPEN,
      paperReturnedAt: null,
      paperReturnedOn: null,
      exemptReason: null,
      voidReason: null,
      countsTowardRecidivism: counts,
      // 觸發時本筆一併認列，避免再被重複計數
      consumedByAlertId: triggered ? alertRef.id : null,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    // 違規當日凍結自由下課，待紙本反思卡回收
    tx.set(
      paperRestrictionRef,
      mergeRestriction(paperSnap.data(), {
        student: input.student,
        date: input.occurredOn,
        reason: RESTRICTION_REASONS.INFRACTION_PAPER,
        periods: [],
        sourceRef: { infractionId: infractionRef.id },
        note: `${input.type.name}｜待回收${paperCardLabel(input.type)}`,
      }),
      { merge: true },
    );

    if (triggered) {
      tx.set(alertRef, {
        studentId: input.student.id,
        studentNo: input.student.studentNo,
        studentName: input.student.name,
        classId: input.student.classId,
        className: input.student.className,
        triggeredAt: serverTimestamp(),
        // 觸發當時的參數快照：日後調參不影響既有案件的可追溯性
        windowDays: settings.recidivismWindowDays,
        threshold: settings.recidivismThreshold,
        windowStart,
        windowEnd: input.occurredOn,
        count: counted.length,
        triggerInfractionId: infractionRef.id,
        infractionIds: counted.map((item) => item.infractionId),
        breakdown: counted.map((item) => ({
          infractionId: item.infractionId,
          occurredOn: item.occurredOn,
        })),
        status: "ASSIGNED",
        assignmentId: assignmentRef.id,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      // 先前的違規標記認列（本筆已於上方寫入時直接帶入 alertId）
      for (const item of cached) {
        tx.update(doc(db, COL.infractions, item.infractionId), {
          consumedByAlertId: alertRef.id,
          updatedAt: serverTimestamp(),
        });
      }

      tx.set(assignmentRef, {
        alertId: alertRef.id,
        studentId: input.student.id,
        studentNo: input.student.studentNo,
        studentName: input.student.name,
        classId: input.student.classId,
        className: input.student.className,
        dutyOn,
        totalPeriods: settings.observerPeriods,
        periodLogs: settings.observerPeriodNumbers.map((periodNo) => ({
          periodNo,
        })),
        status: ASSIGNMENT_STATUS.SCHEDULED,
        reviewReturnedAt: null,
        reviewReturnedOn: null,
        unlockOn: null,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      tx.set(
        dutyRestrictionRef,
        mergeRestriction(dutySnap.data(), {
          student: input.student,
          date: dutyOn,
          reason: RESTRICTION_REASONS.OBSERVER_DUTY,
          periods: settings.observerPeriodNumbers,
          sourceRef: { assignmentId: assignmentRef.id },
          note: `安全觀察員值勤（共 ${settings.observerPeriods} 節，扣除打掃時間與 5 分鐘短下課）`,
        }),
        { merge: true },
      );

      // 認列後歸零，學生需再累積一輪才會再次觸發
      tx.set(studentRef, { recidivismWindow: [] }, { merge: true });
    } else {
      tx.set(studentRef, { recidivismWindow: counted }, { merge: true });
    }

    tx.set(
      auditRef,
      auditDoc(ctx, {
        action: "INFRACTION_LOGGED",
        entityType: COL.infractions,
        entityId: infractionRef.id,
        after: {
          studentNo: input.student.studentNo,
          typeCode: input.type.code,
          occurredOn: input.occurredOn,
          triggered,
        },
      }),
    );

    return {
      infractionId: infractionRef.id,
      paperCardLabel: paperCardLabel(input.type),
      recidivism: {
        triggered,
        count: counted.length,
        threshold: settings.recidivismThreshold,
        shortfall: Math.max(0, settings.recidivismThreshold - counted.length),
        ...(triggered
          ? { alertId: alertRef.id, assignmentId: assignmentRef.id, dutyOn }
          : {}),
      },
    };
  });
}

/** 紙本反思卡回收 → 當日解除下課管制 */
export async function markPaperReturned(
  ctx: Ctx,
  infractionId: string,
): Promise<{ unlockOn: SchoolDate }> {
  const ref = doc(ctx.db, COL.infractions, infractionId);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error("查無此案件");
  assertCanReturnPaper(snap.get("status"));

  const returnedOn = ctx.clock.today();
  const unlockOn = unlockDateForPaperReturn(returnedOn);
  const studentId = snap.get("studentId") as string;
  const occurredOn = snap.get("occurredOn") as SchoolDate;

  await runTransaction(ctx.db, async (tx) => {
    const current = await tx.get(ref);
    if (current.get("status") !== INFRACTION_STATUS.OPEN) {
      throw new Error("案件狀態已變更，請重新整理");
    }
    tx.update(ref, {
      status: INFRACTION_STATUS.DONE,
      paperReturnedAt: serverTimestamp(),
      paperReturnedOn: returnedOn,
      updatedAt: serverTimestamp(),
    });
    tx.set(
      doc(collection(ctx.db, COL.auditLogs)),
      auditDoc(ctx, {
        action: "INFRACTION_PAPER_RETURNED",
        entityType: COL.infractions,
        entityId: infractionId,
        after: { returnedOn },
      }),
    );
  });

  // 解除違規當日與今日兩筆管制帳（跨日回收時，續帳的管制也一併解除）
  for (const date of new Set([occurredOn, unlockOn])) {
    await liftRestriction(ctx, {
      studentId,
      date,
      reason: RESTRICTION_REASONS.INFRACTION_PAPER,
      note: "紙本反思卡已回收，解除下課管制",
    });
  }

  return { unlockOn };
}

/**
 * 免記（班級活動優先等）或撤銷（誤報）。
 * 兩者都不計入再犯，且會從學生的再犯視窗快取中移除。
 */
export async function annotateInfraction(
  ctx: Ctx,
  params: { infractionId: string; action: "EXEMPT" | "VOID"; reason: string },
): Promise<void> {
  const ref = doc(ctx.db, COL.infractions, params.infractionId);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error("查無此案件");
  assertCanAnnotate(snap.get("status"), params.reason);

  const studentId = snap.get("studentId") as string;
  const occurredOn = snap.get("occurredOn") as SchoolDate;
  const isExempt = params.action === "EXEMPT";
  const status = isExempt
    ? INFRACTION_STATUS.EXEMPTED
    : INFRACTION_STATUS.VOIDED;
  const studentRef = doc(ctx.db, COL.students, studentId);

  await runTransaction(ctx.db, async (tx) => {
    const studentSnap = await tx.get(studentRef);
    const cached =
      (studentSnap.get("recidivismWindow") as RecidivismWindowEntry[]) ?? [];

    tx.update(ref, {
      status,
      countsTowardRecidivism: false,
      ...(isExempt
        ? { exemptReason: params.reason }
        : { voidReason: params.reason }),
      updatedAt: serverTimestamp(),
    });
    tx.set(
      studentRef,
      {
        recidivismWindow: cached.filter(
          (item) => item.infractionId !== params.infractionId,
        ),
      },
      { merge: true },
    );
    tx.set(
      doc(collection(ctx.db, COL.auditLogs)),
      auditDoc(ctx, {
        action: isExempt ? "INFRACTION_EXEMPTED" : "INFRACTION_VOIDED",
        entityType: COL.infractions,
        entityId: params.infractionId,
        after: { status, reason: params.reason },
      }),
    );
  });

  await liftRestriction(ctx, {
    studentId,
    date: occurredOn,
    reason: RESTRICTION_REASONS.INFRACTION_PAPER,
    note: `${isExempt ? "免記" : "撤銷"}：${params.reason}`,
  });
}

/** 待回收紙本清單 */
export async function listPendingPapers(ctx: Ctx, max = 100) {
  const snap = await getDocs(
    query(
      collection(ctx.db, COL.infractions),
      where("status", "==", INFRACTION_STATUS.OPEN),
      orderBy("occurredOn", "desc"),
      fsLimit(max),
    ),
  );
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

/** 再犯進度（只讀一份學生文件即可） */
export async function readProgress(
  ctx: Ctx,
  studentId: string,
  settings: SystemSettings,
  asOf = ctx.clock.today(),
): Promise<{
  count: number;
  threshold: number;
  shortfall: number;
  windowStart: SchoolDate;
  windowEnd: SchoolDate;
}> {
  const snap = await getDoc(doc(ctx.db, COL.students, studentId));
  const windowStart = addDays(asOf, -(settings.recidivismWindowDays - 1));
  const count = pruneWindow(
    (snap.get("recidivismWindow") as RecidivismWindowEntry[]) ?? [],
    windowStart,
  ).length;
  return {
    count,
    threshold: settings.recidivismThreshold,
    shortfall: Math.max(0, settings.recidivismThreshold - count),
    windowStart,
    windowEnd: asOf,
  };
}
