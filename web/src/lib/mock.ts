/**
 * 前端模擬資料層（VITE_USE_MOCK=true 或未設定 Firebase 金鑰時啟用）
 *
 * 目的：
 *  1. 讓 UI 可在 GitHub Pages 上直接試操作（無需開通 Firebase 專案）。
 *  2. 以與後端相同的規則（15 天 / 3 張、雙重審核、當日/隔日解鎖）
 *     模擬完整流程，方便生教組在導入前確認操作動線。
 *
 * 注意：此檔僅供示範，真正的判定一律以 Cloud Functions 為準。
 */
import { todayTaipei } from './format.ts';
import type {
  AlertRow,
  AssignmentRow,
  CardDetail,
  CardSummary,
  CreateInfractionInput,
  DashboardData,
  FormTemplate,
  InfractionTypeOption,
  LocationOption,
  RestrictionRow,
  ReviewInput,
  Session,
  StudentDetail,
  StudentTimelineItem,
} from './types.ts';

const WINDOW_DAYS = 15;
const THRESHOLD = 3;

const shift = (date: string, days: number): string => {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
};
const nowIso = () => new Date().toISOString();
const uid = (prefix: string) => `${prefix}_${Math.random().toString(36).slice(2, 8)}`;

export const MOCK_SESSIONS: Record<string, Session> = {
  office: { uid: 'uid_office_01', name: '王淑芬', roles: ['DISCIPLINE_STAFF'], email: 'discipline@example.edu.tw' },
  teacher: { uid: 'uid_teacher_701', name: '陳怡君', roles: ['HOMEROOM_TEACHER'], email: 'teacher701@example.edu.tw' },
  patrol: { uid: 'uid_patrol_01', name: '張家豪', roles: ['PATROL'] },
  student: { uid: 'uid_stu_701_02', name: '李小華', roles: ['STUDENT'], studentId: 'stu_701_02' },
};

const SAFETY_TEMPLATE: FormTemplate = {
  id: 'SAFETY_REFLECTION_V1',
  title: '校園安全反思卡',
  subtitle: '適用：走廊奔跑',
  guidance: '這張卡不是處罰，而是幫你想清楚「怎麼保護自己與同學」。填寫期間你可以正常飲水與如廁。',
  sections: [
    {
      id: 'review',
      title: '一、事件回顧',
      questions: [
        { id: 'what_happened', type: 'textarea', label: '我在什麼時間、哪個地點、做了什麼？', required: true, minLength: 20, placeholder: '例：第二節下課，我在三樓走廊為了趕去操場而奔跑。' },
        { id: 'speed_reason', type: 'choice', label: '當時為什麼會跑？', required: true, options: ['趕時間', '跟同學追逐', '情緒激動', '沒注意到規定', '其他'] },
      ],
    },
    {
      id: 'risk',
      title: '二、風險思考',
      questions: [
        { id: 'possible_risks', type: 'multiselect', label: '走廊奔跑可能造成哪些危險？（可多選）', required: true, options: ['撞到同學', '自己跌倒受傷', '撞到轉角來人', '撞倒門窗或布告', '影響其他班上課', '造成他人恐慌'] },
        { id: 'risk_story', type: 'textarea', label: '請描述一個「如果那時撞到人」可能發生的後果', required: true, minLength: 20 },
      ],
    },
    {
      id: 'commit',
      title: '三、改善承諾',
      questions: [
        { id: 'next_time', type: 'textarea', label: '下次遇到同樣情況，我會怎麼做？（具體作法）', required: true, minLength: 30 },
        { id: 'safety_tip', type: 'text', label: '我可以用一句話提醒同學注意走廊安全', required: true },
        { id: 'self_rating', type: 'scale', label: '我對這次反思的認真程度（1-5）', required: true, min: 1, max: 5 },
      ],
    },
  ],
};

const WORDS_TEMPLATE: FormTemplate = {
  id: 'KIND_WORDS_REFLECTION_V1',
  title: '口說好話反思卡',
  subtitle: '適用：口出穢言',
  guidance: '語言會留在別人心裡很久。這張卡幫你練習把情緒說出來，而不是用傷人的話。填寫期間你可以正常飲水與如廁。',
  sections: [
    {
      id: 'review',
      title: '一、事件回顧',
      questions: [
        { id: 'what_said', type: 'textarea', label: '我當時說了什麼話？在什麼情況下說的？', required: true, minLength: 15 },
        { id: 'trigger', type: 'choice', label: '當時我的情緒最接近哪一種？', required: true, options: ['生氣', '覺得被嘲笑', '開玩笑', '習慣用語', '委屈難過', '其他'] },
      ],
    },
    {
      id: 'practice',
      title: '二、換句話說練習',
      questions: [
        { id: 'other_feeling', type: 'textarea', label: '如果有人對我說同樣的話，我會有什麼感受？', required: true, minLength: 20 },
        { id: 'rewrite', type: 'textarea', label: '把當時說的話，改寫成可以表達情緒又不傷人的說法', required: true, minLength: 20, placeholder: '例：我覺得被開玩笑很不舒服，可以請你停止嗎？' },
      ],
    },
    {
      id: 'commit',
      title: '三、改善承諾',
      questions: [
        { id: 'next_time', type: 'textarea', label: '下次情緒上來時，我會先做什麼？（具體作法）', required: true, minLength: 30 },
        { id: 'self_rating', type: 'scale', label: '我對這次反思的認真程度（1-5）', required: true, min: 1, max: 5 },
      ],
    },
  ],
};

export const MOCK_TEMPLATES: Record<string, FormTemplate> = {
  SAFETY_REFLECTION_V1: SAFETY_TEMPLATE,
  KIND_WORDS_REFLECTION_V1: WORDS_TEMPLATE,
};

interface MockStudent {
  id: string;
  studentNo: string;
  name: string;
  classId: string;
  className: string;
  guardianEmail?: string;
}

interface MockInfraction {
  id: string;
  studentId: string;
  typeCode: string;
  typeName: string;
  occurredAt: string;
  occurredOn: string;
  periodNo: number;
  locationName: string;
  description?: string;
  reporterName: string;
  reporterRole: Session['roles'][number];
  status: 'OPEN' | 'RESOLVED' | 'EXEMPTED' | 'VOIDED';
  cardId: string;
}

interface MockCard extends Omit<CardDetail, 'progress' | 'template' | 'infraction'> {
  templateId: string;
  infractionId: string;
  consumedByAlertId: string | null;
  countsTowardRecidivism: boolean;
}

const STUDENTS: MockStudent[] = [
  { id: 'stu_701_01', studentNo: '1140101', name: '王小明', classId: 'cls_701', className: '七年一班', guardianEmail: 'guardian1@example.com' },
  { id: 'stu_701_02', studentNo: '1140102', name: '李小華', classId: 'cls_701', className: '七年一班' },
  { id: 'stu_701_03', studentNo: '1140103', name: '吳承翰', classId: 'cls_701', className: '七年一班' },
  { id: 'stu_702_01', studentNo: '1140201', name: '陳小美', classId: 'cls_702', className: '七年二班' },
  { id: 'stu_802_05', studentNo: '1130205', name: '黃彥霖', classId: 'cls_802', className: '八年二班' },
];

const TYPES: InfractionTypeOption[] = [
  { code: 'RUN_IN_CORRIDOR', name: '走廊奔跑', formKind: 'SAFETY_REFLECTION', formTitle: '校園安全反思卡', hint: '安全類｜自動配發校園安全反思卡' },
  { code: 'FOUL_LANGUAGE', name: '口出穢言', formKind: 'KIND_WORDS_REFLECTION', formTitle: '口說好話反思卡', hint: '言語類｜自動配發口說好話反思卡' },
];

const LOCATIONS: LocationOption[] = [
  { code: 'CORRIDOR_2F', name: '二樓走廊', isHotspot: true },
  { code: 'CORRIDOR_3F', name: '三樓走廊', isHotspot: true },
  { code: 'STAIRS_A', name: 'A 棟樓梯', isHotspot: true },
  { code: 'LOBBY', name: '川堂', isHotspot: false },
  { code: 'PLAYGROUND', name: '操場', isHotspot: false },
  { code: 'CAFETERIA', name: '餐廳', isHotspot: false },
];

/** 模擬資料庫（單例，頁面間共享；重新整理即重置） */
class MockStore {
  today = todayTaipei();
  infractions: MockInfraction[] = [];
  cards: MockCard[] = [];
  restrictions: RestrictionRow[] = [];
  alerts: AlertRow[] = [];
  assignments: AssignmentRow[] = [];

  constructor() {
    this.seed();
  }

  private seed() {
    // 王小明：15 天內已完成 2 張（再 1 張即觸發累犯警示）
    this.addCase({
      studentId: 'stu_701_01',
      typeCode: 'RUN_IN_CORRIDOR',
      dayOffset: -9,
      periodNo: 2,
      locationName: '三樓走廊',
      status: 'COMPLETED',
      reporterName: '張家豪',
      reporterRole: 'PATROL',
    });
    this.addCase({
      studentId: 'stu_701_01',
      typeCode: 'FOUL_LANGUAGE',
      dayOffset: -4,
      periodNo: 4,
      locationName: '川堂',
      status: 'COMPLETED',
      reporterName: '王淑芬',
      reporterRole: 'DISCIPLINE_STAFF',
    });
    // 李小華：今日已導師簽章，待生教組蓋章（管制中）
    this.addCase({
      studentId: 'stu_701_02',
      typeCode: 'RUN_IN_CORRIDOR',
      dayOffset: 0,
      periodNo: 2,
      locationName: '二樓走廊',
      status: 'PENDING_OFFICE',
      reporterName: '王淑芬',
      reporterRole: 'DISCIPLINE_STAFF',
    });
    // 吳承翰：今日剛登錄，尚未填寫
    this.addCase({
      studentId: 'stu_701_03',
      typeCode: 'FOUL_LANGUAGE',
      dayOffset: 0,
      periodNo: 3,
      locationName: '餐廳',
      status: 'DRAFT',
      reporterName: '張家豪',
      reporterRole: 'PATROL',
    });
    // 陳小美：待導師簽章
    this.addCase({
      studentId: 'stu_702_01',
      typeCode: 'RUN_IN_CORRIDOR',
      dayOffset: -1,
      periodNo: 5,
      locationName: 'A 棟樓梯',
      status: 'PENDING_TEACHER',
      reporterName: '王淑芬',
      reporterRole: 'DISCIPLINE_STAFF',
    });

    // 黃彥霖：已觸發累犯，今日安全觀察員值勤中
    const cardIds = [-12, -6, -2].map((offset) =>
      this.addCase({
        studentId: 'stu_802_05',
        typeCode: offset === -6 ? 'FOUL_LANGUAGE' : 'RUN_IN_CORRIDOR',
        dayOffset: offset,
        periodNo: 1,
        locationName: '二樓走廊',
        status: 'COMPLETED',
        reporterName: '張家豪',
        reporterRole: 'PATROL',
      }),
    );
    const alertId = uid('alert');
    const assignmentId = uid('asg');
    const student = this.student('stu_802_05');
    this.alerts.push({
      id: alertId,
      studentId: student.id,
      studentNo: student.studentNo,
      studentName: student.name,
      className: student.className,
      triggeredAt: `${shift(this.today, -2)}T04:20:00.000Z`,
      windowStart: shift(this.today, -16),
      windowEnd: shift(this.today, -2),
      windowDays: WINDOW_DAYS,
      cardCount: 3,
      threshold: THRESHOLD,
      status: 'ASSIGNED',
      assignmentId,
      dutyOn: this.today,
      breakdown: cardIds.map((cardId) => {
        const card = this.cards.find((c) => c.id === cardId)!;
        return { cardId, formKind: card.formKind, countOn: card.countOn };
      }),
    });
    for (const cardId of cardIds) {
      const card = this.cards.find((c) => c.id === cardId)!;
      card.consumedByAlertId = alertId;
    }
    this.assignments.push({
      id: assignmentId,
      studentId: student.id,
      studentNo: student.studentNo,
      studentName: student.name,
      className: student.className,
      dutyOn: this.today,
      status: 'IN_PROGRESS',
      totalPeriods: 5,
      periodLogs: [
        { periodNo: 1, checkInAt: `${this.today}T01:20:00.000Z`, checkOutAt: `${this.today}T01:30:00.000Z`, observedCount: 3, note: '三樓走廊提醒 3 位同學' },
        { periodNo: 2, checkInAt: `${this.today}T02:20:00.000Z`, checkOutAt: `${this.today}T02:30:00.000Z`, observedCount: 1 },
        { periodNo: 3 },
        { periodNo: 4 },
        { periodNo: 5 },
      ],
    });
    this.restrictions.push({
      id: `${student.id}_${this.today}`,
      studentId: student.id,
      studentNo: student.studentNo,
      studentName: student.name,
      className: student.className,
      date: this.today,
      reasons: ['OBSERVER_DUTY'],
      status: 'ACTIVE',
      note: '安全觀察員值勤（5 節，扣除打掃與 5 分鐘短下課）',
      allowWaterAndRestroom: true,
    });
  }

  student(id: string): MockStudent {
    const found = STUDENTS.find((s) => s.id === id);
    if (!found) throw new Error(`查無學生 ${id}`);
    return found;
  }

  studentByNo(studentNo: string): MockStudent | undefined {
    return STUDENTS.find((s) => s.studentNo === studentNo.trim());
  }

  private addCase(input: {
    studentId: string;
    typeCode: string;
    dayOffset: number;
    periodNo: number;
    locationName: string;
    status: CardSummary['status'];
    reporterName: string;
    reporterRole: Session['roles'][number];
  }): string {
    const student = this.student(input.studentId);
    const type = TYPES.find((t) => t.code === input.typeCode)!;
    const occurredOn = shift(this.today, input.dayOffset);
    const at = `${occurredOn}T02:10:00.000Z`;
    const cardId = uid('card');
    const infractionId = uid('inf');

    this.infractions.push({
      id: infractionId,
      studentId: student.id,
      typeCode: type.code,
      typeName: type.name,
      occurredAt: at,
      occurredOn,
      periodNo: input.periodNo,
      locationName: input.locationName,
      reporterName: input.reporterName,
      reporterRole: input.reporterRole,
      status: input.status === 'COMPLETED' ? 'RESOLVED' : 'OPEN',
      cardId,
    });

    const approvals: CardDetail['approvals'] = [];
    if (input.status === 'PENDING_OFFICE' || input.status === 'COMPLETED') {
      approvals.push({ stage: 'HOMEROOM_TEACHER', decision: 'SIGNED', actorName: '陳怡君', actedAt: at });
    }
    if (input.status === 'COMPLETED') {
      approvals.push({ stage: 'DISCIPLINE_OFFICE', decision: 'SIGNED', actorName: '王淑芬', actedAt: at });
    }

    this.cards.push({
      id: cardId,
      studentId: student.id,
      studentNo: student.studentNo,
      studentName: student.name,
      className: student.className,
      typeName: type.name,
      formKind: type.formKind,
      formTitle: type.formTitle,
      status: input.status,
      countOn: occurredOn,
      submittedAt: input.status === 'DRAFT' ? undefined : at,
      teacherSignedAt: approvals.length > 0 ? at : undefined,
      teacherName: approvals.length > 0 ? '陳怡君' : undefined,
      returnCount: 0,
      templateId: type.formKind === 'SAFETY_REFLECTION' ? 'SAFETY_REFLECTION_V1' : 'KIND_WORDS_REFLECTION_V1',
      infractionId,
      consumedByAlertId: null,
      countsTowardRecidivism: true,
      answers:
        input.status === 'DRAFT'
          ? {}
          : {
              what_happened: `第${input.periodNo}節下課，我在${input.locationName}${type.code === 'RUN_IN_CORRIDOR' ? '奔跑追同學。' : '對同學說了不好的話。'}`,
              what_said: '（示範）我對同學說了不禮貌的話。',
              speed_reason: '趕時間',
              trigger: '生氣',
              possible_risks: ['撞到同學', '自己跌倒受傷'],
              other_feeling: '我會覺得難過，也不想再跟他講話。',
              risk_story: '如果轉角剛好有人走出來，兩個人都可能撞傷頭。',
              rewrite: '我覺得被開玩笑很不舒服，可以請你停下來嗎？',
              next_time: '下次我會提早出教室、在走廊改成快走，並提醒自己先看有沒有人。',
              safety_tip: '走廊慢慢走，安全帶回家。',
              self_rating: 4,
            },
      approvals,
    });

    if (input.status !== 'COMPLETED' && input.status !== 'DRAFT') {
      this.upsertRestriction(student, occurredOn, 'INFRACTION_REFLECTION', `${type.name}｜待完成${type.formTitle}`);
    }
    if (input.status === 'DRAFT') {
      this.upsertRestriction(student, occurredOn, 'INFRACTION_REFLECTION', `${type.name}｜尚未填寫${type.formTitle}`);
    }
    return cardId;
  }

  upsertRestriction(
    student: MockStudent,
    date: string,
    reason: RestrictionRow['reasons'][number],
    note: string,
  ) {
    const id = `${student.id}_${date}`;
    const existing = this.restrictions.find((r) => r.id === id);
    if (existing) {
      if (!existing.reasons.includes(reason)) existing.reasons.push(reason);
      existing.status = 'ACTIVE';
      existing.note = note;
      return;
    }
    this.restrictions.push({
      id,
      studentId: student.id,
      studentNo: student.studentNo,
      studentName: student.name,
      className: student.className,
      date,
      reasons: [reason],
      status: 'ACTIVE',
      note,
      allowWaterAndRestroom: true,
    });
  }

  liftRestriction(studentId: string, date: string, reason: RestrictionRow['reasons'][number]) {
    const row = this.restrictions.find((r) => r.id === `${studentId}_${date}`);
    if (!row) return;
    row.reasons = row.reasons.filter((r) => r !== reason);
    if (row.reasons.length === 0) row.status = 'LIFTED';
  }

  /** 與後端相同規則：15 天內未被認列、已送出且計入的卡片張數 */
  countWindow(studentId: string, asOf: string): number {
    const windowStart = shift(asOf, -(WINDOW_DAYS - 1));
    return this.cards.filter(
      (card) =>
        card.studentId === studentId &&
        card.countsTowardRecidivism &&
        card.consumedByAlertId === null &&
        ['PENDING_TEACHER', 'PENDING_OFFICE', 'COMPLETED'].includes(card.status) &&
        card.countOn >= windowStart &&
        card.countOn <= asOf,
    ).length;
  }

  progress(studentId: string, asOf = this.today) {
    const cardCount = this.countWindow(studentId, asOf);
    return {
      cardCount,
      threshold: THRESHOLD,
      shortfall: Math.max(0, THRESHOLD - cardCount),
      windowStart: shift(asOf, -(WINDOW_DAYS - 1)),
      windowEnd: asOf,
    };
  }

  /** 達門檻時建立警示 + 派單 + 值勤日管制（模擬 Cloud Function 交易） */
  evaluate(studentId: string, asOf: string, triggerCardId: string): AlertRow | null {
    const windowStart = shift(asOf, -(WINDOW_DAYS - 1));
    const counted = this.cards.filter(
      (card) =>
        card.studentId === studentId &&
        card.countsTowardRecidivism &&
        card.consumedByAlertId === null &&
        ['PENDING_TEACHER', 'PENDING_OFFICE', 'COMPLETED'].includes(card.status) &&
        card.countOn >= windowStart &&
        card.countOn <= asOf,
    );
    if (counted.length < THRESHOLD) return null;

    const student = this.student(studentId);
    const alertId = uid('alert');
    const assignmentId = uid('asg');
    const dutyOn = this.nextSchoolDay(this.today);

    for (const card of counted) card.consumedByAlertId = alertId;

    const alert: AlertRow = {
      id: alertId,
      studentId,
      studentNo: student.studentNo,
      studentName: student.name,
      className: student.className,
      triggeredAt: nowIso(),
      windowStart,
      windowEnd: asOf,
      windowDays: WINDOW_DAYS,
      cardCount: counted.length,
      threshold: THRESHOLD,
      status: 'ASSIGNED',
      assignmentId,
      dutyOn,
      breakdown: counted.map((card) => ({ cardId: card.id, formKind: card.formKind, countOn: card.countOn })),
    };
    this.alerts.unshift(alert);
    this.assignments.unshift({
      id: assignmentId,
      studentId,
      studentNo: student.studentNo,
      studentName: student.name,
      className: student.className,
      dutyOn,
      status: 'SCHEDULED',
      totalPeriods: 5,
      periodLogs: [1, 2, 3, 4, 5].map((periodNo) => ({ periodNo })),
    });
    this.upsertRestriction(student, dutyOn, 'OBSERVER_DUTY', '安全觀察員值勤（5 節）');
    void triggerCardId;
    return alert;
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
}

const store = new MockStore();

const toDetail = (card: MockCard): CardDetail => {
  const infraction = store.infractions.find((i) => i.id === card.infractionId)!;
  return {
    ...card,
    template: MOCK_TEMPLATES[card.templateId]!,
    windowCardCount: store.countWindow(card.studentId, card.countOn),
    infraction: {
      id: infraction.id,
      typeName: infraction.typeName,
      occurredAt: infraction.occurredAt,
      periodNo: infraction.periodNo,
      locationName: infraction.locationName,
      description: infraction.description,
      reporterName: infraction.reporterName,
      reporterRole: infraction.reporterRole,
    },
    progress: store.progress(card.studentId, card.countOn),
  };
};

const summary = (card: MockCard): CardSummary => ({
  id: card.id,
  studentId: card.studentId,
  studentNo: card.studentNo,
  studentName: card.studentName,
  className: card.className,
  typeName: card.typeName,
  formKind: card.formKind,
  formTitle: card.formTitle,
  status: card.status,
  countOn: card.countOn,
  submittedAt: card.submittedAt,
  teacherSignedAt: card.teacherSignedAt,
  teacherName: card.teacherName,
  returnCount: card.returnCount,
  windowCardCount: store.countWindow(card.studentId, card.countOn),
});

const delay = <T,>(value: T, ms = 140): Promise<T> =>
  new Promise((resolve) => setTimeout(() => resolve(value), ms));

export const mockApi = {
  infractionTypes: () => delay(TYPES),
  locations: () => delay(LOCATIONS),
  templates: () => delay(MOCK_TEMPLATES),

  dashboard: (): Promise<DashboardData> => {
    const today = store.today;
    const restrictions = store.restrictions.filter((r) => r.date === today);
    const officeQueue = store.cards.filter((c) => c.status === 'PENDING_OFFICE').map(summary);
    const pendingTeacher = store.cards.filter((c) => c.status === 'PENDING_TEACHER').length;
    const alerts = store.alerts.filter((a) => a.status !== 'CLOSED' && a.status !== 'DISMISSED');
    const assignments = store.assignments.filter(
      (a) => a.status !== 'CLOSED' && a.status !== 'CANCELLED',
    );

    const trend = Array.from({ length: 14 }, (_, index) => {
      const date = shift(today, index - 13);
      const dayCards = store.cards.filter((c) => c.countOn === date);
      return {
        date,
        safety: dayCards.filter((c) => c.formKind === 'SAFETY_REFLECTION').length,
        words: dayCards.filter((c) => c.formKind === 'KIND_WORDS_REFLECTION').length,
      };
    });

    const hotspotMap = new Map<string, number>();
    for (const infraction of store.infractions) {
      hotspotMap.set(infraction.locationName, (hotspotMap.get(infraction.locationName) ?? 0) + 1);
    }

    const atRisk = STUDENTS.filter((s) => {
      const count = store.countWindow(s.id, today);
      return count > 0 && count < THRESHOLD;
    }).length;

    return delay({
      today,
      kpis: {
        restrictedActive: restrictions.filter((r) => r.status === 'ACTIVE').length,
        pendingOffice: officeQueue.length,
        pendingTeacher,
        openAlerts: alerts.filter((a) => a.status === 'OPEN' || a.status === 'ASSIGNED').length,
        observersToday: assignments.filter((a) => a.dutyOn === today).length,
        atRiskStudents: atRisk,
      },
      restrictions,
      officeQueue,
      alerts,
      assignments,
      trend,
      hotspots: [...hotspotMap.entries()]
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 5),
    });
  },

  officeQueue: () => delay(store.cards.filter((c) => c.status === 'PENDING_OFFICE').map(summary)),
  teacherQueue: (classIds?: string[]) =>
    delay(
      store.cards
        .filter((c) => c.status === 'PENDING_TEACHER')
        .filter((c) => !classIds || classIds.length === 0 || classIds.includes(store.student(c.studentId).classId))
        .map(summary),
    ),
  studentCards: (studentId: string) =>
    delay(store.cards.filter((c) => c.studentId === studentId).map(summary)),
  card: (cardId: string) => {
    const card = store.cards.find((c) => c.id === cardId);
    if (!card) return Promise.reject(new Error('查無此反思卡'));
    return delay(toDetail(card));
  },
  alerts: () => delay([...store.alerts]),
  assignments: () => delay([...store.assignments]),
  restrictions: (date: string) => delay(store.restrictions.filter((r) => r.date === date)),

  searchStudent: (query: string) => {
    const q = query.trim();
    return delay(
      STUDENTS.filter((s) => s.studentNo.includes(q) || s.name.includes(q)).map((s) => ({
        id: s.id,
        studentNo: s.studentNo,
        name: s.name,
        className: s.className,
        windowCardCount: store.countWindow(s.id, store.today),
      })),
    );
  },

  student: (studentId: string): Promise<StudentDetail> => {
    const student = store.student(studentId);
    const infractions = store.infractions.filter((i) => i.studentId === studentId);
    const cards = store.cards.filter((c) => c.studentId === studentId);
    const alerts = store.alerts.filter((a) => a.studentId === studentId);
    const duties = store.assignments.filter((a) => a.studentId === studentId);

    const timeline: StudentTimelineItem[] = [
      ...infractions.map((i) => ({
        id: i.id,
        kind: 'INFRACTION' as const,
        title: `${i.typeName}｜${i.locationName}`,
        detail: `第 ${i.periodNo} 節・登錄者 ${i.reporterName}`,
        at: i.occurredAt,
        status: i.status,
      })),
      ...cards.map((c) => ({
        id: c.id,
        kind: 'CARD' as const,
        title: c.formTitle,
        detail: `狀態：${c.status}${c.teacherName ? `・導師 ${c.teacherName}` : ''}`,
        at: c.submittedAt ?? `${c.countOn}T00:00:00.000Z`,
        status: c.status,
      })),
      ...alerts.map((a) => ({
        id: a.id,
        kind: 'ALERT' as const,
        title: `累犯警示（${a.windowDays} 天 ${a.cardCount} 張）`,
        detail: `視窗 ${a.windowStart} ~ ${a.windowEnd}`,
        at: a.triggeredAt,
        status: a.status,
      })),
      ...duties.map((d) => ({
        id: d.id,
        kind: 'DUTY' as const,
        title: `安全觀察員值勤（${d.dutyOn}）`,
        detail: `已完成 ${d.periodLogs.filter((p) => p.checkOutAt).length}/${d.totalPeriods} 節`,
        at: `${d.dutyOn}T00:00:00.000Z`,
        status: d.status,
      })),
    ].sort((a, b) => (a.at < b.at ? 1 : -1));

    return delay({
      id: student.id,
      studentNo: student.studentNo,
      name: student.name,
      className: student.className,
      guardianEmail: student.guardianEmail,
      progress: store.progress(student.id),
      totals: {
        infractions: infractions.length,
        cards: cards.length,
        alerts: alerts.length,
        duties: duties.length,
      },
      timeline,
      restrictedToday: store.restrictions.some(
        (r) => r.studentId === student.id && r.date === store.today && r.status === 'ACTIVE',
      ),
    });
  },

  createInfraction: async (input: CreateInfractionInput) => {
    const student = store.studentByNo(input.studentNo);
    if (!student) throw new Error(`查無學號 ${input.studentNo} 的學生`);
    const type = TYPES.find((t) => t.code === input.typeCode);
    if (!type) throw new Error('請選擇違規類型');
    const location = LOCATIONS.find((l) => l.code === input.locationCode);

    const cardId = uid('card');
    const infractionId = uid('inf');
    const occurredOn = store.today;
    const at = input.occurredAt ?? nowIso();

    store.infractions.unshift({
      id: infractionId,
      studentId: student.id,
      typeCode: type.code,
      typeName: type.name,
      occurredAt: at,
      occurredOn,
      periodNo: input.periodNo,
      locationName: location?.name ?? input.locationCode,
      description: input.description,
      reporterName: '王淑芬',
      reporterRole: 'DISCIPLINE_STAFF',
      status: 'OPEN',
      cardId,
    });
    store.cards.unshift({
      id: cardId,
      studentId: student.id,
      studentNo: student.studentNo,
      studentName: student.name,
      className: student.className,
      typeName: type.name,
      formKind: type.formKind,
      formTitle: type.formTitle,
      status: 'DRAFT',
      countOn: occurredOn,
      returnCount: 0,
      templateId: type.formKind === 'SAFETY_REFLECTION' ? 'SAFETY_REFLECTION_V1' : 'KIND_WORDS_REFLECTION_V1',
      infractionId,
      consumedByAlertId: null,
      countsTowardRecidivism: true,
      answers: {},
      approvals: [],
    });
    store.upsertRestriction(student, occurredOn, 'INFRACTION_REFLECTION', `${type.name}｜待完成${type.formTitle}`);

    return delay({
      infractionId,
      cardId,
      formTitle: type.formTitle,
      studentName: student.name,
      className: student.className,
      notifiedTeacher: true,
      windowCardCount: store.countWindow(student.id, occurredOn),
    });
  },

  submitCard: async (cardId: string, answers: Record<string, unknown>) => {
    const card = store.cards.find((c) => c.id === cardId);
    if (!card) throw new Error('查無此反思卡');
    card.answers = answers;
    card.status = 'PENDING_TEACHER';
    card.submittedAt = nowIso();
    const alert = store.evaluate(card.studentId, card.countOn, card.id);
    return delay({ status: card.status, triggeredAlert: alert });
  },

  reviewCard: async (
    input: ReviewInput & { stage: 'HOMEROOM_TEACHER' | 'DISCIPLINE_OFFICE'; actorName: string },
  ) => {
    const card = store.cards.find((c) => c.id === input.cardId);
    if (!card) throw new Error('查無此反思卡');

    if (input.teacherActivityPriority) {
      card.status = 'EXEMPTED';
      card.countsTowardRecidivism = false;
      card.approvals.push({
        stage: 'HOMEROOM_TEACHER',
        decision: 'EXEMPTED',
        actorName: input.actorName,
        comment: input.exemptReason || '導師班級活動優先，該時段不計入處分',
        actedAt: nowIso(),
      });
      store.liftRestriction(card.studentId, card.countOn, 'INFRACTION_REFLECTION');
      const infraction = store.infractions.find((i) => i.id === card.infractionId);
      if (infraction) infraction.status = 'EXEMPTED';
      return delay({ status: card.status });
    }

    if (input.decision === 'RETURNED') {
      if (!input.comment?.trim()) throw new Error('退回補正必須填寫原因');
      card.status = 'RETURNED';
      card.returnCount += 1;
      card.approvals.push({
        stage: input.stage,
        decision: 'RETURNED',
        actorName: input.actorName,
        comment: input.comment,
        actedAt: nowIso(),
      });
      return delay({ status: card.status });
    }

    card.approvals.push({
      stage: input.stage,
      decision: 'SIGNED',
      actorName: input.actorName,
      comment: input.comment,
      actedAt: nowIso(),
    });

    if (input.stage === 'HOMEROOM_TEACHER') {
      card.status = 'PENDING_OFFICE';
      card.teacherSignedAt = nowIso();
      card.teacherName = input.actorName;
      return delay({ status: card.status });
    }

    card.status = 'COMPLETED';
    const infraction = store.infractions.find((i) => i.id === card.infractionId);
    if (infraction) infraction.status = 'RESOLVED';
    // 反思卡完成 → 當日解除下課管制
    store.liftRestriction(card.studentId, store.today, 'INFRACTION_REFLECTION');
    store.liftRestriction(card.studentId, card.countOn, 'INFRACTION_REFLECTION');
    return delay({ status: card.status });
  },

  logObserverPeriod: async (input: {
    assignmentId: string;
    periodNo: number;
    action: 'CHECK_IN' | 'CHECK_OUT';
    observedCount?: number;
    note?: string;
  }) => {
    const assignment = store.assignments.find((a) => a.id === input.assignmentId);
    if (!assignment) throw new Error('查無派單');
    const log = assignment.periodLogs.find((p) => p.periodNo === input.periodNo);
    if (!log) throw new Error('查無該節次');
    if (input.action === 'CHECK_IN') {
      if (log.checkInAt) throw new Error(`第 ${input.periodNo} 節已報到`);
      log.checkInAt = nowIso();
      assignment.status = 'IN_PROGRESS';
    } else {
      if (!log.checkInAt) throw new Error(`第 ${input.periodNo} 節尚未報到`);
      log.checkOutAt = nowIso();
      log.observedCount = input.observedCount ?? log.observedCount ?? 0;
      log.note = input.note ?? log.note;
    }
    const done = assignment.periodLogs.filter((p) => p.checkOutAt).length;
    if (done >= assignment.totalPeriods) {
      assignment.status = 'DUTY_COMPLETED';
      assignment.conductReviewId = assignment.conductReviewId ?? uid('rev');
      assignment.conductReviewStatus = 'DRAFT';
    }
    return delay({ status: assignment.status, completedPeriods: done });
  },

  dismissAlert: async (alertId: string, reason: string) => {
    const alert = store.alerts.find((a) => a.id === alertId);
    if (!alert) throw new Error('查無警示');
    alert.status = 'DISMISSED';
    for (const item of alert.breakdown) {
      const card = store.cards.find((c) => c.id === item.cardId);
      if (card) card.consumedByAlertId = null;
    }
    const assignment = store.assignments.find((a) => a.id === alert.assignmentId);
    if (assignment) {
      assignment.status = 'CANCELLED';
      store.liftRestriction(alert.studentId, assignment.dutyOn, 'OBSERVER_DUTY');
    }
    void reason;
    return delay({ ok: true });
  },

  rescheduleDuty: async (assignmentId: string, dutyOn: string) => {
    const assignment = store.assignments.find((a) => a.id === assignmentId);
    if (!assignment) throw new Error('查無派單');
    store.liftRestriction(assignment.studentId, assignment.dutyOn, 'OBSERVER_DUTY');
    assignment.dutyOn = dutyOn;
    store.upsertRestriction(store.student(assignment.studentId), dutyOn, 'OBSERVER_DUTY', '安全觀察員值勤（改期）');
    const alert = store.alerts.find((a) => a.assignmentId === assignmentId);
    if (alert) alert.dutyOn = dutyOn;
    return delay({ ok: true });
  },
};

export type MockApi = typeof mockApi;
