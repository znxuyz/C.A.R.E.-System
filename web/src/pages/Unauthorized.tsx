import { useState } from 'react';
import { Link } from 'react-router-dom';
import { auth } from '../lib/api.ts';
import { Callout } from '../components/ui.tsx';
import type { Session } from '../lib/types.ts';

/**
 * 已用 Google 登入、但尚未被指派角色時顯示。
 *
 * 兩種情況：
 *  - 管理者首次登入，但信箱尚未寫入部署設定 ADMIN_EMAILS
 *  - 一般同仁尚未被管理者於「帳號管理」授權
 */
export function Unauthorized({
  session,
  onSession,
  onSignOut,
}: {
  session: Session;
  onSession: (session: Session) => void;
  onSignOut: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [checked, setChecked] = useState(false);

  const recheck = async () => {
    setBusy(true);
    try {
      const next = await auth.recheckAccess();
      if (next) onSession(next);
      setChecked(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-wrap">
      <div className="card login-card">
        <div className="card__body stack">
          <div className="brand">
            <div className="brand__mark" aria-hidden="true">
              CARE
            </div>
            <div>
              <div className="brand__name">尚未授權</div>
              <div className="brand__sub">此帳號還沒有使用權限</div>
            </div>
          </div>

          <Callout tone="warning">
            <span aria-hidden="true">🔒</span>
            <span>
              你已用 <strong>{session.email ?? session.name}</strong> 登入，
              但這個帳號尚未被指派角色。
            </span>
          </Callout>

          <div className="small muted stack" style={{ gap: 6 }}>
            <div>· 若你是<strong>系統管理者</strong>：請確認此信箱已寫入部署設定 <code>ADMIN_EMAILS</code>，再按下方重新檢查。</div>
            <div>· 若你是<strong>生活教育組</strong>同仁：請請管理者在「帳號管理」頁以此信箱授權。</div>
          </div>

          <button className="btn btn--primary btn--block" disabled={busy} onClick={() => void recheck()}>
            {busy ? '檢查中…' : '重新檢查授權'}
          </button>

          {checked && session.roles.length === 0 && (
            <div className="field__error">仍未取得權限，請確認信箱是否正確後再試。</div>
          )}

          <button className="btn btn--block" onClick={onSignOut}>
            改用其他帳號登入
          </button>

          <Link className="btn btn--ghost btn--block" to="/">
            ← 返回公開看板
          </Link>
        </div>
      </div>
    </div>
  );
}
