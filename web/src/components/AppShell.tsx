import { NavLink } from 'react-router-dom';
import type { ReactNode } from 'react';
import { formatDate, weekdayLabel } from '../lib/format.ts';
import { USE_MOCK } from '../lib/api.ts';
import type { Session } from '../lib/types.ts';

export interface NavItem {
  to: string;
  label: string;
  icon: string;
  badge?: number;
  group: string;
}

/** 以台北時間顯示建置時間（月/日 時:分） */
function buildStamp(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('zh-TW', {
    timeZone: 'Asia/Taipei',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

export function AppShell({
  session,
  items,
  title,
  subtitle,
  actions,
  today,
  onSignOut,
  children,
}: {
  session: Session;
  items: NavItem[];
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
  today: string;
  onSignOut: () => void;
  children: ReactNode;
}) {
  const groups = [...new Set(items.map((item) => item.group))];

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand__mark" aria-hidden="true">
            CARE
          </div>
          <div>
            <div className="brand__name">C.A.R.E. System</div>
            <div className="brand__sub">違規登錄與再犯追蹤</div>
          </div>
        </div>

        <nav className="nav" aria-label="主導覽">
          {groups.map((group) => (
            <div key={group}>
              <div className="nav__group">{group}</div>
              {items
                .filter((item) => item.group === group)
                .map((item) => (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    className={({ isActive }) =>
                      `nav__item${isActive ? ' nav__item--active' : ''}`
                    }
                  >
                    <span aria-hidden="true">{item.icon}</span>
                    <span>{item.label}</span>
                    {item.badge ? <span className="nav__badge">{item.badge}</span> : null}
                  </NavLink>
                ))}
            </div>
          ))}
        </nav>

        <div className="sidebar__footer">
          <div>
            <strong>{session.name}</strong>
          </div>
          <a href="#/" target="_blank" rel="noreferrer">
            開啟公開看板 ↗
          </a>
          {USE_MOCK && <div className="badge badge--warning">示範模式（模擬資料）</div>}
          <button className="btn btn--ghost" onClick={onSignOut} style={{ justifyContent: 'flex-start', padding: 0 }}>
            登出
          </button>
          {/* 版本標記：用來確認眼前畫面是不是最新部署（而非瀏覽器快取） */}
          <div className="build-tag" title={`建置時間 ${__BUILD_INFO__.at}`}>
            版本 {__BUILD_INFO__.sha}・{buildStamp(__BUILD_INFO__.at)}
          </div>
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <div>
            <h1 className="topbar__title">{title}</h1>
            {subtitle && <div className="topbar__meta">{subtitle}</div>}
          </div>
          <span className="topbar__spacer" />
          <div className="topbar__meta">
            {formatDate(today)}（{weekdayLabel(today)}）
          </div>
          {actions}
        </header>
        <main className="content">{children}</main>
      </div>
    </div>
  );
}
