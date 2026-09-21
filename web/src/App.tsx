import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { HashRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { AppShell, type NavItem } from './components/AppShell.tsx';
import { ToastProvider } from './components/toast.tsx';
import { api, auth } from './lib/api.ts';
import { todayTaipei } from './lib/format.ts';
import { AlertBoard } from './pages/AlertBoard.tsx';
import { Dashboard } from './pages/Dashboard.tsx';
import { InfractionLog } from './pages/InfractionLog.tsx';
import { Login } from './pages/Login.tsx';
import { ObserverDesk } from './pages/ObserverDesk.tsx';
import { PendingCases } from './pages/PendingCases.tsx';
import { PublicBoard } from './pages/PublicBoard.tsx';
import { RestrictionList } from './pages/RestrictionList.tsx';
import { Settings } from './pages/Settings.tsx';
import { StudentLookup } from './pages/StudentLookup.tsx';
import { Unauthorized } from './pages/Unauthorized.tsx';
import { Users } from './pages/Users.tsx';
import type { Session } from './lib/types.ts';

const TITLES: Array<[RegExp, string, string?]> = [
  [/^\/admin$/, '生教組儀表板', '今日管制、待回收紙本與再犯警示一覽'],
  [/^\/admin\/log/, '違規事件登錄', '現場 30 秒完成，系統自動計算再犯次數'],
  [/^\/admin\/cases/, '待回收紙本反思卡', '按「已回收」即當日解除下課管制'],
  [/^\/admin\/alerts/, '再犯警示與追蹤清單', '15 天內 3 次自動觸發'],
  [/^\/admin\/observers/, '安全觀察員值勤台', '一日下課 5 節・紙本檢討書回收後隔日解鎖'],
  [/^\/admin\/restrictions/, '下課管制名單', '可查任一日並列印張貼'],
  [/^\/admin\/students/, '學生查詢與違規歷程', '輔導會議與親師溝通使用'],
  [/^\/admin\/users/, '帳號管理', '以 Google 信箱授權生教組同仁'],
  [/^\/admin\/settings/, '系統設定', '再犯門檻、值勤節次、公開看板與通知'],
];

function useHeading() {
  const location = useLocation();
  const found = TITLES.find(([pattern]) => pattern.test(location.pathname));
  return { title: found?.[1] ?? 'C.A.R.E. System', subtitle: found?.[2] };
}

function AdminLayout({
  session,
  onSignOut,
  children,
}: {
  session: Session;
  onSignOut: () => void;
  children: ReactNode;
}) {
  const { title, subtitle } = useHeading();
  const [counts, setCounts] = useState({ papers: 0, alerts: 0 });
  const today = todayTaipei();

  useEffect(() => {
    void api
      .dashboard()
      .then((data) => setCounts({ papers: data.kpis.pendingPapers, alerts: data.kpis.openAlerts }))
      .catch(() => undefined);
  }, []);

  const isAdmin = session.roles.includes('ADMIN');

  const items = useMemo<NavItem[]>(() => {
    const list: NavItem[] = [
      { to: '/admin', label: '儀表板', icon: '📊', group: '每日作業' },
      { to: '/admin/log', label: '登錄違規', icon: '➕', group: '每日作業' },
      { to: '/admin/cases', label: '待回收紙本', icon: '📄', badge: counts.papers, group: '每日作業' },
      { to: '/admin/restrictions', label: '下課管制名單', icon: '⛔', group: '每日作業' },
      { to: '/admin/alerts', label: '再犯警示', icon: '⚠️', badge: counts.alerts, group: '追蹤輔導' },
      { to: '/admin/observers', label: '安全觀察員', icon: '👀', group: '追蹤輔導' },
      { to: '/admin/students', label: '學生查詢', icon: '🔍', group: '追蹤輔導' },
    ];
    if (isAdmin) {
      list.push(
        { to: '/admin/users', label: '帳號管理', icon: '🔑', group: '管理' },
        { to: '/admin/settings', label: '系統設定', icon: '⚙️', group: '管理' },
      );
    }
    return list;
  }, [counts, isAdmin]);

  return (
    <AppShell
      session={session}
      items={items}
      title={title}
      subtitle={subtitle}
      today={today}
      onSignOut={onSignOut}
    >
      {children}
    </AppShell>
  );
}

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);
  const signOut = () => {
    void auth.signOut().then(() => setSession(null));
  };

  useEffect(() => {
    const unsubscribe = auth.subscribe((next) => {
      setSession(next);
      setReady(true);
    });
    return unsubscribe;
  }, []);

  if (!ready) {
    return <div className="login-wrap muted">載入中…</div>;
  }

  return (
    <ToastProvider>
      <HashRouter>
        <Routes>
          {/* 公開看板：不需登入，只讀去識別化摘要 */}
          <Route path="/" element={<PublicBoard />} />
          <Route
            path="/login"
            element={
              session ? <Navigate to="/admin" replace /> : <Login onSignedIn={setSession} />
            }
          />
          <Route
            path="/admin/*"
            element={
              !session ? (
                <Navigate to="/login" replace />
              ) : session.roles.length === 0 ? (
                // 已登入但尚未被指派角色
                <Unauthorized session={session} onSession={setSession} onSignOut={signOut} />
              ) : (
                <AdminLayout session={session} onSignOut={signOut}>
                  <Routes>
                    <Route path="/" element={<Dashboard />} />
                    <Route path="/log" element={<InfractionLog />} />
                    <Route path="/cases" element={<PendingCases />} />
                    <Route path="/alerts" element={<AlertBoard />} />
                    <Route path="/observers" element={<ObserverDesk />} />
                    <Route path="/restrictions" element={<RestrictionList />} />
                    <Route path="/students" element={<StudentLookup />} />
                    <Route path="/students/:studentId" element={<StudentLookup />} />
                    <Route
                      path="/users"
                      element={
                        session.roles.includes('ADMIN') ? (
                          <Users session={session} />
                        ) : (
                          <Navigate to="/admin" replace />
                        )
                      }
                    />
                    <Route
                      path="/settings"
                      element={
                        session.roles.includes('ADMIN') ? <Settings /> : <Navigate to="/admin" replace />
                      }
                    />
                    <Route path="*" element={<Navigate to="/admin" replace />} />
                  </Routes>
                </AdminLayout>
              )
            }
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </HashRouter>
    </ToastProvider>
  );
}
