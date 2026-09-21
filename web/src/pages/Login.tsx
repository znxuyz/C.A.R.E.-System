import { useState } from 'react';
import { Link } from 'react-router-dom';
import { USE_MOCK, auth } from '../lib/api.ts';
import { Callout } from '../components/ui.tsx';
import type { Session } from '../lib/types.ts';

/** 登入（Google 帳號） */
export function Login({ onSignedIn }: { onSignedIn: (session: Session) => void }) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const signIn = async () => {
    setBusy(true);
    setError(null);
    try {
      onSignedIn(await auth.signInWithGoogle());
    } catch (err) {
      setError(err instanceof Error ? err.message : '登入失敗');
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
              <div className="brand__name">C.A.R.E. System</div>
              <div className="brand__sub">生活教育組登入</div>
            </div>
          </div>

          {USE_MOCK && (
            <Callout>
              目前為<strong>示範模式</strong>（不連線 Firebase，資料僅存在瀏覽器）。
              按下按鈕即可體驗完整操作。
            </Callout>
          )}

          <button
            className="btn btn--primary btn--lg btn--block"
            disabled={busy}
            onClick={() => void signIn()}
          >
            <span aria-hidden="true" className="google-mark">
              G
            </span>
            {busy ? '登入中…' : USE_MOCK ? '以示範帳號進入' : '使用 Google 帳號登入'}
          </button>

          {!USE_MOCK && (
            <p className="small muted">
              請使用學校配發的 Google 帳號登入。
              首次登入若顯示「尚未授權」，請聯繫系統管理者指派權限。
            </p>
          )}

          {error && <div className="field__error">{error}</div>}

          <Link className="btn btn--ghost btn--block" to="/">
            ← 返回公開看板
          </Link>
        </div>
      </div>
    </div>
  );
}
