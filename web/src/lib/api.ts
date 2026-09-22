/**
 * 資料存取層（單一入口）
 *
 * 架構：**不使用 Cloud Functions**（需付費方案）。
 *  - live 模式：直接以 Firestore 用戶端 SDK 讀寫，
 *    業務邏輯在 `src/core/services/`，原子性靠 Firestore 交易，
 *    權限與資料形狀由安全規則把關（見 firestore.rules）。
 *  - mock 模式：純前端模擬，未設定 Firebase 金鑰時自動啟用。
 *
 * 公開看板只讀 `publicBoard/today` 一份去識別化文件，不需登入。
 */
import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit as fsLimit,
  orderBy,
  query,
  where,
  type DocumentData,
  type Firestore,
  type Timestamp,
} from "firebase/firestore";
import {
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signInWithRedirect,
  signOut as fbSignOut,
  type User,
} from "firebase/auth";
import { USE_MOCK, firebase, firebaseConfig } from "../firebase/client.ts";
import { MOCK_SESSION, mockApi } from "./mock.ts";
import { todayTaipei } from "./format.ts";
import { COL } from "../core/firestore/paths.ts";
import { systemClock, type Ctx } from "../core/services/context.ts";
import {
  claimAccess,
  grantAccess,
  listAccess,
  revokeAccess,
} from "../core/services/access.ts";
import { loadCalendar } from "../core/services/calendar.ts";
import { runDailySyncIfNeeded } from "../core/services/dailySync.ts";
import {
  annotateInfraction,
  listPendingPapers,
  logInfraction,
  markPaperReturned,
  readProgress,
} from "../core/services/infractions.ts";
import {
  dismissAlert,
  listAlerts,
  listAssignments,
  listOpenAssignments,
  logPeriod,
  markReviewReturned,
  rescheduleDuty,
} from "../core/services/observers.ts";
import { rebuildPublicBoard } from "../core/services/publicBoard.ts";
import { listRestrictionsOn } from "../core/services/restrictions.ts";
import { loadSettings, updateSettings } from "../core/services/settings.ts";
import { addDays } from "../core/domain/dates.ts";
import {
  matchStudents,
  type StudentIndexEntry,
} from "../core/domain/studentSearch.ts";
import {
  readRosterIndex,
  readRosterIndexMeta,
  writeRosterIndex,
} from "../core/services/rosterIndex.ts";
import {
  DEFAULT_INFRACTION_TYPES,
  DEFAULT_LOCATIONS,
} from "../core/domain/defaults.ts";
import {
  importStudents,
  parseRosterRows,
  removeInfractionType,
  removeLocation,
  seedBaseData,
  upsertInfractionType,
  upsertLocation,
  type InfractionTypeInput,
  type ExistingStudent,
} from "../core/services/roster.ts";
import type {
  AccessUser,
  AlertRow,
  AssignmentRow,
  CreateInfractionInput,
  DashboardData,
  InfractionRow,
  InfractionTypeOption,
  LocationOption,
  PublicBoardData,
  RestrictionRow,
  Role,
  Session,
  StudentDetail,
  SystemSettings,
  WatchlistRow,
} from "./types.ts";

export { USE_MOCK };

/* ------------------------------- 身分驗證 ------------------------------- */

const MOCK_SESSION_KEY = "care.session";
let currentSession: Session | null = null;

const db = (): Firestore => firebase()!.db;

/** 服務層情境：帶入目前登入者，稽核軌跡才知道是誰操作 */
function ctx(): Ctx {
  if (!currentSession) throw new Error("尚未登入");
  return {
    db: db(),
    actor: {
      uid: currentSession.uid,
      name: currentSession.name,
      email: currentSession.email,
    },
    clock: systemClock,
  };
}

async function resolveSession(user: User): Promise<Session> {
  const email = (user.email ?? "").toLowerCase();
  const roles = await claimAccess(db(), {
    uid: user.uid,
    email,
    name: user.displayName ?? email ?? user.uid,
  });
  const session: Session = {
    uid: user.uid,
    name: user.displayName ?? email ?? user.uid,
    email: email || undefined,
    roles: roles as Role[],
  };
  currentSession = session;
  return session;
}

export const auth = {
  /** Google 登入（建議使用學校 Google Workspace 帳號） */
  async signInWithGoogle(): Promise<Session> {
    if (USE_MOCK) {
      sessionStorage.setItem(MOCK_SESSION_KEY, "1");
      currentSession = MOCK_SESSION;
      return MOCK_SESSION;
    }
    const fb = firebase()!;
    const provider = new GoogleAuthProvider();
    const hd = import.meta.env.VITE_GOOGLE_HD as string | undefined;
    provider.setCustomParameters({
      prompt: "select_account",
      ...(hd ? { hd } : {}),
    });

    try {
      const credential = await signInWithPopup(fb.auth, provider);
      return await resolveSession(credential.user);
    } catch (error) {
      const code = (error as { code?: string }).code ?? "";
      if (
        code === "auth/popup-blocked" ||
        code === "auth/operation-not-supported-in-this-environment"
      ) {
        await signInWithRedirect(fb.auth, provider);
        return new Promise<Session>(() => {});
      }
      if (
        code === "auth/popup-closed-by-user" ||
        code === "auth/cancelled-popup-request"
      ) {
        throw new Error("登入已取消");
      }
      throw error;
    }
  },

  async signOut(): Promise<void> {
    currentSession = null;
    if (USE_MOCK) {
      sessionStorage.removeItem(MOCK_SESSION_KEY);
      return;
    }
    await fbSignOut(firebase()!.auth);
  },

  subscribe(callback: (session: Session | null) => void): () => void {
    if (USE_MOCK) {
      const signed = Boolean(sessionStorage.getItem(MOCK_SESSION_KEY));
      currentSession = signed ? MOCK_SESSION : null;
      callback(currentSession);
      return () => {};
    }
    return onAuthStateChanged(firebase()!.auth, async (user) => {
      if (!user) {
        currentSession = null;
        return callback(null);
      }
      callback(await resolveSession(user));
    });
  },

  /** 手動重新檢查授權（「尚未授權」畫面的按鈕） */
  async recheckAccess(): Promise<Session | null> {
    if (USE_MOCK) return MOCK_SESSION;
    const user = firebase()!.auth.currentUser;
    return user ? resolveSession(user) : null;
  },
};

/* --------------------------------- 工具 -------------------------------- */

/** Firestore Timestamp 或 ISO 字串 → ISO 字串 */
const toIso = (value: unknown): string | undefined => {
  if (!value) return undefined;
  if (typeof value === "string") return value;
  const ts = value as Timestamp;
  return typeof ts?.toDate === "function"
    ? ts.toDate().toISOString()
    : undefined;
};

const mapInfraction = (id: string, data: DocumentData): InfractionRow => ({
  id,
  studentId: data.studentId as string,
  studentNo: data.studentNo as string,
  studentName: data.studentName as string,
  className: (data.className as string) ?? "",
  seatNo: (data.seatNo as number | null) ?? undefined,
  typeCode: data.typeCode as string,
  typeName: (data.typeName as string) ?? "",
  paperCard: data.paperCard as InfractionRow["paperCard"],
  paperCardLabel: (data.paperCardLabel as string | undefined) ?? undefined,
  occurredAt: toIso(data.occurredAt) ?? (data.occurredAt as string) ?? "",
  occurredOn: data.occurredOn as string,
  periodNo: (data.periodNo as number) ?? 0,
  locationName: (data.locationName as string) ?? "",
  note: (data.note as string | null) ?? undefined,
  status: data.status as InfractionRow["status"],
  paperReturnedOn: (data.paperReturnedOn as string | null) ?? undefined,
  exemptReason: (data.exemptReason as string | null) ?? undefined,
  voidReason: (data.voidReason as string | null) ?? undefined,
  recordedBy: data.recordedBy as { uid: string; name: string } | undefined,
});

const mapAlert = (id: string, data: DocumentData): AlertRow => ({
  id,
  studentId: data.studentId as string,
  studentNo: data.studentNo as string,
  studentName: data.studentName as string,
  className: (data.className as string) ?? "",
  triggeredAt: toIso(data.triggeredAt) ?? "",
  windowStart: data.windowStart as string,
  windowEnd: data.windowEnd as string,
  windowDays: (data.windowDays as number) ?? 15,
  count: (data.count as number) ?? 0,
  threshold: (data.threshold as number) ?? 3,
  status: data.status as AlertRow["status"],
  assignmentId: (data.assignmentId as string | null) ?? undefined,
  dutyOn: (data.dutyOn as string | null) ?? undefined,
  breakdown: ((data.breakdown as Array<DocumentData>) ?? []).map((item) => ({
    infractionId: item.infractionId as string,
    typeName: (item.typeName as string) ?? "",
    occurredOn: item.occurredOn as string,
  })),
});

const mapAssignment = (id: string, data: DocumentData): AssignmentRow => ({
  id,
  alertId: data.alertId as string,
  studentId: data.studentId as string,
  studentNo: data.studentNo as string,
  studentName: data.studentName as string,
  className: (data.className as string) ?? "",
  dutyOn: data.dutyOn as string,
  status: data.status as AssignmentRow["status"],
  totalPeriods: (data.totalPeriods as number) ?? 5,
  periodLogs: ((data.periodLogs as Array<DocumentData>) ?? []).map((log) => ({
    periodNo: log.periodNo as number,
    checkInAt: (log.checkInAt as string | null) ?? undefined,
    checkOutAt: (log.checkOutAt as string | null) ?? undefined,
    observedCount: (log.observedCount as number | null) ?? undefined,
    note: (log.note as string | null) ?? undefined,
  })),
  reviewReturnedOn: (data.reviewReturnedOn as string | null) ?? undefined,
  unlockOn: (data.unlockOn as string | null) ?? undefined,
});

const mapRestriction = (id: string, data: DocumentData): RestrictionRow => ({
  id,
  studentId: data.studentId as string,
  studentNo: data.studentNo as string,
  studentName: data.studentName as string,
  className: (data.className as string) ?? "",
  seatNo: (data.seatNo as number | null) ?? undefined,
  date: data.date as string,
  reasons: (data.reasons as RestrictionRow["reasons"]) ?? [],
  status: data.status as RestrictionRow["status"],
  note: (data.note as string | null) ?? undefined,
});

/* ------------------------------ 資料存取 API ----------------------------- */

export const api = {
  /** 公開看板：不需登入，只讀一份去識別化摘要 */
  async publicBoard(): Promise<PublicBoardData> {
    if (USE_MOCK) return mockApi.publicBoard();
    const snap = await getDoc(doc(db(), COL.publicBoard, "today"));
    if (!snap.exists()) throw new Error("公開看板尚未產生");
    const data = snap.data();
    return {
      enabled: data.enabled !== false,
      date: data.date as string,
      updatedAt: toIso(data.updatedAt) ?? "",
      stats: data.stats as PublicBoardData["stats"],
      trend: (data.trend as PublicBoardData["trend"]) ?? [],
      hotspots: (data.hotspots as PublicBoardData["hotspots"]) ?? [],
      ...(data.roster
        ? { roster: data.roster as PublicBoardData["roster"] }
        : {}),
      ...(data.observers
        ? { observers: data.observers as PublicBoardData["observers"] }
        : {}),
    };
  },

  async infractionTypes(): Promise<InfractionTypeOption[]> {
    if (USE_MOCK) return mockApi.infractionTypes();
    const snap = await getDocs(
      query(collection(db(), COL.infractionTypes), orderBy("order")),
    );
    // 尚未匯入基本資料時退回內建預設值，讓登錄畫面不會是一片空白
    if (snap.empty) {
      return DEFAULT_INFRACTION_TYPES.map((type) => ({
        code: type.code,
        name: type.name,
        paperCard: type.paperCard,
        paperCardLabel: type.paperCardLabel,
        icon: type.icon,
        countsTowardRecidivism: type.countsTowardRecidivism,
        order: type.order,
      }));
    }
    return snap.docs.map((d) => ({
      code: d.id,
      name: d.get("name") as string,
      paperCard: d.get("paperCard") as InfractionTypeOption["paperCard"],
      paperCardLabel: (d.get("paperCardLabel") as string) ?? "",
      icon: d.get("icon") as string | undefined,
      countsTowardRecidivism: d.get("countsTowardRecidivism") !== false,
      order: (d.get("order") as number | undefined) ?? 99,
    }));
  },

  async locations(): Promise<LocationOption[]> {
    if (USE_MOCK) return mockApi.locations();
    const snap = await getDocs(collection(db(), COL.locations));
    if (snap.empty)
      return DEFAULT_LOCATIONS.map((location) => ({ ...location }));
    return snap.docs.map((d) => ({
      code: d.id,
      name: d.get("name") as string,
      isHotspot: Boolean(d.get("isHotspot")),
    }));
  },

  async dashboard(): Promise<DashboardData> {
    if (USE_MOCK) return mockApi.dashboard();
    const settings = await cachedSettings();
    // 每天第一次開啟時續帳並重建公開看板（取代付費方案的排程函式）
    await runDailySyncIfNeeded(ctx(), settings).catch(() => undefined);

    const today = todayTaipei();
    const since = addDays(today, -13);
    const [
      restrictionRows,
      pendingRows,
      alertRows,
      assignmentRows,
      recentSnap,
    ] = await Promise.all([
      listRestrictionsOn(ctx(), today),
      listPendingPapers(ctx()),
      listAlerts(ctx(), 50),
      listOpenAssignments(ctx()),
      getDocs(
        query(
          collection(db(), COL.infractions),
          where("occurredOn", ">=", since),
          where("occurredOn", "<=", today),
          fsLimit(500),
        ),
      ),
    ]);

    const restrictions = restrictionRows.map((row) =>
      mapRestriction(row.id as string, row as DocumentData),
    );
    const pendingPapers = pendingRows.map((row) =>
      mapInfraction(row.id as string, row as DocumentData),
    );
    const alerts = alertRows
      .map((row) => mapAlert(row.id as string, row as DocumentData))
      .filter(
        (alert) =>
          alert.status === "OPEN" ||
          alert.status === "ASSIGNED" ||
          alert.status === "ACKNOWLEDGED",
      );
    const assignments = assignmentRows.map((row) =>
      mapAssignment(row.id as string, row as DocumentData),
    );

    const counted = recentSnap.docs.filter(
      (d) => d.get("status") !== "VOIDED" && d.get("status") !== "EXEMPTED",
    );
    const trend = Array.from({ length: 14 }, (_, index) => {
      const date = todayTaipei(index - 13);
      const sameDay = counted.filter((d) => d.get("occurredOn") === date);
      return {
        date,
        safety: sameDay.filter((d) => d.get("paperCard") === "SAFETY").length,
        kindWords: sameDay.filter((d) => d.get("paperCard") === "KIND_WORDS")
          .length,
      };
    });
    const hotspotMap = new Map<string, number>();
    for (const d of counted) {
      const name = (d.get("locationName") as string) ?? "其他";
      hotspotMap.set(name, (hotspotMap.get(name) ?? 0) + 1);
    }

    // 關注名單：視窗內尚未被認列、且未達門檻者
    const byStudent = new Map<string, WatchlistRow>();
    for (const d of counted) {
      if (d.get("consumedByAlertId")) continue;
      const studentId = d.get("studentId") as string;
      const row = byStudent.get(studentId) ?? {
        studentId,
        studentNo: d.get("studentNo") as string,
        studentName: d.get("studentName") as string,
        className: (d.get("className") as string) ?? "",
        count: 0,
        shortfall: settings.recidivismThreshold,
      };
      row.count += 1;
      row.shortfall = Math.max(0, settings.recidivismThreshold - row.count);
      byStudent.set(studentId, row);
    }
    const watchlist = [...byStudent.values()]
      .filter((row) => row.shortfall > 0)
      .sort((a, b) => b.count - a.count);

    return {
      today,
      kpis: {
        restrictedActive: restrictions.filter((r) => r.status === "ACTIVE")
          .length,
        pendingPapers: pendingPapers.length,
        openAlerts: alerts.length,
        observersToday: assignments.filter((a) => a.dutyOn === today).length,
        infractionsToday: counted.filter((d) => d.get("occurredOn") === today)
          .length,
        watchlist: watchlist.length,
      },
      restrictions,
      pendingPapers,
      alerts,
      assignments,
      trend,
      hotspots: [...hotspotMap.entries()]
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 5),
      watchlist,
    };
  },

  async pendingPapers(): Promise<InfractionRow[]> {
    if (USE_MOCK) return mockApi.pendingPapers();
    const rows = await listPendingPapers(ctx());
    return rows.map((row) =>
      mapInfraction(row.id as string, row as DocumentData),
    );
  },

  async alerts(): Promise<AlertRow[]> {
    if (USE_MOCK) return mockApi.alerts();
    const rows = await listAlerts(ctx());
    return rows.map((row) => mapAlert(row.id as string, row as DocumentData));
  },

  async assignments(): Promise<AssignmentRow[]> {
    if (USE_MOCK) return mockApi.assignments();
    const rows = await listAssignments(ctx());
    return rows.map((row) =>
      mapAssignment(row.id as string, row as DocumentData),
    );
  },

  async restrictions(date: string): Promise<RestrictionRow[]> {
    if (USE_MOCK) return mockApi.restrictions(date);
    const rows = await listRestrictionsOn(ctx(), date);
    return rows.map((row) =>
      mapRestriction(row.id as string, row as DocumentData),
    );
  },

  /**
   * 以**學號或姓名**搜尋學生。
   *
   * Firestore 沒有全文檢索，但可用範圍查詢做「前綴比對」：
   * `>= kw` 且 `<= kw + \uf8ff` 等同「以 kw 開頭」。
   * 因此學號打前幾碼、姓氏打一個字都找得到，兩邊各查一次再合併去重。
   */
  /**
   * 以學號、姓名或班級搜尋學生。
   *
   * Firestore 只能做前綴比對（打「小明」找不到王小明），而且每次查詢都要付讀取，
   * 因此改成：**整份名冊讀一次進記憶體**，之後在前端做子字串比對。
   * 一所學校幾百到一兩千人，一次讀取即可支撐整個工作階段，
   * 也順便解決「結果被截斷」與「只能從開頭比對」兩個問題。
   */
  /**
   * 以學號、姓名或班級搜尋學生。
   *
   * Firestore 只能做前綴比對（打「小明」找不到王小明），而且每次查詢都要付讀取，
   * 因此改成：**整份名冊讀一次進記憶體**，之後在前端做子字串比對。
   * 一所學校幾百到一兩千人，一次讀取即可支撐整個工作階段，
   * 也順便解決「結果被截斷」與「只能從開頭比對」兩個問題。
   * 比對規則見 `core/domain/studentSearch.ts`（純函式，有單元測試）。
   */
  async searchStudent(keyword: string) {
    if (USE_MOCK) return mockApi.searchStudent(keyword);
    const trimmed = keyword.trim();
    if (!trimmed) return [];

    const [index, settings] = await Promise.all([
      loadRosterIndex(),
      cachedSettings(),
    ]);
    const windowStart = addDays(
      todayTaipei(),
      -(settings.recidivismWindowDays - 1),
    );
    return matchStudents(index, trimmed, windowStart);
  },

  /** 班級清單（取自名冊索引，不另外查 Firestore） */
  async classList(): Promise<string[]> {
    if (USE_MOCK) return mockApi.classList();
    const index = await loadRosterIndex();
    return [...new Set(index.filter((s) => s.active).map((s) => s.className))]
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b, "zh-Hant"));
  },

  /** 某班的在校學生，依座號排序（現場用班級＋座號找人） */
  async classRoster(className: string) {
    if (USE_MOCK) return mockApi.classRoster(className);
    const [index, settings] = await Promise.all([
      loadRosterIndex(),
      cachedSettings(),
    ]);
    const windowStart = addDays(
      todayTaipei(),
      -(settings.recidivismWindowDays - 1),
    );
    return index
      .filter((s) => s.active && s.className === className)
      .sort((a, b) => (a.seatNo ?? 0) - (b.seatNo ?? 0))
      .map((s) => ({
        id: s.id,
        studentNo: s.studentNo,
        name: s.name,
        className: s.className,
        ...(s.seatNo === null ? {} : { seatNo: s.seatNo }),
        active: s.active,
        windowCount: s.window.filter((day) => day >= windowStart).length,
      }));
  },

  /**
   * 單一學生的再犯進度（選定學生後才查，1 次讀取）。
   * 名冊索引刻意不存這個數字 —— 它每次登錄都會變，放進索引就得跟著改寫。
   */
  async studentProgress(studentId: string) {
    if (USE_MOCK) return mockApi.progress(studentId);
    return readProgress(ctx(), studentId, await cachedSettings());
  },

  async student(studentId: string): Promise<StudentDetail> {
    if (USE_MOCK) return mockApi.student(studentId);
    const settings = await cachedSettings();
    const today = todayTaipei();
    const [
      studentSnap,
      historySnap,
      alertSnap,
      assignmentSnap,
      restrictionSnap,
      progress,
    ] = await Promise.all([
      getDoc(doc(db(), COL.students, studentId)),
      getDocs(
        query(
          collection(db(), COL.infractions),
          where("studentId", "==", studentId),
          orderBy("occurredOn", "desc"),
          fsLimit(50),
        ),
      ),
      getDocs(
        query(
          collection(db(), COL.recidivismAlerts),
          where("studentId", "==", studentId),
          fsLimit(20),
        ),
      ),
      getDocs(
        query(
          collection(db(), COL.observerAssignments),
          where("studentId", "==", studentId),
          fsLimit(20),
        ),
      ),
      getDoc(doc(db(), COL.recessRestrictions, `${studentId}_${today}`)),
      readProgress(ctx(), studentId, settings),
    ]);
    if (!studentSnap.exists()) throw new Error("查無此學生");

    return {
      id: studentSnap.id,
      studentNo: studentSnap.get("studentNo") as string,
      name: studentSnap.get("name") as string,
      className: studentSnap.get("className") as string,
      seatNo: studentSnap.get("seatNo") as number | undefined,
      progress,
      totals: {
        infractions: historySnap.size,
        alerts: alertSnap.size,
        duties: assignmentSnap.size,
      },
      history: historySnap.docs.map((d) => mapInfraction(d.id, d.data())),
      alerts: alertSnap.docs.map((d) => mapAlert(d.id, d.data())),
      restrictedToday:
        restrictionSnap.exists() && restrictionSnap.get("status") === "ACTIVE",
    };
  },

  /* --- 系統設定與帳號授權 --- */

  async settings(): Promise<SystemSettings> {
    if (USE_MOCK) return mockApi.settings();
    return cachedSettings();
  },

  async updateSettings(patch: Partial<SystemSettings>) {
    if (USE_MOCK) return mockApi.updateSettings(patch);
    const settings = await updateSettings(ctx(), patch);
    settingsCache = null;
    await rebuildPublicBoard(ctx(), settings).catch(() => undefined);
    return { ok: true, settings };
  },

  async listAccess(): Promise<{
    users: AccessUser[];
    bootstrapAdmins: string[];
  }> {
    if (USE_MOCK) return mockApi.listAccess();
    const users = (await listAccess(db())) as AccessUser[];
    return { users, bootstrapAdmins: [] };
  },

  async grantAccess(email: string, roles: Role[], name?: string) {
    if (USE_MOCK) return mockApi.grantAccess(email, roles, name);
    const result = await grantAccess(ctx(), { email, roles, name });
    return { ok: true, ...result, appliedImmediately: true };
  },

  async revokeAccess(email: string) {
    if (USE_MOCK) return mockApi.revokeAccess(email);
    await revokeAccess(ctx(), email);
    return { ok: true };
  },

  /* --- 寫入（live 模式直接以交易寫入 Firestore） --- */

  async createInfraction(input: CreateInfractionInput) {
    if (USE_MOCK) return mockApi.createInfraction(input);

    const settings = await cachedSettings();
    const [studentSnap, typeSnap, locationSnap] = await Promise.all([
      getDocs(
        query(
          collection(db(), COL.students),
          where("studentNo", "==", input.studentNo.trim()),
          fsLimit(1),
        ),
      ),
      getDoc(doc(db(), COL.infractionTypes, input.typeCode)),
      getDoc(doc(db(), COL.locations, input.locationCode)),
    ]);
    const studentDoc = studentSnap.docs[0];
    if (!studentDoc) throw new Error(`查無學號 ${input.studentNo} 的學生`);
    if (studentDoc.get("active") === false) {
      throw new Error(
        `${studentDoc.get("name")} 已不在名冊中（畢業或轉出），如需登錄請先重新匯入名冊`,
      );
    }
    // 類型／地點尚未匯入時，以內建預設值成案（避免現場因基本資料未建而卡住）
    const fallbackType = DEFAULT_INFRACTION_TYPES.find(
      (type) => type.code === input.typeCode,
    );
    if (!typeSnap.exists() && !fallbackType) throw new Error("查無此違規類型");
    const fallbackLocation = DEFAULT_LOCATIONS.find(
      (loc) => loc.code === input.locationCode,
    );

    const today = todayTaipei();
    const calendar = await loadCalendar(db(), today, addDays(today, 45));
    const result = await logInfraction(
      ctx(),
      {
        student: {
          id: studentDoc.id,
          studentNo: studentDoc.get("studentNo") as string,
          name: studentDoc.get("name") as string,
          classId: studentDoc.get("classId") as string,
          className: studentDoc.get("className") as string,
          seatNo: (studentDoc.get("seatNo") as number | null) ?? null,
        },
        type: typeSnap.exists()
          ? {
              code: typeSnap.id,
              name: typeSnap.get("name") as string,
              paperCard: typeSnap.get("paperCard") as "SAFETY" | "KIND_WORDS",
              paperCardLabel: typeSnap.get("paperCardLabel") as
                | string
                | undefined,
              countsTowardRecidivism:
                typeSnap.get("countsTowardRecidivism") !== false,
            }
          : {
              code: fallbackType!.code,
              name: fallbackType!.name,
              paperCard: fallbackType!.paperCard,
              paperCardLabel: fallbackType!.paperCardLabel,
              countsTowardRecidivism: fallbackType!.countsTowardRecidivism,
            },
        location: {
          code: input.locationCode,
          name:
            (locationSnap.exists()
              ? (locationSnap.get("name") as string)
              : undefined) ??
            fallbackLocation?.name ??
            input.locationCode,
        },
        periodNo: input.periodNo,
        occurredOn: today,
        occurredAt: new Date().toISOString(),
        note: input.note,
      },
      settings,
      calendar,
    );
    await rebuildPublicBoard(ctx(), settings).catch(() => undefined);
    // 再犯次數變了，下次搜尋重新讀名冊索引
    invalidateRosterIndex();

    return {
      infractionId: result.infractionId,
      studentId: studentDoc.id,
      studentName: studentDoc.get("name") as string,
      className: studentDoc.get("className") as string,
      paperCardLabel: result.paperCardLabel,
      recidivism: result.recidivism,
    };
  },

  async returnPaperCard(infractionId: string) {
    if (USE_MOCK) return mockApi.returnPaperCard(infractionId);
    const result = await markPaperReturned(ctx(), infractionId);
    await refreshBoard();
    return { status: "DONE", unlockOn: result.unlockOn };
  },

  async annotate(
    infractionId: string,
    action: "EXEMPT" | "VOID",
    reason: string,
  ) {
    if (USE_MOCK) return mockApi.annotate(infractionId, action, reason);
    await annotateInfraction(ctx(), { infractionId, action, reason });
    await refreshBoard();
    return { ok: true };
  },

  async logObserverPeriod(input: {
    assignmentId: string;
    periodNo: number;
    action: "CHECK_IN" | "CHECK_OUT";
    observedCount?: number;
    note?: string;
  }) {
    if (USE_MOCK) return mockApi.logObserverPeriod(input);
    const result = await logPeriod(ctx(), input);
    await refreshBoard();
    return result;
  },

  async returnConductReview(assignmentId: string) {
    if (USE_MOCK) return mockApi.returnConductReview(assignmentId);
    const today = todayTaipei();
    const calendar = await loadCalendar(db(), today, addDays(today, 45));
    const result = await markReviewReturned(ctx(), assignmentId, calendar);
    await refreshBoard();
    return result;
  },

  async rescheduleDuty(
    assignmentId: string,
    dutyOn: string,
    reason = "生教組調整",
  ) {
    if (USE_MOCK) return mockApi.rescheduleDuty(assignmentId, dutyOn);
    const settings = await cachedSettings();
    const calendar = await loadCalendar(db(), dutyOn, addDays(dutyOn, 1));
    await rescheduleDuty(
      ctx(),
      { assignmentId, dutyOn, reason },
      settings,
      calendar,
    );
    await refreshBoard();
    return { ok: true };
  },

  /** 一鍵建立內建違規類型與地點（管理者） */
  async seedBaseData() {
    if (USE_MOCK)
      return {
        types: DEFAULT_INFRACTION_TYPES.length,
        locations: DEFAULT_LOCATIONS.length,
      };
    return seedBaseData(ctx());
  },

  /** 違規類型維護（管理者）：名稱、要發哪張反思卡、是否計入再犯都可改 */
  async saveInfractionType(input: InfractionTypeInput) {
    if (USE_MOCK) return { code: input.code ?? `type_${input.name}` };
    await materializeCatalog();
    return upsertInfractionType(ctx(), input);
  },

  async deleteInfractionType(code: string) {
    if (USE_MOCK) return { ok: true };
    await materializeCatalog();
    await removeInfractionType(ctx(), code);
    return { ok: true };
  },

  /**
   * 地點維護：集合為空時代表仍在用內建預設值，
   * 第一次異動前先把預設值寫進 Firestore，否則刪掉一個之後預設值又會整組冒出來。
   */
  async saveLocation(input: {
    name: string;
    isHotspot: boolean;
    code?: string;
  }) {
    if (USE_MOCK) return { code: input.code ?? `loc_${input.name}`, ...input };
    await materializeCatalog();
    return upsertLocation(ctx(), input);
  },

  async deleteLocation(code: string) {
    if (USE_MOCK) return { ok: true };
    await materializeCatalog();
    await removeLocation(ctx(), code);
    return { ok: true };
  },

  /**
   * 重建搜尋索引（管理者）。
   * 這是唯一會逐份讀 students 的地方，平時搜尋都只讀聚合索引。
   */
  async rebuildRosterIndex() {
    if (USE_MOCK) return { students: 0, chunks: 0 };
    const snap = await getDocs(collection(db(), COL.students));
    const rows = snap.docs.map((d) => ({
      id: d.id,
      studentNo: (d.get("studentNo") as string) ?? "",
      name: (d.get("name") as string) ?? "",
      className: (d.get("className") as string) ?? "",
      seatNo: (d.get("seatNo") as number | null) ?? null,
      active: d.get("active") !== false,
    }));
    const chunks = await writeRosterIndex(ctx(), rows);
    invalidateRosterIndex();
    return { students: rows.length, chunks };
  },

  /**
   * 清除本機快取（名冊索引與設定）。
   * 資料本身在 Firestore，清掉只是強制重讀 —— 用來排除「某台裝置看到舊資料」。
   */
  clearLocalCache() {
    invalidateRosterIndex();
    settingsCache = null;
  },

  /** 目前名冊（比對新舊名冊用；只取比對需要的欄位） */
  async rosterSnapshot(): Promise<ExistingStudent[]> {
    if (USE_MOCK) return [];
    // 有索引就用索引（幾次讀取），沒有才退回逐份讀
    const indexRows = await readRosterIndex({ db: db() });
    if (indexRows) return indexRows.map((row) => ({ ...row }));
    const snap = await getDocs(collection(db(), COL.students));
    return snap.docs.map((d) => ({
      id: d.id,
      studentNo: (d.get("studentNo") as string) ?? "",
      name: (d.get("name") as string) ?? "",
      className: (d.get("className") as string) ?? "",
      seatNo: (d.get("seatNo") as number | null) ?? null,
      active: d.get("active") !== false,
    }));
  },

  /**
   * 匯入學生名冊（管理者）。
   * `mode: 'REPLACE'` 為「完整名冊」：檔案中沒有的學生會被停用（畢業／轉出），
   * 停用不是刪除，違規歷程全部保留。
   */
  async importRoster(text: string, mode: "MERGE" | "REPLACE" = "MERGE") {
    return this.importRosterTable(
      text.split(/\r?\n/).map((line) => line.split(/[,\t]/)),
      mode,
    );
  },

  /** 匯入已解析的表格（Excel／CSV 檔案上傳與貼上文字都走這條） */
  async importRosterTable(
    table: string[][],
    mode: "MERGE" | "REPLACE" = "MERGE",
  ) {
    const { rows, errors } = parseRosterRows(table);
    if (rows.length === 0) {
      throw new Error(errors[0] ?? "沒有解析到任何學生資料");
    }
    if (USE_MOCK) {
      return {
        students: rows.length,
        classes: new Set(rows.map((row) => row.className)).size,
        created: rows.length,
        reclassed: 0,
        deactivated: 0,
        errors,
      };
    }
    const existing = await this.rosterSnapshot();
    const result = await importStudents(ctx(), rows, {
      existing,
      deactivateMissing: mode === "REPLACE",
    });
    invalidateRosterIndex();
    return { ...result, errors };
  },

  async dismissAlert(alertId: string, reason: string) {
    if (USE_MOCK) return mockApi.dismissAlert(alertId, reason);
    const settings = await cachedSettings();
    await dismissAlert(ctx(), { alertId, reason }, settings);
    await refreshBoard();
    return { ok: true };
  },
};

/* --------------------------- 讀取次數的節流機制 --------------------------- */
/*
 * Firestore 免費方案每天 5 萬次讀取，逐份讀名冊或每次操作都重建看板很快就會吃光。
 * 這裡集中三道節流：名冊索引、系統設定快取、公開看板重建間隔。
 */

/*
 * 名冊快取一定要能跨裝置自我校正：
 * 每次開啟只讀一份 rosterIndex/meta（1 次讀取）比對版本，
 * 版本相同才用本機快取。否則「這台電腦匯入、那支手機看不到」會發生。
 * 快取鍵含專案 ID，切換帳號或專案不會誤用別人的名冊。
 */
const ROSTER_INDEX_KEY = `care.rosterIndex.${firebaseConfig.projectId}`;
/** 尚未建立索引（退回逐份讀 students）時的短快取，避免匯入後久久看不到 */
const ROSTER_FALLBACK_TTL = 2 * 60 * 1000;

interface RosterCache {
  version: number;
  at: number;
  rows: StudentIndexEntry[];
}

let rosterIndex: RosterCache | null = null;

function readCachedIndex(): RosterCache | null {
  if (rosterIndex) return rosterIndex;
  try {
    const raw = localStorage.getItem(ROSTER_INDEX_KEY);
    if (!raw) return null;
    rosterIndex = JSON.parse(raw) as RosterCache;
    return rosterIndex;
  } catch {
    return null;
  }
}

function writeCachedIndex(cache: RosterCache): void {
  rosterIndex = cache;
  try {
    localStorage.setItem(ROSTER_INDEX_KEY, JSON.stringify(cache));
  } catch {
    /* 配額不足時只用記憶體快取即可 */
  }
}

/**
 * 取得搜尋用的名冊。
 * 1. 讀 meta（1 次）→ 版本與快取相同就直接用快取
 * 2. 版本不同 → 重讀分片（1000 人約 2 次讀取）
 * 3. 還沒有索引 → 退回逐份讀 students，並只短暫快取
 */
async function loadRosterIndex(): Promise<StudentIndexEntry[]> {
  const cached = readCachedIndex();
  const meta = await readRosterIndexMeta({ db: db() });

  if (meta) {
    if (cached && cached.version === meta.version) return cached.rows;
    const indexRows = (await readRosterIndex({ db: db() })) ?? [];
    const rows = indexRows.map((row) => ({ ...row, window: [] }));
    writeCachedIndex({ version: meta.version, at: Date.now(), rows });
    return rows;
  }

  // 尚未建立索引：逐份讀，短快取（2 分鐘），讓剛匯入的名冊很快就看得到
  if (
    cached &&
    cached.version === 0 &&
    Date.now() - cached.at < ROSTER_FALLBACK_TTL
  ) {
    return cached.rows;
  }
  const rows: StudentIndexEntry[] = (
    await getDocs(collection(db(), COL.students))
  ).docs.map((d) => ({
    id: d.id,
    studentNo: (d.get("studentNo") as string) ?? "",
    name: (d.get("name") as string) ?? "",
    className: (d.get("className") as string) ?? "",
    seatNo: (d.get("seatNo") as number | null) ?? null,
    active: d.get("active") !== false,
    window: [],
  }));
  writeCachedIndex({ version: 0, at: Date.now(), rows });
  return rows;
}

/** 名冊有異動時呼叫，下次搜尋會重新讀取 */
function invalidateRosterIndex(): void {
  rosterIndex = null;
  try {
    localStorage.removeItem(ROSTER_INDEX_KEY);
  } catch {
    /* 忽略 */
  }
}

/** 系統設定幾乎不變，但幾乎每個操作都要用；快取 10 分鐘可省下大量讀取 */
const SETTINGS_TTL = 10 * 60 * 1000;
type CoreSettings = Awaited<ReturnType<typeof loadSettings>>;
let settingsCache: { at: number; value: CoreSettings } | null = null;

async function cachedSettings(): Promise<CoreSettings> {
  if (settingsCache && Date.now() - settingsCache.at < SETTINGS_TTL) {
    return settingsCache.value;
  }
  const value = await loadSettings(db());
  settingsCache = { at: Date.now(), value };
  return value;
}

/** 公開看板重建的最短間隔：連續登錄時不必每筆都重掃 14 天資料 */
const BOARD_REBUILD_INTERVAL = 5 * 60 * 1000;
let lastBoardRebuild = 0;

/**
 * 違規類型／地點集合仍為空（畫面上顯示的是內建預設值），
 * 先把預設值寫進 Firestore 再讓使用者增刪，否則刪掉一筆之後預設值又會整組冒出來。
 */
async function materializeCatalog(): Promise<void> {
  const [types, locations] = await Promise.all([
    getDocs(collection(db(), COL.infractionTypes)),
    getDocs(collection(db(), COL.locations)),
  ]);
  if (types.empty || locations.empty) await seedBaseData(ctx());
}

/** 每次異動後重建公開看板（失敗不影響主要操作） */
/**
 * 重建公開看板。
 * 每次重建都要掃 14 天的違規紀錄，因此設最短間隔；
 * 看板只是給其他老師看的概況，慢幾分鐘無妨，開儀表板時會強制重建。
 */
async function refreshBoard(force = false): Promise<void> {
  if (!force && Date.now() - lastBoardRebuild < BOARD_REBUILD_INTERVAL) return;
  try {
    await rebuildPublicBoard(ctx(), await cachedSettings());
    lastBoardRebuild = Date.now();
  } catch {
    /* 看板為次要資訊，下次開啟儀表板時會重建 */
  }
}
