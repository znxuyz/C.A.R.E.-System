import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useMemo, useState } from 'react';
import { HashRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { AppShell } from './components/AppShell.tsx';
import { ToastProvider } from './components/toast.tsx';
import { api, auth } from './lib/api.ts';
import { todayTaipei } from './lib/format.ts';
import { AlertBoard } from './pages/AlertBoard.tsx';
import { InfractionLog } from './pages/InfractionLog.tsx';
import { Login } from './pages/Login.tsx';
import { ObserverDesk } from './pages/ObserverDesk.tsx';
import { OfficeDashboard } from './pages/OfficeDashboard.tsx';
import { RestrictionList } from './pages/RestrictionList.tsx';
import { ReviewQueue } from './pages/ReviewQueue.tsx';
import { StudentCards } from './pages/StudentCards.tsx';
import { StudentLookup } from './pages/StudentLookup.tsx';
const TITLES = [
    [/^\/office$/, '生教組戰情儀表板', '今日管制、待辦審核與累犯警示一覽'],
    [/^\/office\/log/, '違規事件登錄', '生教組 / 糾察隊 / 巡堂教師皆可登錄'],
    [/^\/office\/review/, '審核佇列（生教組蓋章）', '第二層審核：看內容、蓋章結案'],
    [/^\/office\/alerts/, '累犯警示與追蹤清單', '15 天內 3 張自動觸發'],
    [/^\/office\/observers/, '安全觀察員值勤台', '一日下課 5 節・報到與離開打卡'],
    [/^\/office\/restrictions/, '下課管制名單', '可查任一日並列印張貼'],
    [/^\/office\/students/, '學生查詢與行為歷程', '輔導會議與親師溝通使用'],
    [/^\/teacher/, '導師待簽章', '第一層審核・可勾選班級活動優先'],
    [/^\/student/, '我的反思卡', '填寫後送交導師簽章'],
];
function useHeading() {
    const location = useLocation();
    const found = TITLES.find(([pattern]) => pattern.test(location.pathname));
    return { title: found?.[1] ?? 'C.A.R.E. System', subtitle: found?.[2] };
}
function Layout({ session, onSignOut, children, }) {
    const { title, subtitle } = useHeading();
    const [counts, setCounts] = useState({ office: 0, alerts: 0, teacher: 0 });
    const today = todayTaipei();
    const isOffice = session.roles.includes('DISCIPLINE_STAFF') || session.roles.includes('ADMIN');
    const isTeacher = session.roles.includes('HOMEROOM_TEACHER');
    const isStudent = session.roles.includes('STUDENT');
    const canReport = isOffice || isTeacher || session.roles.includes('PATROL');
    useEffect(() => {
        if (!isOffice)
            return;
        void api.dashboard().then((data) => setCounts({
            office: data.kpis.pendingOffice,
            alerts: data.kpis.openAlerts,
            teacher: data.kpis.pendingTeacher,
        }));
    }, [isOffice]);
    const items = useMemo(() => {
        const list = [];
        if (isOffice) {
            list.push({ to: '/office', label: '戰情儀表板', icon: '📊', group: '生教組' }, { to: '/office/review', label: '審核蓋章', icon: '🖊️', badge: counts.office, group: '生教組' }, { to: '/office/alerts', label: '累犯警示', icon: '⚠️', badge: counts.alerts, group: '生教組' }, { to: '/office/observers', label: '安全觀察員', icon: '👀', group: '生教組' }, { to: '/office/restrictions', label: '下課管制名單', icon: '⛔', group: '生教組' }, { to: '/office/students', label: '學生查詢', icon: '🔍', group: '生教組' });
        }
        if (canReport) {
            list.push({ to: '/office/log', label: '登錄違規', icon: '➕', group: '現場作業' });
        }
        if (isTeacher) {
            list.push({ to: '/teacher', label: '待我簽章', icon: '✍️', group: '導師' });
        }
        if (isStudent) {
            list.push({ to: '/student', label: '我的反思卡', icon: '📝', group: '學生' });
        }
        return list;
    }, [isOffice, isTeacher, isStudent, canReport, counts]);
    return (_jsx(AppShell, { session: session, items: items, title: title, subtitle: subtitle, today: today, onSignOut: onSignOut, children: children }));
}
export default function App() {
    const [session, setSession] = useState(null);
    const [ready, setReady] = useState(false);
    useEffect(() => {
        const unsubscribe = auth.subscribe((next) => {
            setSession(next);
            setReady(true);
        });
        return unsubscribe;
    }, []);
    const landing = (current) => {
        if (current.roles.includes('DISCIPLINE_STAFF') || current.roles.includes('ADMIN'))
            return '/office';
        if (current.roles.includes('HOMEROOM_TEACHER'))
            return '/teacher';
        if (current.roles.includes('STUDENT'))
            return '/student';
        return '/office/log';
    };
    if (!ready) {
        return _jsx("div", { className: "login-wrap muted", children: "\u8F09\u5165\u4E2D\u2026" });
    }
    return (_jsx(ToastProvider, { children: _jsx(HashRouter, { children: !session ? (_jsx(Login, { onSignedIn: setSession })) : (_jsx(Layout, { session: session, onSignOut: () => {
                    void auth.signOut().then(() => setSession(null));
                }, children: _jsxs(Routes, { children: [_jsx(Route, { path: "/", element: _jsx(Navigate, { to: landing(session), replace: true }) }), _jsx(Route, { path: "/office", element: _jsx(OfficeDashboard, {}) }), _jsx(Route, { path: "/office/log", element: _jsx(InfractionLog, {}) }), _jsx(Route, { path: "/office/review", element: _jsx(ReviewQueue, { session: session, stage: "DISCIPLINE_OFFICE" }) }), _jsx(Route, { path: "/office/alerts", element: _jsx(AlertBoard, {}) }), _jsx(Route, { path: "/office/observers", element: _jsx(ObserverDesk, {}) }), _jsx(Route, { path: "/office/restrictions", element: _jsx(RestrictionList, {}) }), _jsx(Route, { path: "/office/students", element: _jsx(StudentLookup, {}) }), _jsx(Route, { path: "/office/students/:studentId", element: _jsx(StudentLookup, {}) }), _jsx(Route, { path: "/teacher", element: _jsx(ReviewQueue, { session: session, stage: "HOMEROOM_TEACHER" }) }), _jsx(Route, { path: "/student", element: _jsx(StudentCards, { session: session }) }), _jsx(Route, { path: "*", element: _jsx(Navigate, { to: landing(session), replace: true }) })] }) })) }) }));
}
