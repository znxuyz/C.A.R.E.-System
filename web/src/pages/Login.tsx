import { useState } from 'react';
import { Link } from 'react-router-dom';
import { USE_MOCK, auth } from '../lib/api.ts';
import { Callout, Field } from '../components/ui.tsx';
import type { Session } from '../lib/types.ts';

/** 登入（單一帳號：生活教育組長） */
export function Login({ onSignedIn }: { onSignedIn: (session: Session) => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const signIn = async () => {
    setBusy(true);
    setError(null);
    try {
      onSignedIn(await auth.signIn(email, password));
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

          {USE_MOCK ? (
            <>
              <Callout>
                目前為<strong>示範模式</strong>（不連線 Firebase，資料僅存在瀏覽器）。
                直接按下方按鈕即可體驗完整操作。
              </Callout>
              <button
                className="btn btn--primary btn--lg btn--block"
                disabled={busy}
                onClick={() => void signIn()}
              >
                {busy ? '登入中…' : '以生活教育組長身分進入'}
              </button>
            </>
          ) : (
            <form
              className="stack"
              onSubmit={(event) => {
                event.preventDefault();
                void signIn();
              }}
            >
              <Field label="校務帳號（Email）">
                <input
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  autoComplete="username"
                  required
                  autoFocus
                />
              </Field>
              <Field label="密碼">
                <input
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  autoComplete="current-password"
                  required
                />
              </Field>
              <button className="btn btn--primary btn--lg btn--block" disabled={busy}>
                {busy ? '登入中…' : '登入'}
              </button>
            </form>
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
