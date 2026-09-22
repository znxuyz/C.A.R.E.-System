/**
 * 前端模擬資料層（未設定 Firebase 金鑰或 VITE_USE_MOCK=true 時啟用）
 *
 * 目的：讓介面可在 GitHub Pages 直接試操作，並以與後端相同的規則
 *（15 天 / 3 次、紙本回收當日解除、檢討書回收隔日解鎖）模擬完整流程。
 * 正式判定一律以 Cloud Functions 為準。
 */
import { todayTaipei } from "./format.ts";
import { matchStudents } from "../core/domain/studentSearch.js";
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

const WINDOW_DAYS = 15;
const THRESHOLD = 3;
/** 期間內第幾次起才發反思卡（與正式環境的 settings.cardFromOffense 一致） */
const CARD_FROM_OFFENSE = 2;

const shift = (date: string, days: number): string => {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
};
const nowIso = () => new Date().toISOString();
const uid = (prefix: string) =>
  `${prefix}_${Math.random().toString(36).slice(2, 8)}`;
const delay = <T>(value: T, ms = 120): Promise<T> =>
  new Promise((resolve) => setTimeout(() => resolve(value), ms));

export const MOCK_SESSION: Session = {
  uid: "uid_office_01",
  name: "王淑芬（生活教育組長）",
  roles: ["DISCIPLINE_STAFF", "ADMIN"],
  email: "discipline@example.edu.tw",
};

/** 示範模式的設定與帳號清單（存在記憶體，重新整理即重置） */
const mockSettings: SystemSettings = {
  recidivismWindowDays: 15,
  recidivismThreshold: 3,
  cardFromOffense: CARD_FROM_OFFENSE,
  observerPeriods: 5,
  observerPeriodNumbers: [1, 2, 3, 4, 5],
  carryOverUnfinished: true,
  publicBoard: { enabled: true, showRoster: false },
};

const mockUsers: AccessUser[] = [
  {
    email: "admin@example.edu.tw",
    uid: "uid_admin_01",
    name: "資訊組（管理者）",
    roles: ["ADMIN", "DISCIPLINE_STAFF"],
    active: true,
    signedInBefore: true,
  },
  {
    email: "discipline@example.edu.tw",
    uid: "uid_office_01",
    name: "王淑芬（生活教育組長）",
    roles: ["DISCIPLINE_STAFF"],
    active: true,
    signedInBefore: true,
  },
];

const TYPES: InfractionTypeOption[] = [
  {
    code: "RUN_IN_CORRIDOR",
    name: "走廊奔跑",
    paperCard: "SAFETY",
    paperCardLabel: "校園安全反思卡",
    icon: "🏃",
  },
  {
    code: "FOUL_LANGUAGE",
    name: "口出穢言",
    paperCard: "KIND_WORDS",
    paperCardLabel: "口說好話反思卡",
    icon: "💬",
  },
];

const LOCATIONS: LocationOption[] = [
  { code: "CORRIDOR_2F", name: "二樓走廊", isHotspot: true },
  { code: "CORRIDOR_3F", name: "三樓走廊", isHotspot: true },
  { code: "STAIRS_A", name: "A 棟樓梯", isHotspot: true },
  { code: "LOBBY", name: "川堂", isHotspot: false },
  { code: "PLAYGROUND", name: "操場", isHotspot: false },
  { code: "CAFETERIA", name: "餐廳", isHotspot: false },
];

interface MockStudent {
  id: string;
  studentNo: string;
  name: string;
  classId: string;
  className: string;
  seatNo: number;
}

/**
 * 示範名冊：6 個班、24 位學生。
 * 真實環境的名冊來自「系統設定 → 學生名冊」匯入，這裡只是讓示範模式
 * 看得出搜尋、班級座號選擇與統計圖表的實際樣子。
 */
const STUDENTS: MockStudent[] = [
  ["stu_701_01", "1140101", "王小明", "cls_701", "七年一班", 1],
  ["stu_701_02", "1140102", "李小華", "cls_701", "七年一班", 2],
  ["stu_701_03", "1140103", "吳承翰", "cls_701", "七年一班", 3],
  ["stu_701_04", "1140104", "林佳蓉", "cls_701", "七年一班", 4],
  ["stu_701_05", "1140105", "張晉維", "cls_701", "七年一班", 5],
  ["stu_702_01", "1140201", "陳小美", "cls_702", "七年二班", 1],
  ["stu_702_02", "1140202", "黃品云", "cls_702", "七年二班", 2],
  ["stu_702_03", "1140203", "周立翔", "cls_702", "七年二班", 3],
  ["stu_702_04", "1140204", "蔡宜蓁", "cls_702", "七年二班", 4],
  ["stu_801_01", "1130101", "許家豪", "cls_801", "八年一班", 1],
  ["stu_801_02", "1130102", "鄭雅筑", "cls_801", "八年一班", 2],
  ["stu_801_03", "1130103", "劉柏宇", "cls_801", "八年一班", 3],
  ["stu_802_01", "1130201", "簡妤安", "cls_802", "八年二班", 1],
  ["stu_802_05", "1130205", "黃彥霖", "cls_802", "八年二班", 5],
  ["stu_802_06", "1130206", "徐子晴", "cls_802", "八年二班", 6],
  ["stu_802_07", "1130207", "何昱辰", "cls_802", "八年二班", 7],
  ["stu_901_01", "1120101", "廖婉瑜", "cls_901", "九年一班", 1],
  ["stu_901_02", "1120102", "邱冠廷", "cls_901", "九年一班", 2],
  ["stu_901_03", "1120103", "楊思妤", "cls_901", "九年一班", 3],
  ["stu_901_04", "1120104", "賴宗翰", "cls_901", "九年一班", 4],
  ["stu_902_01", "1120201", "謝宜靜", "cls_902", "九年二班", 1],
  ["stu_902_02", "1120202", "呂承恩", "cls_902", "九年二班", 2],
  ["stu_902_03", "1120203", "曾小軒", "cls_902", "九年二班", 3],
  ["stu_902_04", "1120204", "洪梓瑜", "cls_902", "九年二班", 4],
].map(([id, studentNo, name, classId, className, seatNo]) => ({
  id: id as string,
  studentNo: studentNo as string,
  name: name as string,
  classId: classId as string,
  className: className as string,
  seatNo: seatNo as number,
}));

interface MockInfraction extends InfractionRow {
  countsTowardRecidivism: boolean;
  consumedByAlertId: string | null;
  /** 是否發了紙本反思卡（期間內第一次只記錄勸導 → false） */
  cardIssued: boolean;
}

class MockStore {
  today = todayTaipei();
  infractions: MockInfraction[] = [];
  restrictions: RestrictionRow[] = [];
  alerts: AlertRow[] = [];
  assignments: AssignmentRow[] = [];
  /** 設定：公開看板是否列出班級＋座號（預設否，只顯示統計） */
  showRoster = false;

  constructor() {
    // 王小明：15 天內已 2 次（再 1 次即觸發）
    this.add("stu_701_01", -9, "RUN_IN_CORRIDOR", "CORRIDOR_3F", 2, "DONE");
    this.add("stu_701_01", -4, "FOUL_LANGUAGE", "LOBBY", 4, "DONE");
    // 今日待回收紙本
    this.add("stu_701_02", 0, "RUN_IN_CORRIDOR", "CORRIDOR_2F", 2, "OPEN");
    this.add("stu_701_03", 0, "FOUL_LANGUAGE", "CAFETERIA", 3, "OPEN");
    // 黃彥霖：已觸發再犯，今日值勤中
    const ids = [-12, -6, -2].map((offset) =>
      this.add(
        "stu_802_05",
        offset,
        offset === -6 ? "FOUL_LANGUAGE" : "RUN_IN_CORRIDOR",
        "CORRIDOR_2F",
        1,
        "DONE",
      ),
    );
    this.triggerFor("stu_802_05", ids, this.today, "IN_PROGRESS");

    // 其他班級的零星紀錄：讓趨勢圖與熱點統計看得出分布
    this.add("stu_702_02", -11, "RUN_IN_CORRIDOR", "STAIRS_A", 1, "DONE");
    this.add("stu_801_02", -10, "FOUL_LANGUAGE", "PLAYGROUND", 3, "DONE");
    this.add("stu_901_02", -8, "RUN_IN_CORRIDOR", "CORRIDOR_2F", 2, "DONE");
    this.add("stu_902_03", -7, "RUN_IN_CORRIDOR", "CORRIDOR_3F", 4, "DONE");
    this.add("stu_801_03", -5, "FOUL_LANGUAGE", "CAFETERIA", 3, "DONE");
    this.add("stu_902_03", -3, "FOUL_LANGUAGE", "LOBBY", 1, "DONE");
    this.add("stu_701_04", -2, "RUN_IN_CORRIDOR", "STAIRS_A", 5, "DONE");
    this.add("stu_901_04", -1, "RUN_IN_CORRIDOR", "CORRIDOR_2F", 2, "DONE");
    this.add("stu_802_06", 0, "RUN_IN_CORRIDOR", "CORRIDOR_3F", 1, "OPEN");
  }

  student(id: string): MockStudent {
    const found = STUDENTS.find((s) => s.id === id);
    if (!found) throw new Error(`查無學生 ${id}`);
    return found;
  }

  add(
    studentId: string,
    dayOffset: number,
    typeCode: string,
    locationCode: string,
    periodNo: number,
    status: InfractionRow["status"],
  ): string {
    const student = this.student(studentId);
    const type = TYPES.find((t) => t.code === typeCode)!;
    const location = LOCATIONS.find((l) => l.code === locationCode)!;
    const occurredOn = shift(this.today, dayOffset);
    const at = `${occurredOn}T02:10:00.000Z`;
    const id = uid("inf");

    this.infractions.unshift({
      id,
      studentId: student.id,
      studentNo: student.studentNo,
      studentName: student.name,
      className: student.className,
      seatNo: student.seatNo,
      typeCode: type.code,
      typeName: type.name,
      paperCard: type.paperCard,
      occurredAt: at,
      occurredOn,
      periodNo,
      locationName: location.name,
      status,
      paperReturnedOn: status === "DONE" ? occurredOn : undefined,
      recordedBy: { uid: "uid_office_01", name: "王淑芬" },
      countsTowardRecidivism: true,
      consumedByAlertId: null,
      cardIssued: true,
    });

    if (status === "OPEN") {
      this.freeze(
        student,
        occurredOn,
        "INFRACTION_PAPER",
        `${type.name}｜待回收${type.paperCardLabel}`,
      );
    }
    return id;
  }

  freeze(
    student: MockStudent,
    date: string,
    reason: RestrictionRow["reasons"][number],
    note: string,
  ) {
    const id = `${student.id}_${date}`;
    const existing = this.restrictions.find((r) => r.id === id);
    if (existing) {
      if (!existing.reasons.includes(reason)) existing.reasons.push(reason);
      existing.status = "ACTIVE";
      existing.note = note;
      return;
    }
    this.restrictions.push({
      id,
      studentId: student.id,
      studentNo: student.studentNo,
      studentName: student.name,
      className: student.className,
      seatNo: student.seatNo,
      date,
      reasons: [reason],
      status: "ACTIVE",
      note,
    });
  }

  lift(
    studentId: string,
    date: string,
    reason: RestrictionRow["reasons"][number],
  ) {
    const row = this.restrictions.find((r) => r.id === `${studentId}_${date}`);
    if (!row) return;
    row.reasons = row.reasons.filter((r) => r !== reason);
    if (row.reasons.length === 0) row.status = "LIFTED";
  }

  /** 與後端相同規則：15 天內未認列、未免記/撤銷的違規次數 */
  countWindow(studentId: string, asOf = this.today): number {
    const windowStart = shift(asOf, -(WINDOW_DAYS - 1));
    return this.infractions.filter(
      (item) =>
        item.studentId === studentId &&
        item.countsTowardRecidivism &&
        item.consumedByAlertId === null &&
        (item.status === "OPEN" || item.status === "DONE") &&
        item.occurredOn >= windowStart &&
        item.occurredOn <= asOf,
    ).length;
  }

  progress(studentId: string, asOf = this.today) {
    const count = this.countWindow(studentId, asOf);
    return {
      count,
      threshold: THRESHOLD,
      shortfall: Math.max(0, THRESHOLD - count),
      windowStart: shift(asOf, -(WINDOW_DAYS - 1)),
      windowEnd: asOf,
    };
  }

  nextSchoolDay(from: string): string {
    let cursor = shift(from, 1);
    for (let i = 0; i < 10; i += 1) {
      const dow = new Date(`${cursor}T00:00:00Z`).getUTCDay();
      if (dow !== 0 && dow !== 6) return cursor;
      cursor = shift(cursor, 1);
    }
    return cursor;
  }

  private triggerFor(
    studentId: string,
    infractionIds: string[],
    dutyOn: string,
    assignmentStatus: AssignmentRow["status"],
  ): AlertRow {
    const student = this.student(studentId);
    const alertId = uid("alert");
    const assignmentId = uid("asg");
    const counted = this.infractions.filter((i) =>
      infractionIds.includes(i.id),
    );
    for (const item of counted) item.consumedByAlertId = alertId;

    const alert: AlertRow = {
      id: alertId,
      studentId,
      studentNo: student.studentNo,
      studentName: student.name,
      className: student.className,
      triggeredAt: nowIso(),
      windowStart: shift(this.today, -(WINDOW_DAYS - 1)),
      windowEnd: this.today,
      windowDays: WINDOW_DAYS,
      count: counted.length,
      threshold: THRESHOLD,
      status: "ASSIGNED",
      assignmentId,
      dutyOn,
      breakdown: counted.map((i) => ({
        infractionId: i.id,
        typeName: i.typeName,
        occurredOn: i.occurredOn,
      })),
    };
    this.alerts.unshift(alert);
    this.assignments.unshift({
      id: assignmentId,
      alertId,
      studentId,
      studentNo: student.studentNo,
      studentName: student.name,
      className: student.className,
      dutyOn,
      status: assignmentStatus,
      totalPeriods: 5,
      periodLogs:
        assignmentStatus === "IN_PROGRESS"
          ? [
              {
                periodNo: 1,
                checkInAt: `${dutyOn}T01:20:00.000Z`,
                checkOutAt: `${dutyOn}T01:30:00.000Z`,
                observedCount: 3,
                note: "三樓走廊提醒 3 位同學",
              },
              {
                periodNo: 2,
                checkInAt: `${dutyOn}T02:20:00.000Z`,
                checkOutAt: `${dutyOn}T02:30:00.000Z`,
                observedCount: 1,
              },
              { periodNo: 3 },
              { periodNo: 4 },
              { periodNo: 5 },
            ]
          : [1, 2, 3, 4, 5].map((periodNo) => ({ periodNo })),
    });
    this.freeze(student, dutyOn, "OBSERVER_DUTY", "安全觀察員值勤（5 節）");
    return alert;
  }

  evaluate(studentId: string, asOf: string): AlertRow | null {
    const windowStart = shift(asOf, -(WINDOW_DAYS - 1));
    const counted = this.infractions.filter(
      (item) =>
        item.studentId === studentId &&
        item.countsTowardRecidivism &&
        item.consumedByAlertId === null &&
        (item.status === "OPEN" || item.status === "DONE") &&
        item.occurredOn >= windowStart &&
        item.occurredOn <= asOf,
    );
    if (counted.length < THRESHOLD) return null;
    return this.triggerFor(
      studentId,
      counted.map((i) => i.id),
      this.nextSchoolDay(this.today),
      "SCHEDULED",
    );
  }
}

const store = new MockStore();

const watchlist = (): WatchlistRow[] =>
  STUDENTS.map((s) => {
    const p = store.progress(s.id);
    return {
      studentId: s.id,
      studentNo: s.studentNo,
      studentName: s.name,
      className: s.className,
      count: p.count,
      shortfall: p.shortfall,
    };
  })
    .filter((row) => row.count > 0 && row.shortfall > 0)
    .sort((a, b) => b.count - a.count);

const buildTrend = () =>
  Array.from({ length: 14 }, (_, index) => {
    const date = shift(store.today, index - 13);
    const sameDay = store.infractions.filter(
      (i) =>
        i.occurredOn === date &&
        i.status !== "VOIDED" &&
        i.status !== "EXEMPTED",
    );
    return {
      date,
      safety: sameDay.filter((i) => i.paperCard === "SAFETY").length,
      kindWords: sameDay.filter((i) => i.paperCard === "KIND_WORDS").length,
    };
  });

const buildHotspots = () => {
  const map = new Map<string, number>();
  for (const item of store.infractions) {
    if (item.status === "VOIDED") continue;
    map.set(item.locationName, (map.get(item.locationName) ?? 0) + 1);
  }
  return [...map.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);
};

export const mockApi = {
  progress: (studentId: string) => delay(store.progress(studentId)),

  infractionTypes: () => delay(TYPES),
  locations: () => delay(LOCATIONS),

  dashboard: (): Promise<DashboardData> => {
    const today = store.today;
    const restrictions = store.restrictions.filter((r) => r.date === today);
    const pendingPapers = store.infractions
      .filter((i) => i.status === "OPEN")
      .map((i) => ({ ...i, windowCount: store.countWindow(i.studentId) }));
    const alerts = store.alerts.filter(
      (a) => a.status !== "CLOSED" && a.status !== "DISMISSED",
    );
    const assignments = store.assignments.filter(
      (a) => a.status !== "CLOSED" && a.status !== "CANCELLED",
    );
    const list = watchlist();

    return delay({
      today,
      kpis: {
        restrictedActive: restrictions.filter((r) => r.status === "ACTIVE")
          .length,
        pendingPapers: pendingPapers.length,
        openAlerts: alerts.length,
        observersToday: assignments.filter((a) => a.dutyOn === today).length,
        infractionsToday: store.infractions.filter(
          (i) => i.occurredOn === today,
        ).length,
        watchlist: list.length,
      },
      restrictions,
      pendingPapers,
      alerts,
      assignments,
      trend: buildTrend(),
      hotspots: buildHotspots(),
      watchlist: list,
    });
  },

  publicBoard: (): Promise<PublicBoardData> => {
    const today = store.today;
    const restrictions = store.restrictions.filter(
      (r) => r.date === today && r.status === "ACTIVE",
    );
    const assignments = store.assignments.filter((a) => a.dutyOn === today);
    const counted = store.infractions.filter(
      (i) => i.status !== "VOIDED" && i.status !== "EXEMPTED",
    );
    return delay({
      enabled: true,
      date: today,
      updatedAt: nowIso(),
      stats: {
        restrictedCount: restrictions.length,
        openAlerts: store.alerts.filter(
          (a) => a.status === "OPEN" || a.status === "ASSIGNED",
        ).length,
        observersToday: assignments.length,
        infractionsToday: counted.filter((i) => i.occurredOn === today).length,
        infractions14d: counted.length,
      },
      trend: buildTrend(),
      hotspots: buildHotspots(),
      ...(store.showRoster
        ? {
            roster: restrictions.map((r) => ({
              className: r.className,
              seatNo: r.seatNo ?? null,
              reasons: r.reasons,
            })),
            observers: assignments.map((a) => ({
              className: a.className,
              seatNo: null,
              periodsDone: a.periodLogs.filter((p) => p.checkOutAt).length,
              totalPeriods: a.totalPeriods,
            })),
          }
        : {}),
    });
  },

  pendingPapers: () =>
    delay(
      store.infractions
        .filter((i) => i.status === "OPEN")
        .map((i) => ({ ...i, windowCount: store.countWindow(i.studentId) })),
    ),

  infractions: (limit = 100) =>
    delay(
      store.infractions
        .slice(0, limit)
        .map((i) => ({ ...i, windowCount: store.countWindow(i.studentId) })),
    ),

  alerts: () => delay([...store.alerts]),
  assignments: () => delay([...store.assignments]),
  restrictions: (date: string) =>
    delay(store.restrictions.filter((r) => r.date === date)),

  classList: () => delay([...new Set(STUDENTS.map((s) => s.className))].sort()),

  classRoster: (className: string) =>
    delay(
      STUDENTS.filter((s) => s.className === className)
        .sort((a, b) => (a.seatNo ?? 0) - (b.seatNo ?? 0))
        .map((s) => ({
          id: s.id,
          studentNo: s.studentNo,
          name: s.name,
          className: s.className,
          seatNo: s.seatNo,
          active: true,
          windowCount: store.countWindow(s.id),
        })),
    ),

  /** 比對規則與正式環境一致（見 core/domain/studentSearch.ts）：學號／姓名／班級 */
  firstOffenders: () => {
    const windowStart = shift(store.today, -(WINDOW_DAYS - 1));
    const byStudent = new Map<string, MockInfraction[]>();
    for (const item of store.infractions) {
      if (item.occurredOn < windowStart) continue;
      if (item.status === "VOIDED" || item.status === "EXEMPTED") continue;
      if (!item.countsTowardRecidivism || item.consumedByAlertId) continue;
      byStudent.set(item.studentId, [
        ...(byStudent.get(item.studentId) ?? []),
        item,
      ]);
    }
    return delay(
      [...byStudent.values()]
        .filter((items) => items.length === 1)
        .map((items) => {
          const item = items[0]!;
          const expiresOn = shift(item.occurredOn, WINDOW_DAYS - 1);
          return {
            studentId: item.studentId,
            studentNo: item.studentNo,
            studentName: item.studentName,
            className: item.className,
            ...(item.seatNo === undefined ? {} : { seatNo: item.seatNo }),
            infractionId: item.id,
            occurredOn: item.occurredOn,
            typeName: item.typeName,
            locationName: item.locationName,
            periodNo: item.periodNo,
            cardIssued: item.cardIssued,
            expiresOn,
            daysLeft: Math.max(
              0,
              Math.round(
                (Date.parse(`${expiresOn}T00:00:00Z`) -
                  Date.parse(`${store.today}T00:00:00Z`)) /
                  86400000,
              ),
            ),
            ...(item.note ? { note: item.note } : {}),
          };
        })
        .sort((a, b) => b.occurredOn.localeCompare(a.occurredOn)),
    );
  },

  searchStudent: (keyword: string) => {
    const q = keyword.trim();
    if (!q) return delay([]);
    return delay(
      matchStudents(
        STUDENTS.map((s) => ({
          id: s.id,
          studentNo: s.studentNo,
          name: s.name,
          className: s.className,
          seatNo: s.seatNo,
          active: true,
          window: [],
        })),
        q,
        store.today,
      ).map((hit) => ({
        ...hit,
        windowCount: store.countWindow(hit.id),
      })),
    );
  },

  student: (studentId: string): Promise<StudentDetail> => {
    const student = store.student(studentId);
    const history = store.infractions.filter((i) => i.studentId === studentId);
    const alerts = store.alerts.filter((a) => a.studentId === studentId);
    const duties = store.assignments.filter((a) => a.studentId === studentId);
    return delay({
      id: student.id,
      studentNo: student.studentNo,
      name: student.name,
      className: student.className,
      seatNo: student.seatNo,
      progress: store.progress(student.id),
      totals: {
        infractions: history.length,
        alerts: alerts.length,
        duties: duties.length,
      },
      history,
      alerts,
      restrictedToday: store.restrictions.some(
        (r) =>
          r.studentId === studentId &&
          r.date === store.today &&
          r.status === "ACTIVE",
      ),
    });
  },

  createInfraction: async (input: CreateInfractionInput) => {
    const student = STUDENTS.find(
      (s) => s.studentNo === input.studentNo.trim(),
    );
    if (!student) throw new Error(`查無學號 ${input.studentNo} 的學生`);
    const type = TYPES.find((t) => t.code === input.typeCode);
    if (!type) throw new Error("請選擇違規類型");
    // 期間內第一次只做記錄勸導：不發卡、不凍結下課
    const offenseIndex = store.countWindow(student.id) + 1;
    const cardIssued = offenseIndex >= CARD_FROM_OFFENSE;
    const id = store.add(
      student.id,
      0,
      input.typeCode,
      input.locationCode,
      input.periodNo,
      cardIssued ? "OPEN" : "DONE",
    );
    const target = store.infractions.find((i) => i.id === id)!;
    target.note = input.note;
    target.cardIssued = cardIssued;
    if (!cardIssued) {
      // 沒發卡就沒有待回收的紙本
      target.paperReturnedOn = undefined;
      target.paperCardLabel = undefined;
    }
    const alert = store.evaluate(student.id, store.today);
    return delay({
      infractionId: id,
      studentId: student.id,
      studentName: student.name,
      className: student.className,
      paperCardLabel: cardIssued ? type.paperCardLabel : null,
      cardIssued,
      offenseIndex,
      recidivism: {
        triggered: Boolean(alert),
        count: alert ? alert.count : store.countWindow(student.id),
        shortfall: alert
          ? 0
          : Math.max(0, THRESHOLD - store.countWindow(student.id)),
        dutyOn: alert?.dutyOn,
      },
    });
  },

  returnPaperCard: async (infractionId: string) => {
    const item = store.infractions.find((i) => i.id === infractionId);
    if (!item) throw new Error("查無此案件");
    if (item.status !== "OPEN") throw new Error("只有待回收的案件可標記回收");
    item.status = "DONE";
    item.paperReturnedOn = store.today;
    store.lift(item.studentId, item.occurredOn, "INFRACTION_PAPER");
    store.lift(item.studentId, store.today, "INFRACTION_PAPER");
    return delay({ status: "DONE", unlockOn: store.today });
  },

  annotate: async (
    infractionId: string,
    action: "EXEMPT" | "VOID",
    reason: string,
  ) => {
    const item = store.infractions.find((i) => i.id === infractionId);
    if (!item) throw new Error("查無此案件");
    if (!reason.trim()) throw new Error("請填寫事由");
    if (item.status === "EXEMPTED" || item.status === "VOIDED")
      throw new Error("案件已結案");
    item.status = action === "EXEMPT" ? "EXEMPTED" : "VOIDED";
    item.countsTowardRecidivism = false;
    if (action === "EXEMPT") item.exemptReason = reason;
    else item.voidReason = reason;
    store.lift(item.studentId, item.occurredOn, "INFRACTION_PAPER");
    return delay({ ok: true });
  },

  logObserverPeriod: async (input: {
    assignmentId: string;
    periodNo: number;
    action: "CHECK_IN" | "CHECK_OUT";
    observedCount?: number;
    note?: string;
  }) => {
    const assignment = store.assignments.find(
      (a) => a.id === input.assignmentId,
    );
    if (!assignment) throw new Error("查無派單");
    const log = assignment.periodLogs.find(
      (p) => p.periodNo === input.periodNo,
    );
    if (!log) throw new Error("查無該節次");
    if (input.action === "CHECK_IN") {
      if (log.checkInAt) throw new Error(`第 ${input.periodNo} 節已報到`);
      log.checkInAt = nowIso();
      assignment.status = "IN_PROGRESS";
    } else {
      if (!log.checkInAt) throw new Error(`第 ${input.periodNo} 節尚未報到`);
      log.checkOutAt = nowIso();
      log.observedCount = input.observedCount ?? log.observedCount ?? 0;
      log.note = input.note ?? log.note;
    }
    const done = assignment.periodLogs.filter((p) => p.checkOutAt).length;
    if (done >= assignment.totalPeriods) assignment.status = "DUTY_COMPLETED";
    return delay({ status: assignment.status, completedPeriods: done });
  },

  returnConductReview: async (assignmentId: string) => {
    const assignment = store.assignments.find((a) => a.id === assignmentId);
    if (!assignment) throw new Error("查無派單");
    if (assignment.status === "SCHEDULED")
      throw new Error("尚未開始值勤，無法回收檢討書");
    const unlockOn = store.nextSchoolDay(store.today);
    assignment.status = "CLOSED";
    assignment.reviewReturnedOn = store.today;
    assignment.unlockOn = unlockOn;
    const alert = store.alerts.find((a) => a.id === assignment.alertId);
    if (alert) alert.status = "CLOSED";
    store.lift(assignment.studentId, unlockOn, "OBSERVER_REVIEW_PENDING");
    return delay({ unlockOn });
  },

  rescheduleDuty: async (assignmentId: string, dutyOn: string) => {
    const assignment = store.assignments.find((a) => a.id === assignmentId);
    if (!assignment) throw new Error("查無派單");
    store.lift(assignment.studentId, assignment.dutyOn, "OBSERVER_DUTY");
    assignment.dutyOn = dutyOn;
    store.freeze(
      store.student(assignment.studentId),
      dutyOn,
      "OBSERVER_DUTY",
      "安全觀察員值勤（改期）",
    );
    const alert = store.alerts.find((a) => a.assignmentId === assignmentId);
    if (alert) alert.dutyOn = dutyOn;
    return delay({ ok: true });
  },

  dismissAlert: async (alertId: string, reason: string) => {
    const alert = store.alerts.find((a) => a.id === alertId);
    if (!alert) throw new Error("查無警示");
    if (!reason.trim()) throw new Error("請填寫撤銷理由");
    alert.status = "DISMISSED";
    for (const item of alert.breakdown) {
      const infraction = store.infractions.find(
        (i) => i.id === item.infractionId,
      );
      if (infraction) infraction.consumedByAlertId = null;
    }
    const assignment = store.assignments.find(
      (a) => a.id === alert.assignmentId,
    );
    if (assignment) {
      assignment.status = "CANCELLED";
      store.lift(alert.studentId, assignment.dutyOn, "OBSERVER_DUTY");
    }
    return delay({ ok: true });
  },

  settings: () => delay({ ...mockSettings }),

  updateSettings: async (patch: Partial<SystemSettings>) => {
    Object.assign(mockSettings, patch);
    if (patch.observerPeriodNumbers) {
      mockSettings.observerPeriods = patch.observerPeriodNumbers.length;
    }
    if (patch.publicBoard) {
      mockSettings.publicBoard = {
        ...mockSettings.publicBoard,
        ...patch.publicBoard,
      };
      store.showRoster = mockSettings.publicBoard.showRoster;
    }
    return delay({ ok: true, settings: { ...mockSettings } });
  },

  listAccess: () =>
    delay({
      users: mockUsers.map((user) => ({ ...user })),
      bootstrapAdmins: ["admin@example.edu.tw"],
    }),

  grantAccess: async (email: string, roles: Role[], name?: string) => {
    const normalized = email.trim().toLowerCase();
    if (!normalized.includes("@")) throw new Error("請輸入有效的 Google 信箱");
    if (roles.length === 0) throw new Error("請至少指派一個角色");
    const existing = mockUsers.find((user) => user.email === normalized);
    if (existing) {
      existing.roles = roles;
      existing.active = true;
      if (name) existing.name = name;
    } else {
      mockUsers.push({
        email: normalized,
        name: name ?? null,
        roles,
        active: true,
        signedInBefore: false,
      });
    }
    return delay({
      ok: true,
      email: normalized,
      roles,
      appliedImmediately: Boolean(existing),
    });
  },

  revokeAccess: async (email: string) => {
    const normalized = email.trim().toLowerCase();
    if (normalized === "admin@example.edu.tw") {
      throw new Error("此信箱列於部署設定 ADMIN_EMAILS，請先自該設定移除");
    }
    const user = mockUsers.find((item) => item.email === normalized);
    if (user) {
      user.active = false;
      user.roles = [];
    }
    return delay({ ok: true });
  },
};
