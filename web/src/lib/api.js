/**
 * 資料存取層（單一入口）
 *
 * 兩種模式：
 *  - live：讀取走 Firestore（受安全規則保護），寫入一律走 Cloud Functions callable。
 *  - mock：純前端模擬（GitHub Pages 預覽、教育訓練、UAT 動線確認）。
 *
 * 頁面只認識本檔匯出的 `api`，兩種模式可無痛切換。
 */
import { collection, doc, getDoc, getDocs, limit as fsLimit, orderBy, query, where, } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { onAuthStateChanged, signInWithEmailAndPassword, signOut as fbSignOut, } from 'firebase/auth';
import { USE_MOCK, firebase } from '../firebase/client.ts';
import { MOCK_SESSIONS, mockApi } from './mock.ts';
import { todayTaipei } from './format.ts';
export { USE_MOCK };
/* ------------------------------- 身分驗證 ------------------------------- */
const MOCK_SESSION_KEY = 'care.mockSession';
export const auth = {
    /** live：Email/密碼登入；mock：以角色代號登入（office / teacher / patrol / student） */
    async signIn(identifier, password) {
        if (USE_MOCK) {
            const session = MOCK_SESSIONS[identifier];
            if (!session)
                throw new Error('示範模式請選擇下方任一角色登入');
            sessionStorage.setItem(MOCK_SESSION_KEY, identifier);
            return session;
        }
        const fb = firebase();
        const credential = await signInWithEmailAndPassword(fb.auth, identifier, password);
        const token = await credential.user.getIdTokenResult(true);
        return {
            uid: credential.user.uid,
            name: credential.user.displayName ?? credential.user.email ?? credential.user.uid,
            email: credential.user.email ?? undefined,
            roles: (token.claims.roles ?? []),
            studentId: token.claims.studentId,
        };
    },
    async signOut() {
        if (USE_MOCK) {
            sessionStorage.removeItem(MOCK_SESSION_KEY);
            return;
        }
        await fbSignOut(firebase().auth);
    },
    /** 訂閱登入狀態；回傳取消訂閱函式 */
    subscribe(callback) {
        if (USE_MOCK) {
            const key = sessionStorage.getItem(MOCK_SESSION_KEY);
            callback(key ? (MOCK_SESSIONS[key] ?? null) : null);
            return () => { };
        }
        const fb = firebase();
        return onAuthStateChanged(fb.auth, async (user) => {
            if (!user)
                return callback(null);
            const token = await user.getIdTokenResult();
            callback({
                uid: user.uid,
                name: user.displayName ?? user.email ?? user.uid,
                email: user.email ?? undefined,
                roles: (token.claims.roles ?? []),
                studentId: token.claims.studentId,
            });
        });
    },
};
/* --------------------------------- 工具 -------------------------------- */
async function call(name, payload) {
    const fb = firebase();
    const fn = httpsCallable(fb.functions, name);
    const result = await fn(payload);
    return result.data;
}
const mapCard = (id, data) => ({
    id,
    studentId: data.studentId,
    studentNo: data.studentNo,
    studentName: data.studentName,
    className: data.className ?? '',
    typeName: data.typeName ?? '',
    formKind: data.formKind,
    formTitle: data.formTitle ?? '',
    status: data.status,
    countOn: data.countOn,
    submittedAt: data.submittedAt,
    teacherSignedAt: data.teacherSignedAt,
    teacherName: data.approvals?.[0]?.actorName,
    returnCount: data.returnCount ?? 0,
});
/* ------------------------------ 資料存取 API ----------------------------- */
export const api = {
    /* --- 設定 --- */
    async infractionTypes() {
        if (USE_MOCK)
            return mockApi.infractionTypes();
        const fb = firebase();
        const snap = await getDocs(query(collection(fb.db, 'infractionTypes'), orderBy('order')));
        return snap.docs.map((d) => ({
            code: d.id,
            name: d.get('name'),
            formKind: d.get('formKind'),
            formTitle: d.get('formTitle') ?? '',
            hint: d.get('hint') ?? '',
        }));
    },
    async locations() {
        if (USE_MOCK)
            return mockApi.locations();
        const fb = firebase();
        const snap = await getDocs(collection(fb.db, 'locations'));
        return snap.docs.map((d) => ({
            code: d.id,
            name: d.get('name'),
            isHotspot: Boolean(d.get('isHotspot')),
        }));
    },
    async template(templateId) {
        if (USE_MOCK) {
            const templates = await mockApi.templates();
            const found = templates[templateId];
            if (!found)
                throw new Error(`查無表單模板 ${templateId}`);
            return found;
        }
        const fb = firebase();
        const snap = await getDoc(doc(fb.db, 'formTemplates', templateId));
        if (!snap.exists())
            throw new Error(`查無表單模板 ${templateId}`);
        return { id: snap.id, ...snap.data() };
    },
    /* --- 生教組儀表板 --- */
    async dashboard() {
        if (USE_MOCK)
            return mockApi.dashboard();
        const fb = firebase();
        const today = todayTaipei();
        const [restrictionSnap, officeSnap, teacherSnap, alertSnap, assignmentSnap, recentSnap] = await Promise.all([
            getDocs(query(collection(fb.db, 'recessRestrictions'), where('date', '==', today))),
            getDocs(query(collection(fb.db, 'reflectionCards'), where('status', '==', 'PENDING_OFFICE'), fsLimit(50))),
            getDocs(query(collection(fb.db, 'reflectionCards'), where('status', '==', 'PENDING_TEACHER'), fsLimit(50))),
            getDocs(query(collection(fb.db, 'recidivismAlerts'), where('status', 'in', ['OPEN', 'ACKNOWLEDGED', 'ASSIGNED']), fsLimit(50))),
            getDocs(query(collection(fb.db, 'observerAssignments'), where('status', 'in', ['SCHEDULED', 'IN_PROGRESS', 'DUTY_COMPLETED', 'REVIEW_PENDING']), fsLimit(50))),
            getDocs(query(collection(fb.db, 'infractions'), orderBy('occurredOn', 'desc'), fsLimit(200))),
        ]);
        const restrictions = restrictionSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
        const alerts = alertSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
        const assignments = assignmentSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
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
        const hotspotMap = new Map();
        for (const d of recentSnap.docs) {
            const name = d.get('locationName') ?? '其他';
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
    async officeQueue() {
        if (USE_MOCK)
            return mockApi.officeQueue();
        const fb = firebase();
        const snap = await getDocs(query(collection(fb.db, 'reflectionCards'), where('status', '==', 'PENDING_OFFICE'), orderBy('teacherSignedAt', 'asc'), fsLimit(100)));
        return snap.docs.map((d) => mapCard(d.id, d.data()));
    },
    /** 取得登入導師所轄班級（安全規則僅允許讀取自己的 staff 文件） */
    async myClassIds(uid) {
        if (USE_MOCK)
            return ['cls_701'];
        const fb = firebase();
        const snap = await getDoc(doc(fb.db, 'staff', uid));
        return snap.get('classIds') ?? [];
    },
    async teacherQueue(classIds) {
        if (USE_MOCK)
            return mockApi.teacherQueue(classIds);
        const fb = firebase();
        const results = await Promise.all(classIds.map((classId) => getDocs(query(collection(fb.db, 'reflectionCards'), where('classId', '==', classId), where('status', '==', 'PENDING_TEACHER'), orderBy('submittedAt', 'asc'), fsLimit(50)))));
        return results.flatMap((snap) => snap.docs.map((d) => mapCard(d.id, d.data())));
    },
    async studentCards(studentId) {
        if (USE_MOCK)
            return mockApi.studentCards(studentId);
        const fb = firebase();
        const snap = await getDocs(query(collection(fb.db, 'reflectionCards'), where('studentId', '==', studentId), orderBy('countOn', 'desc'), fsLimit(30)));
        return snap.docs.map((d) => mapCard(d.id, d.data()));
    },
    async card(cardId) {
        if (USE_MOCK)
            return mockApi.card(cardId);
        const fb = firebase();
        const snap = await getDoc(doc(fb.db, 'reflectionCards', cardId));
        if (!snap.exists())
            throw new Error('查無此反思卡');
        const data = snap.data();
        const [template, infractionSnap, progress] = await Promise.all([
            api.template(data.templateId),
            getDoc(doc(fb.db, 'infractions', data.infractionId)),
            call('studentRecidivismProgress', { studentId: data.studentId, asOf: data.countOn }),
        ]);
        const infraction = infractionSnap.data() ?? {};
        return {
            ...mapCard(snap.id, data),
            template,
            answers: data.answers ?? {},
            approvals: data.approvals ?? [],
            infraction: {
                id: infractionSnap.id,
                typeName: infraction.typeName ?? '',
                occurredAt: infraction.occurredAt ?? '',
                periodNo: infraction.periodNo ?? 0,
                locationName: infraction.locationName ?? '',
                description: infraction.description,
                reporterName: infraction.reporter?.name ?? '',
                reporterRole: infraction.reporter?.role ?? 'PATROL',
            },
            progress: { ...progress, threshold: progress.threshold ?? 3 },
        };
    },
    async alerts() {
        if (USE_MOCK)
            return mockApi.alerts();
        const fb = firebase();
        const snap = await getDocs(query(collection(fb.db, 'recidivismAlerts'), orderBy('triggeredAt', 'desc'), fsLimit(100)));
        return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    },
    async assignments() {
        if (USE_MOCK)
            return mockApi.assignments();
        const fb = firebase();
        const snap = await getDocs(query(collection(fb.db, 'observerAssignments'), orderBy('dutyOn', 'asc'), fsLimit(100)));
        return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    },
    async restrictions(date) {
        if (USE_MOCK)
            return mockApi.restrictions(date);
        const fb = firebase();
        const snap = await getDocs(query(collection(fb.db, 'recessRestrictions'), where('date', '==', date)));
        return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    },
    async searchStudent(keyword) {
        if (USE_MOCK)
            return mockApi.searchStudent(keyword);
        const fb = firebase();
        const snap = await getDocs(query(collection(fb.db, 'students'), where('studentNo', '==', keyword.trim()), fsLimit(5)));
        return snap.docs.map((d) => ({
            id: d.id,
            studentNo: d.get('studentNo'),
            name: d.get('name'),
            className: d.get('className'),
            windowCardCount: undefined,
        }));
    },
    async student(studentId) {
        if (USE_MOCK)
            return mockApi.student(studentId);
        const fb = firebase();
        const [studentSnap, infractionSnap, cardSnap, alertSnap, assignmentSnap, progress] = await Promise.all([
            getDoc(doc(fb.db, 'students', studentId)),
            getDocs(query(collection(fb.db, 'infractions'), where('studentId', '==', studentId), orderBy('occurredOn', 'desc'), fsLimit(50))),
            getDocs(query(collection(fb.db, 'reflectionCards'), where('studentId', '==', studentId), orderBy('countOn', 'desc'), fsLimit(50))),
            getDocs(query(collection(fb.db, 'recidivismAlerts'), where('studentId', '==', studentId), fsLimit(20))),
            getDocs(query(collection(fb.db, 'observerAssignments'), where('studentId', '==', studentId), fsLimit(20))),
            call('studentRecidivismProgress', { studentId }),
        ]);
        if (!studentSnap.exists())
            throw new Error('查無此學生');
        const timeline = [
            ...infractionSnap.docs.map((d) => ({
                id: d.id,
                kind: 'INFRACTION',
                title: `${d.get('typeName')}｜${d.get('locationName')}`,
                detail: `第 ${d.get('periodNo')} 節・登錄者 ${d.get('reporter')?.name ?? ''}`,
                at: d.get('occurredAt'),
                status: d.get('status'),
            })),
            ...cardSnap.docs.map((d) => ({
                id: d.id,
                kind: 'CARD',
                title: d.get('formTitle') ?? '反思卡',
                detail: `狀態：${d.get('status')}`,
                at: d.get('submittedAt') ?? `${d.get('countOn')}T00:00:00.000Z`,
                status: d.get('status'),
            })),
            ...alertSnap.docs.map((d) => ({
                id: d.id,
                kind: 'ALERT',
                title: `累犯警示（${d.get('windowDays')} 天 ${d.get('cardCount')} 張）`,
                detail: `視窗 ${d.get('windowStart')} ~ ${d.get('windowEnd')}`,
                at: d.get('triggeredAt'),
                status: d.get('status'),
            })),
            ...assignmentSnap.docs.map((d) => ({
                id: d.id,
                kind: 'DUTY',
                title: `安全觀察員值勤（${d.get('dutyOn')}）`,
                detail: `狀態：${d.get('status')}`,
                at: `${d.get('dutyOn')}T00:00:00.000Z`,
                status: d.get('status'),
            })),
        ].sort((a, b) => (a.at < b.at ? 1 : -1));
        const today = todayTaipei();
        const restrictionSnap = await getDoc(doc(fb.db, 'recessRestrictions', `${studentId}_${today}`));
        return {
            id: studentSnap.id,
            studentNo: studentSnap.get('studentNo'),
            name: studentSnap.get('name'),
            className: studentSnap.get('className'),
            guardianEmail: studentSnap.get('guardianEmail'),
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
    async createInfraction(input) {
        if (USE_MOCK)
            return mockApi.createInfraction(input);
        return call('createInfraction', input);
    },
    async submitCard(cardId, answers) {
        if (USE_MOCK)
            return mockApi.submitCard(cardId, answers);
        return call('submitCard', { cardId, answers });
    },
    async teacherSign(input, actorName) {
        if (USE_MOCK)
            return mockApi.reviewCard({ ...input, stage: 'HOMEROOM_TEACHER', actorName });
        return call('teacherSignCard', input);
    },
    async officeStamp(input, actorName) {
        if (USE_MOCK)
            return mockApi.reviewCard({ ...input, stage: 'DISCIPLINE_OFFICE', actorName });
        return call('officeStampCard', input);
    },
    async logObserverPeriod(input) {
        if (USE_MOCK)
            return mockApi.logObserverPeriod(input);
        return call('logObserverPeriod', input);
    },
    async dismissAlert(alertId, reason) {
        if (USE_MOCK)
            return mockApi.dismissAlert(alertId, reason);
        return call('dismissRecidivismAlert', {
            alertId,
            reason,
        });
    },
    async rescheduleDuty(assignmentId, dutyOn, reason = '生教組調整') {
        if (USE_MOCK)
            return mockApi.rescheduleDuty(assignmentId, dutyOn);
        return call('rescheduleObserverDuty', { assignmentId, dutyOn, reason });
    },
};
