/**
 * 資料存取層（單一入口）
 *
 * 兩種模式：
 *  - live：讀取走 Firestore（受安全規則保護），寫入一律走 Cloud Functions callable。
 *  - mock：純前端模擬（GitHub Pages 預覽、教育訓練、UAT 動線確認）。
 *
 * 頁面只認識本檔匯出的 `api`，兩種模式可無痛切換。
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
} from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut as fbSignOut,
} from 'firebase/auth';
import { USE_MOCK, firebase } from '../firebase/client.ts';
import { MOCK_SESSIONS, mockApi } from './mock.ts';
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
  Role,
  Session,
  StudentDetail,
} from './types.ts';

export { USE_MOCK };

/* ------------------------------- 身分驗證 ------------------------------- */

const MOCK_SESSION_KEY = 'care.mockSession';

export const auth = {
  /** live：Email/密碼登入；mock：以角色代號登入（office / teacher / patrol / student） */
  async signIn(identifier: string, password: string): Promise<Session> {
    if (USE_MOCK) {
      const session = MOCK_SESSIONS[identifier];
      if (!session) throw new Error('示範模式請選擇下方任一角色登入');
      sessionStorage.setItem(MOCK_SESSION_KEY, identifier);
      return session;
    }
    const fb = firebase()!;
    const credential = await signInWithEmailAndPassword(fb.auth, identifier, password);
    const token = await credential.user.getIdTokenResult(true);
    return {
      uid: credential.user.uid,
      name: credential.user.displayName ?? credential.user.email ?? credential.user.uid,
      email: credential.user.email ?? undefined,
      roles: ((token.claims.roles as Role[]) ?? []) as Role[],
      studentId: token.claims.studentId as string | undefined,
    };
  },

  async signOut(): Promise<void> {
    if (USE_MOCK) {
      sessionStorage.removeItem(MOCK_SESSION_KEY);
      return;
    }
    await fbSignOut(firebase()!.auth);
  },

  /** 訂閱登入狀態；回傳取消訂閱函式 */
  subscribe(callback: (session: Session | null) => void): () => void {
    if (USE_MOCK) {
      const key = sessionStorage.getItem(MOCK_SESSION_KEY);
      callback(key ? (MOCK_SESSIONS[key] ?? null) : null);
      return () => {};
    }
    const fb = firebase()!;
    return onAuthStateChanged(fb.auth, async (user) => {
      if (!user) return callback(null);
      const token = await user.getIdTokenResult();
      callback({
        uid: user.uid,
        name: user.displayName ?? user.email ?? user.uid,
        email: user.email ?? undefined,
        roles: ((token.claims.roles as Role[]) ?? []) as Role[],
        studentId: token.claims.studentId as string | undefined,
      });
    });
  },
};

/* --------------------------------- 工具 -------------------------------- */

async function call<TIn extends object, TOut>(name: string, payload: TIn): Promise<TOut> {
  const fb = firebase()!;
  const fn = httpsCallable<TIn, TOut>(fb.functions, name);
  const result = await fn(payload);
  return result.data;
}

const mapCard = (id: string, data: Record<string, unknown>): CardSummary => ({
  id,
  studentId: data.studentId as string,
  studentNo: data.studentNo as string,
  studentName: data.studentName as string,
  className: (data.className as string) ?? '',
  typeName: (data.typeName as string) ?? '',
  formKind: data.formKind as CardSummary['formKind'],
  formTitle: (data.formTitle as string) ?? '',
  status: data.status as CardSummary['status'],
  countOn: data.countOn as string,
  submittedAt: data.submittedAt as string | undefined,
  teacherSignedAt: data.teacherSignedAt as string | undefined,
  teacherName: (data.approvals as Array<{ actorName: string }> | undefined)?.[0]?.actorName,
  returnCount: (data.returnCount as number) ?? 0,
});

/* ------------------------------ 資料存取 API ----------------------------- */

export const api = {
  /* --- 設定 --- */
  async infractionTypes(): Promise<InfractionTypeOption[]> {
    if (USE_MOCK) return mockApi.infractionTypes();
    const fb = firebase()!;
    const snap = await getDocs(query(collection(fb.db, 'infractionTypes'), orderBy('order')));
    return snap.docs.map((d) => ({
      code: d.id,
      name: d.get('name') as string,
      formKind: d.get('formKind') as InfractionTypeOption['formKind'],
      formTitle: (d.get('formTitle') as string) ?? '',
      hint: (d.get('hint') as string) ?? '',
    }));
  },

  async locations(): Promise<LocationOption[]> {
    if (USE_MOCK) return mockApi.locations();
    const fb = firebase()!;
    const snap = await getDocs(collection(fb.db, 'locations'));
    return snap.docs.map((d) => ({
      code: d.id,
      name: d.get('name') as string,
      isHotspot: Boolean(d.get('isHotspot')),
    }));
  },

  async template(templateId: string): Promise<FormTemplate> {
    if (USE_MOCK) {
      const templates = await mockApi.templates();
      const found = templates[templateId];
      if (!found) throw new Error(`查無表單模板 ${templateId}`);
      return found;
    }
    const fb = firebase()!;
    const snap = await getDoc(doc(fb.db, 'formTemplates', templateId));
    if (!snap.exists()) throw new Error(`查無表單模板 ${templateId}`);
    return { id: snap.id, ...(snap.data() as Omit<FormTemplate, 'id'>) };
  },

  /* --- 生教組儀表板 --- */
  async dashboard(): Promise<DashboardData> {
    if (USE_MOCK) return mockApi.dashboard();
    const fb = firebase()!;
    const today = todayTaipei();

    const [restrictionSnap, officeSnap, teacherSnap, alertSnap, assignmentSnap, recentSnap] =
      await Promise.all([
        getDocs(query(collection(fb.db, 'recessRestrictions'), where('date', '==', today))),
        getDocs(query(collection(fb.db, 'reflectionCards'), where('status', '==', 'PENDING_OFFICE'), fsLimit(50))),
        getDocs(query(collection(fb.db, 'reflectionCards'), where('status', '==', 'PENDING_TEACHER'), fsLimit(50))),
        getDocs(query(collection(fb.db, 'recidivismAlerts'), where('status', 'in', ['OPEN', 'ACKNOWLEDGED', 'ASSIGNED']), fsLimit(50))),
        getDocs(query(collection(fb.db, 'observerAssignments'), where('status', 'in', ['SCHEDULED', 'IN_PROGRESS', 'DUTY_COMPLETED', 'REVIEW_PENDING']), fsLimit(50))),
        getDocs(query(collection(fb.db, 'infractions'), orderBy('occurredOn', 'desc'), fsLimit(200))),
      ]);

    const restrictions = restrictionSnap.docs.map(
      (d) => ({ id: d.id, ...(d.data() as Omit<RestrictionRow, 'id'>) }),
    );
    const alerts = alertSnap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<AlertRow, 'id'>) }));
    const assignments = assignmentSnap.docs.map(
      (d) => ({ id: d.id, ...(d.data() as Omit<AssignmentRow, 'id'>) }),
    );

    // 近 14 天趨勢 / 熱點：以最近的違規事件彙總（單次查詢，前端聚合）
    const days = Array.from({ length: 14 }, (_, index) => todayTaipei(index - 13));
    const trend = days.map((date) => {
      const sameDay = recentSnap.docs.filter((d) => d.get('occurredOn') === date);
      return {
        date,
        safety: sameDay.filter((d) => d.get('formKind') === 'SAFETY_REFLECTION').length,
        words: sameDay.filter((d) => d.get('formKind') === 'KIND_WORDS_REFLECTION').length,
      };
    });
    const hotspotMap = new Map<string, number>();
    for (const d of recentSnap.docs) {
      const name = (d.get('locationName') as string) ?? '其他';
      hotspotMap.set(name, (hotspotMap.get(name) ?? 0) + 1);
    }

    return {
      today,
      kpis: {
        restrictedActive: restrictions.filter((r) => r.status === 'ACTIVE').length,
        pendingOffice: officeSnap.size,
        pendingTeacher: teacherSnap.size,
        openAlerts: alerts.length,
        observersToday: assignments.filter((a) => a.dutyOn === today).length,
        atRiskStudents: 0,
      },
      restrictions,
      officeQueue: officeSnap.docs.map((d) => mapCard(d.id, d.data())),
      alerts,
      assignments,
      trend,
      hotspots: [...hotspotMap.entries()]
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 5),
    };
  },

  /* --- 佇列 --- */
  async officeQueue(): Promise<CardSummary[]> {
    if (USE_MOCK) return mockApi.officeQueue();
    const fb = firebase()!;
    const snap = await getDocs(
      query(
        collection(fb.db, 'reflectionCards'),
        where('status', '==', 'PENDING_OFFICE'),
        orderBy('teacherSignedAt', 'asc'),
        fsLimit(100),
      ),
    );
    return snap.docs.map((d) => mapCard(d.id, d.data()));
  },

  /** 取得登入導師所轄班級（安全規則僅允許讀取自己的 staff 文件） */
  async myClassIds(uid: string): Promise<string[]> {
    if (USE_MOCK) return ['cls_701'];
    const fb = firebase()!;
    const snap = await getDoc(doc(fb.db, 'staff', uid));
    return (snap.get('classIds') as string[] | undefined) ?? [];
  },

  async teacherQueue(classIds: string[]): Promise<CardSummary[]> {
    if (USE_MOCK) return mockApi.teacherQueue(classIds);
    const fb = firebase()!;
    const results = await Promise.all(
      classIds.map((classId) =>
        getDocs(
          query(
            collection(fb.db, 'reflectionCards'),
            where('classId', '==', classId),
            where('status', '==', 'PENDING_TEACHER'),
            orderBy('submittedAt', 'asc'),
            fsLimit(50),
          ),
        ),
      ),
    );
    return results.flatMap((snap) => snap.docs.map((d) => mapCard(d.id, d.data())));
  },

  async studentCards(studentId: string): Promise<CardSummary[]> {
    if (USE_MOCK) return mockApi.studentCards(studentId);
    const fb = firebase()!;
    const snap = await getDocs(
      query(
        collection(fb.db, 'reflectionCards'),
        where('studentId', '==', studentId),
        orderBy('countOn', 'desc'),
        fsLimit(30),
      ),
    );
    return snap.docs.map((d) => mapCard(d.id, d.data()));
  },

  async card(cardId: string): Promise<CardDetail> {
    if (USE_MOCK) return mockApi.card(cardId);
    const fb = firebase()!;
    const snap = await getDoc(doc(fb.db, 'reflectionCards', cardId));
    if (!snap.exists()) throw new Error('查無此反思卡');
    const data = snap.data();
    const [template, infractionSnap, progress] = await Promise.all([
      api.template(data.templateId as string),
      getDoc(doc(fb.db, 'infractions', data.infractionId as string)),
      call<{ studentId: string; asOf: string }, CardDetail['progress']>(
        'studentRecidivismProgress',
        { studentId: data.studentId as string, asOf: data.countOn as string },
      ),
    ]);
    const infraction = infractionSnap.data() ?? {};
    return {
      ...mapCard(snap.id, data),
      template,
      answers: (data.answers as Record<string, unknown>) ?? {},
      approvals: (data.approvals as CardDetail['approvals']) ?? [],
      infraction: {
        id: infractionSnap.id,
        typeName: (infraction.typeName as string) ?? '',
        occurredAt: (infraction.occurredAt as string) ?? '',
        periodNo: (infraction.periodNo as number) ?? 0,
        locationName: (infraction.locationName as string) ?? '',
        description: infraction.description as string | undefined,
        reporterName: (infraction.reporter as { name?: string } | undefined)?.name ?? '',
        reporterRole:
          ((infraction.reporter as { role?: Role } | undefined)?.role as Role) ?? 'PATROL',
      },
      progress: { ...progress, threshold: progress.threshold ?? 3 },
    };
  },

  async alerts(): Promise<AlertRow[]> {
    if (USE_MOCK) return mockApi.alerts();
    const fb = firebase()!;
    const snap = await getDocs(
      query(collection(fb.db, 'recidivismAlerts'), orderBy('triggeredAt', 'desc'), fsLimit(100)),
    );
    return snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<AlertRow, 'id'>) }));
  },

  async assignments(): Promise<AssignmentRow[]> {
    if (USE_MOCK) return mockApi.assignments();
    const fb = firebase()!;
    const snap = await getDocs(
      query(collection(fb.db, 'observerAssignments'), orderBy('dutyOn', 'asc'), fsLimit(100)),
    );
    return snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<AssignmentRow, 'id'>) }));
  },

  async restrictions(date: string): Promise<RestrictionRow[]> {
    if (USE_MOCK) return mockApi.restrictions(date);
    const fb = firebase()!;
    const snap = await getDocs(
      query(collection(fb.db, 'recessRestrictions'), where('date', '==', date)),
    );
    return snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<RestrictionRow, 'id'>) }));
  },

  async searchStudent(keyword: string) {
    if (USE_MOCK) return mockApi.searchStudent(keyword);
    const fb = firebase()!;
    const snap = await getDocs(
      query(collection(fb.db, 'students'), where('studentNo', '==', keyword.trim()), fsLimit(5)),
    );
    return snap.docs.map((d) => ({
      id: d.id,
      studentNo: d.get('studentNo') as string,
      name: d.get('name') as string,
      className: d.get('className') as string,
      windowCardCount: undefined as number | undefined,
    }));
  },

  async student(studentId: string): Promise<StudentDetail> {
    if (USE_MOCK) return mockApi.student(studentId);
    const fb = firebase()!;
    const [studentSnap, infractionSnap, cardSnap, alertSnap, assignmentSnap, progress] =
      await Promise.all([
        getDoc(doc(fb.db, 'students', studentId)),
        getDocs(query(collection(fb.db, 'infractions'), where('studentId', '==', studentId), orderBy('occurredOn', 'desc'), fsLimit(50))),
        getDocs(query(collection(fb.db, 'reflectionCards'), where('studentId', '==', studentId), orderBy('countOn', 'desc'), fsLimit(50))),
        getDocs(query(collection(fb.db, 'recidivismAlerts'), where('studentId', '==', studentId), fsLimit(20))),
        getDocs(query(collection(fb.db, 'observerAssignments'), where('studentId', '==', studentId), fsLimit(20))),
        call<{ studentId: string }, StudentDetail['progress']>('studentRecidivismProgress', { studentId }),
      ]);
    if (!studentSnap.exists()) throw new Error('查無此學生');

    const timeline: StudentDetail['timeline'] = [
      ...infractionSnap.docs.map((d) => ({
        id: d.id,
        kind: 'INFRACTION' as const,
        title: `${d.get('typeName')}｜${d.get('locationName')}`,
        detail: `第 ${d.get('periodNo')} 節・登錄者 ${(d.get('reporter') as { name?: string })?.name ?? ''}`,
        at: d.get('occurredAt') as string,
        status: d.get('status') as string,
      })),
      ...cardSnap.docs.map((d) => ({
        id: d.id,
        kind: 'CARD' as const,
        title: (d.get('formTitle') as string) ?? '反思卡',
        detail: `狀態：${d.get('status')}`,
        at: (d.get('submittedAt') as string) ?? `${d.get('countOn')}T00:00:00.000Z`,
        status: d.get('status') as string,
      })),
      ...alertSnap.docs.map((d) => ({
        id: d.id,
        kind: 'ALERT' as const,
        title: `累犯警示（${d.get('windowDays')} 天 ${d.get('cardCount')} 張）`,
        detail: `視窗 ${d.get('windowStart')} ~ ${d.get('windowEnd')}`,
        at: d.get('triggeredAt') as string,
        status: d.get('status') as string,
      })),
      ...assignmentSnap.docs.map((d) => ({
        id: d.id,
        kind: 'DUTY' as const,
        title: `安全觀察員值勤（${d.get('dutyOn')}）`,
        detail: `狀態：${d.get('status')}`,
        at: `${d.get('dutyOn')}T00:00:00.000Z`,
        status: d.get('status') as string,
      })),
    ].sort((a, b) => (a.at < b.at ? 1 : -1));

    const today = todayTaipei();
    const restrictionSnap = await getDoc(
      doc(fb.db, 'recessRestrictions', `${studentId}_${today}`),
    );

    return {
      id: studentSnap.id,
      studentNo: studentSnap.get('studentNo') as string,
      name: studentSnap.get('name') as string,
      className: studentSnap.get('className') as string,
      guardianEmail: studentSnap.get('guardianEmail') as string | undefined,
      progress: { ...progress, threshold: progress.threshold ?? 3 },
      totals: {
        infractions: infractionSnap.size,
        cards: cardSnap.size,
        alerts: alertSnap.size,
        duties: assignmentSnap.size,
      },
      timeline,
      restrictedToday: restrictionSnap.exists() && restrictionSnap.get('status') === 'ACTIVE',
    };
  },

  /* --- 寫入（live 一律經 Cloud Functions） --- */

  async createInfraction(input: CreateInfractionInput) {
    if (USE_MOCK) return mockApi.createInfraction(input);
    return call<CreateInfractionInput, { infractionId: string; reflectionCardId: string; formKind: string; notifiedTeacher: boolean }>(
      'createInfraction',
      input,
    );
  },

  async submitCard(cardId: string, answers: Record<string, unknown>) {
    if (USE_MOCK) return mockApi.submitCard(cardId, answers);
    return call<{ cardId: string; answers: Record<string, unknown> }, { status: string }>(
      'submitCard',
      { cardId, answers },
    );
  },

  async teacherSign(input: ReviewInput, actorName: string) {
    if (USE_MOCK) return mockApi.reviewCard({ ...input, stage: 'HOMEROOM_TEACHER', actorName });
    return call<ReviewInput, { status: string }>('teacherSignCard', input);
  },

  async officeStamp(input: ReviewInput, actorName: string) {
    if (USE_MOCK) return mockApi.reviewCard({ ...input, stage: 'DISCIPLINE_OFFICE', actorName });
    return call<ReviewInput, { status: string }>('officeStampCard', input);
  },

  async logObserverPeriod(input: {
    assignmentId: string;
    periodNo: number;
    action: 'CHECK_IN' | 'CHECK_OUT';
    observedCount?: number;
    note?: string;
  }) {
    if (USE_MOCK) return mockApi.logObserverPeriod(input);
    return call<typeof input, { status: string; completedPeriods: number }>(
      'logObserverPeriod',
      input,
    );
  },

  async dismissAlert(alertId: string, reason: string) {
    if (USE_MOCK) return mockApi.dismissAlert(alertId, reason);
    return call<{ alertId: string; reason: string }, { ok: boolean }>('dismissRecidivismAlert', {
      alertId,
      reason,
    });
  },

  async rescheduleDuty(assignmentId: string, dutyOn: string, reason = '生教組調整') {
    if (USE_MOCK) return mockApi.rescheduleDuty(assignmentId, dutyOn);
    return call<{ assignmentId: string; dutyOn: string; reason: string }, { ok: boolean }>(
      'rescheduleObserverDuty',
      { assignmentId, dutyOn, reason },
    );
  },
};
