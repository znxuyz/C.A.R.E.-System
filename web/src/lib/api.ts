/**
 * 資料存取層（單一入口）
 *
 *  - live：讀取走 Firestore（受安全規則保護），寫入一律走 Cloud Functions callable。
 *  - mock：純前端模擬（GitHub Pages 預覽、教育訓練、導入前動線確認）。
 *
 * 公開看板只讀 `publicBoard/today` 一份去識別化文件，不需登入。
 */
import { collection, doc, getDoc, getDocs, limit as fsLimit, orderBy, query, where } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { onAuthStateChanged, signInWithEmailAndPassword, signOut as fbSignOut } from 'firebase/auth';
import { USE_MOCK, firebase } from '../firebase/client.ts';
import { MOCK_SESSION, mockApi } from './mock.ts';
import { todayTaipei } from './format.ts';
import type {
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
  WatchlistRow,
} from './types.ts';

export { USE_MOCK };

/* ------------------------------- 身分驗證 ------------------------------- */

const MOCK_SESSION_KEY = 'care.session';

export const auth = {
  async signIn(email: string, password: string): Promise<Session> {
    if (USE_MOCK) {
      sessionStorage.setItem(MOCK_SESSION_KEY, '1');
      return MOCK_SESSION;
    }
    const fb = firebase()!;
    const credential = await signInWithEmailAndPassword(fb.auth, email, password);
    const token = await credential.user.getIdTokenResult(true);
    const roles = ((token.claims.roles as Role[]) ?? []) as Role[];
    if (roles.length === 0) {
      await fbSignOut(fb.auth);
      throw new Error('此帳號尚未被指派權限，請聯繫系統管理者');
    }
    return {
      uid: credential.user.uid,
      name: credential.user.displayName ?? credential.user.email ?? credential.user.uid,
      email: credential.user.email ?? undefined,
      roles,
    };
  },

  async signOut(): Promise<void> {
    if (USE_MOCK) {
      sessionStorage.removeItem(MOCK_SESSION_KEY);
      return;
    }
    await fbSignOut(firebase()!.auth);
  },

  subscribe(callback: (session: Session | null) => void): () => void {
    if (USE_MOCK) {
      callback(sessionStorage.getItem(MOCK_SESSION_KEY) ? MOCK_SESSION : null);
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

const mapInfraction = (id: string, data: Record<string, unknown>): InfractionRow => ({
  id,
  studentId: data.studentId as string,
  studentNo: data.studentNo as string,
  studentName: data.studentName as string,
  className: (data.className as string) ?? '',
  seatNo: data.seatNo as number | undefined,
  typeCode: data.typeCode as string,
  typeName: (data.typeName as string) ?? '',
  paperCard: data.paperCard as InfractionRow['paperCard'],
  occurredAt: data.occurredAt as string,
  occurredOn: data.occurredOn as string,
  periodNo: (data.periodNo as number) ?? 0,
  locationName: (data.locationName as string) ?? '',
  note: data.note as string | undefined,
  status: data.status as InfractionRow['status'],
  paperReturnedOn: data.paperReturnedOn as string | undefined,
  exemptReason: data.exemptReason as string | undefined,
  voidReason: data.voidReason as string | undefined,
  recordedBy: data.recordedBy as { uid: string; name: string } | undefined,
});

/* ------------------------------ 資料存取 API ----------------------------- */

export const api = {
  /** 公開看板：不需登入，只讀一份去識別化摘要 */
  async publicBoard(): Promise<PublicBoardData> {
    if (USE_MOCK) return mockApi.publicBoard();
    const fb = firebase()!;
    const snap = await getDoc(doc(fb.db, 'publicBoard', 'today'));
    if (!snap.exists()) throw new Error('公開看板尚未產生');
    return snap.data() as PublicBoardData;
  },

  async infractionTypes(): Promise<InfractionTypeOption[]> {
    if (USE_MOCK) return mockApi.infractionTypes();
    const fb = firebase()!;
    const snap = await getDocs(query(collection(fb.db, 'infractionTypes'), orderBy('order')));
    return snap.docs.map((d) => ({
      code: d.id,
      name: d.get('name') as string,
      paperCard: d.get('paperCard') as InfractionTypeOption['paperCard'],
      paperCardLabel: (d.get('paperCardLabel') as string) ?? '',
      icon: d.get('icon') as string | undefined,
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

  async dashboard(): Promise<DashboardData> {
    if (USE_MOCK) return mockApi.dashboard();
    const fb = firebase()!;
    const today = todayTaipei();
    const since = todayTaipei(-13);

    const [restrictionSnap, pendingSnap, alertSnap, assignmentSnap, recentSnap] = await Promise.all([
      getDocs(query(collection(fb.db, 'recessRestrictions'), where('date', '==', today))),
      getDocs(
        query(
          collection(fb.db, 'infractions'),
          where('status', '==', 'OPEN'),
          orderBy('occurredOn', 'desc'),
          fsLimit(100),
        ),
      ),
      getDocs(
        query(
          collection(fb.db, 'recidivismAlerts'),
          where('status', 'in', ['OPEN', 'ACKNOWLEDGED', 'ASSIGNED']),
          fsLimit(50),
        ),
      ),
      getDocs(
        query(
          collection(fb.db, 'observerAssignments'),
          where('status', 'in', ['SCHEDULED', 'IN_PROGRESS', 'DUTY_COMPLETED']),
          fsLimit(50),
        ),
      ),
      getDocs(
        query(
          collection(fb.db, 'infractions'),
          where('occurredOn', '>=', since),
          where('occurredOn', '<=', today),
          fsLimit(500),
        ),
      ),
    ]);

    const restrictions = restrictionSnap.docs.map((d) => ({
      id: d.id,
      ...(d.data() as Omit<RestrictionRow, 'id'>),
    }));
    const pendingPapers = pendingSnap.docs.map((d) => mapInfraction(d.id, d.data()));
    const alerts = alertSnap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<AlertRow, 'id'>) }));
    const assignments = assignmentSnap.docs.map((d) => ({
      id: d.id,
      ...(d.data() as Omit<AssignmentRow, 'id'>),
    }));

    const counted = recentSnap.docs.filter(
      (d) => d.get('status') !== 'VOIDED' && d.get('status') !== 'EXEMPTED',
    );
    const trend = Array.from({ length: 14 }, (_, index) => {
      const date = todayTaipei(index - 13);
      const sameDay = counted.filter((d) => d.get('occurredOn') === date);
      return {
        date,
        safety: sameDay.filter((d) => d.get('paperCard') === 'SAFETY').length,
        kindWords: sameDay.filter((d) => d.get('paperCard') === 'KIND_WORDS').length,
      };
    });
    const hotspotMap = new Map<string, number>();
    for (const d of counted) {
      const name = (d.get('locationName') as string) ?? '其他';
      hotspotMap.set(name, (hotspotMap.get(name) ?? 0) + 1);
    }

    // 關注名單：視窗內有紀錄但尚未達門檻（未被認列）
    const byStudent = new Map<string, WatchlistRow>();
    for (const d of counted) {
      if (d.get('consumedByAlertId')) continue;
      const studentId = d.get('studentId') as string;
      const row = byStudent.get(studentId) ?? {
        studentId,
        studentNo: d.get('studentNo') as string,
        studentName: d.get('studentName') as string,
        className: d.get('className') as string,
        count: 0,
        shortfall: 3,
      };
      row.count += 1;
      row.shortfall = Math.max(0, 3 - row.count);
      byStudent.set(studentId, row);
    }
    const watchlist = [...byStudent.values()]
      .filter((row) => row.shortfall > 0)
      .sort((a, b) => b.count - a.count);

    return {
      today,
      kpis: {
        restrictedActive: restrictions.filter((r) => r.status === 'ACTIVE').length,
        pendingPapers: pendingPapers.length,
        openAlerts: alerts.length,
        observersToday: assignments.filter((a) => a.dutyOn === today).length,
        infractionsToday: counted.filter((d) => d.get('occurredOn') === today).length,
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
    const fb = firebase()!;
    const snap = await getDocs(
      query(
        collection(fb.db, 'infractions'),
        where('status', '==', 'OPEN'),
        orderBy('occurredOn', 'desc'),
        fsLimit(100),
      ),
    );
    return snap.docs.map((d) => mapInfraction(d.id, d.data()));
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
      seatNo: d.get('seatNo') as number | undefined,
      windowCount: undefined as number | undefined,
    }));
  },

  async student(studentId: string): Promise<StudentDetail> {
    if (USE_MOCK) return mockApi.student(studentId);
    const fb = firebase()!;
    const today = todayTaipei();
    const [studentSnap, historySnap, alertSnap, assignmentSnap, progress, restrictionSnap] =
      await Promise.all([
        getDoc(doc(fb.db, 'students', studentId)),
        getDocs(
          query(
            collection(fb.db, 'infractions'),
            where('studentId', '==', studentId),
            orderBy('occurredOn', 'desc'),
            fsLimit(50),
          ),
        ),
        getDocs(query(collection(fb.db, 'recidivismAlerts'), where('studentId', '==', studentId), fsLimit(20))),
        getDocs(query(collection(fb.db, 'observerAssignments'), where('studentId', '==', studentId), fsLimit(20))),
        call<{ studentId: string }, StudentDetail['progress']>('studentProgress', { studentId }),
        getDoc(doc(fb.db, 'recessRestrictions', `${studentId}_${today}`)),
      ]);
    if (!studentSnap.exists()) throw new Error('查無此學生');

    return {
      id: studentSnap.id,
      studentNo: studentSnap.get('studentNo') as string,
      name: studentSnap.get('name') as string,
      className: studentSnap.get('className') as string,
      seatNo: studentSnap.get('seatNo') as number | undefined,
      progress,
      totals: {
        infractions: historySnap.size,
        alerts: alertSnap.size,
        duties: assignmentSnap.size,
      },
      history: historySnap.docs.map((d) => mapInfraction(d.id, d.data())),
      alerts: alertSnap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<AlertRow, 'id'>) })),
      restrictedToday: restrictionSnap.exists() && restrictionSnap.get('status') === 'ACTIVE',
    };
  },

  /* --- 寫入（live 一律經 Cloud Functions） --- */

  async createInfraction(input: CreateInfractionInput) {
    if (USE_MOCK) return mockApi.createInfraction(input);
    return call<CreateInfractionInput, {
      infractionId: string;
      studentId: string;
      studentName: string;
      className: string;
      paperCardLabel: string;
      recidivism: { triggered: boolean; count: number; shortfall: number; dutyOn?: string };
    }>('createInfraction', input);
  },

  async returnPaperCard(infractionId: string) {
    if (USE_MOCK) return mockApi.returnPaperCard(infractionId);
    return call<{ infractionId: string }, { status: string; unlockOn: string }>('returnPaperCard', {
      infractionId,
    });
  },

  async annotate(infractionId: string, action: 'EXEMPT' | 'VOID', reason: string) {
    if (USE_MOCK) return mockApi.annotate(infractionId, action, reason);
    return call<{ infractionId: string; action: string; reason: string }, { ok: boolean }>(
      'annotateCase',
      { infractionId, action, reason },
    );
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

  async returnConductReview(assignmentId: string) {
    if (USE_MOCK) return mockApi.returnConductReview(assignmentId);
    return call<{ assignmentId: string }, { unlockOn: string }>('returnConductReview', {
      assignmentId,
    });
  },

  async rescheduleDuty(assignmentId: string, dutyOn: string, reason = '生教組調整') {
    if (USE_MOCK) return mockApi.rescheduleDuty(assignmentId, dutyOn);
    return call<{ assignmentId: string; dutyOn: string; reason: string }, { ok: boolean }>(
      'rescheduleObserverDuty',
      { assignmentId, dutyOn, reason },
    );
  },

  async dismissAlert(alertId: string, reason: string) {
    if (USE_MOCK) return mockApi.dismissAlert(alertId, reason);
    return call<{ alertId: string; reason: string }, { ok: boolean }>('dismissRecidivismAlert', {
      alertId,
      reason,
    });
  },
};
