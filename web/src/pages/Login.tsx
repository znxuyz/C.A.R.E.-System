import { useState } from 'react';
import { USE_MOCK, auth } from '../lib/api.ts';
import { Callout, Field } from '../components/ui.tsx';
import type { Session } from '../lib/types.ts';

const DEMO_ROLES = [
  { key: 'office', label: '生教組', desc: '審核蓋章、登錄違規、累犯追蹤、值勤台', icon: '🛡️' },
  { key: 'teacher', label: '班導師', desc: '線上簽章、勾選班級活動優先', icon: '✍️' },
  { key: 'patrol', label: '糾察隊／巡堂教師', desc: '快速登錄違規', icon: '📋' },
  { key: 'student', label: '學生', desc: '填寫反思卡、查詢下課狀態', icon: '🎒' },
];

export function Login({ onSignedIn }: { onSignedIn: (session: Session) => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const signIn = async (identifier: string, pass = '') => {
    setBusy(true);
    setError(null);
    try {
      onSignedIn(await auth.signIn(identifier, pass));
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
              <div className="brand__sub">Conduct Assessment &amp; Reflection Education</div>
            </div>
          </div>

          <p className="small muted">
            校園行為反思與追蹤系統｜違規登錄・雙軌反思卡・導師簽章・生教組蓋章・累犯警示
          </p>

          {USE_MOCK ? (
            <>
              <Callout>
                目前為<strong>示範模式</strong>（不連線 Firebase，資料僅存在瀏覽器）。
                請選擇一個角色體驗操作動線。
              </Callout>
              <div className="stack">
                {DEMO_ROLES.map((role) => (
                  <button
                    key={role.key}
                    className="choice"
                    onClick={() => void signIn(role.key)}
                    disabled={busy}
                  >
                    <span className="choice__icon" aria-hidden="true">
                      {role.icon}
                    </span>
                    <span>
                      <span className="choice__title">以「{role.label}」身分登入</span>
                      <br />
                      <span className="choice__desc">{role.desc}</span>
                    </span>
                  </button>
                ))}
              </div>
            </>
          ) : (
            <form
              className="stack"
              onSubmit={(event) => {
                event.preventDefault();
                void signIn(email, password);
              }}
            >
              <Field label="校務帳號（Email）">
                <input
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  autoComplete="username"
                  required
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
        </div>
      </div>
    </div>
  );
}
