import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api.ts';
import { Badge, Callout, EmptyState, Field, Panel } from '../components/ui.tsx';
import { useToast } from '../components/toast.tsx';
import type { AccessUser, Role, Session } from '../lib/types.ts';

const ROLE_LABEL: Record<Role, string> = {
  DISCIPLINE_STAFF: '生活教育組長',
  ADMIN: '系統管理者',
};

/**
 * 帳號管理（僅系統管理者）
 *
 * 以 **Google 信箱**授權：可在對方登入前先行指派，
 * 對方首次用 Google 登入時系統自動套用角色。
 */
export function Users({ session }: { session: Session }) {
  const toast = useToast();
  const [users, setUsers] = useState<AccessUser[] | null>(null);
  const [bootstrapAdmins, setBootstrapAdmins] = useState<string[]>([]);
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [roles, setRoles] = useState<Role[]>(['DISCIPLINE_STAFF']);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    void api
      .listAccess()
      .then((result) => {
        setUsers(result.users);
        setBootstrapAdmins(result.bootstrapAdmins ?? []);
      })
      .catch((error) => toast.push(error instanceof Error ? error.message : '載入失敗', 'error'));
  }, [toast]);

  useEffect(load, [load]);

  const toggleRole = (role: Role) =>
    setRoles((prev) => (prev.includes(role) ? prev.filter((r) => r !== role) : [...prev, role]));

  const grant = async () => {
    setBusy(true);
    try {
      const result = await api.grantAccess(email.trim(), roles, name.trim() || undefined);
      toast.push(
        result.appliedImmediately
          ? `已授權 ${result.email}，對方重新整理後即可使用`
          : `已授權 ${result.email}，對方首次以 Google 登入時自動生效`,
      );
      setEmail('');
      setName('');
      setRoles(['DISCIPLINE_STAFF']);
      load();
    } catch (error) {
      toast.push(error instanceof Error ? error.message : '授權失敗', 'error');
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (user: AccessUser) => {
    if (!window.confirm(`確定取消 ${user.email} 的使用權限？`)) return;
    try {
      await api.revokeAccess(user.email);
      toast.push('已取消授權，該帳號的登入憑證同步失效');
      load();
    } catch (error) {
      toast.push(error instanceof Error ? error.message : '操作失敗', 'error');
    }
  };

  return (
    <>
      <Callout>
        <span aria-hidden="true">🔑</span>
        <span>
          全系統以 <strong>Google 帳號</strong>登入。管理者信箱由部署設定
          <code> ADMIN_EMAILS </code>指定；其餘人員在此以信箱授權即可，
          <strong>對方不需事先註冊</strong>。
        </span>
      </Callout>

      <Panel title="新增授權" hint="輸入對方的學校 Google 信箱">
        <div className="stack">
          <div className="form-grid">
            <Field label="Google 信箱" hint="例：discipline@example.edu.tw">
              <input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="name@example.edu.tw"
                autoFocus
              />
            </Field>
            <Field label="顯示名稱（選填）">
              <input
                type="text"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="例：王淑芬（生活教育組長）"
              />
            </Field>
          </div>

          <div className="field">
            <span className="field__label">角色</span>
            <div className="choice-grid">
              {(Object.keys(ROLE_LABEL) as Role[]).map((role) => (
                <button
                  key={role}
                  className={`choice${roles.includes(role) ? ' choice--selected' : ''}`}
                  onClick={() => toggleRole(role)}
                  aria-pressed={roles.includes(role)}
                >
                  <span className="choice__icon" aria-hidden="true">
                    {role === 'ADMIN' ? '🛠️' : '🛡️'}
                  </span>
                  <span>
                    <span className="choice__title">{ROLE_LABEL[role]}</span>
                    <br />
                    <span className="choice__desc">
                      {role === 'ADMIN'
                        ? '可管理帳號與系統設定'
                        : '可登錄違規、回收紙本、值勤與追蹤'}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          </div>

          <div className="btn-row">
            <button
              className="btn btn--primary btn--lg"
              disabled={busy || !email.includes('@') || roles.length === 0}
              onClick={() => void grant()}
            >
              {busy ? '授權中…' : '授權'}
            </button>
          </div>
        </div>
      </Panel>

      <Panel
        title="已授權帳號"
        hint={users ? `${users.length} 筆` : '載入中…'}
        flush
        actions={
          <button className="btn" onClick={load}>
            重新整理
          </button>
        }
      >
        {!users ? (
          <div className="card__body muted">載入中…</div>
        ) : users.length === 0 ? (
          <EmptyState title="尚無授權帳號" hint="於上方輸入 Google 信箱即可授權。" />
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Google 信箱</th>
                  <th>名稱</th>
                  <th>角色</th>
                  <th>登入狀態</th>
                  <th>狀態</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {users.map((user) => {
                  const isBootstrap = bootstrapAdmins.includes(user.email);
                  const isSelf = (session.email ?? '').toLowerCase() === user.email;
                  return (
                    <tr key={user.email}>
                      <td className="cell-strong">
                        {user.email}
                        {isSelf && <span className="cell-sub">（你自己）</span>}
                      </td>
                      <td>{user.name ?? '—'}</td>
                      <td>
                        <div className="row" style={{ gap: 6 }}>
                          {user.roles.length === 0 ? (
                            <span className="muted small">—</span>
                          ) : (
                            user.roles.map((role) => (
                              <Badge key={role} tone={role === 'ADMIN' ? 'serious' : 'safety'}>
                                {ROLE_LABEL[role] ?? role}
                              </Badge>
                            ))
                          )}
                        </div>
                      </td>
                      <td>
                        {user.signedInBefore ? (
                          <Badge tone="good" dot>
                            已登入過
                          </Badge>
                        ) : (
                          <Badge tone="warning" dot>
                            待首次登入
                          </Badge>
                        )}
                      </td>
                      <td>
                        {user.active ? (
                          <Badge tone="good">啟用中</Badge>
                        ) : (
                          <Badge tone="neutral">已停用</Badge>
                        )}
                      </td>
                      <td>
                        {isBootstrap ? (
                          <span className="small muted">部署設定保護</span>
                        ) : (
                          user.active && (
                            <button className="btn btn--ghost" onClick={() => void revoke(user)}>
                              取消授權
                            </button>
                          )
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </>
  );
}
