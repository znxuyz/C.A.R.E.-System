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
