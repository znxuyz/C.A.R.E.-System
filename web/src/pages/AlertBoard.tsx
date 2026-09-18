import { Fragment, useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.ts';
import { FORM_KIND_LABEL, formatDate, formatDateTime } from '../lib/format.ts';
import { Badge, Callout, EmptyState, Panel } from '../components/ui.tsx';
import { useToast } from '../components/toast.tsx';
import type { AlertRow } from '../lib/types.ts';

const ALERT_TONE: Record<AlertRow['status'], string> = {
  OPEN: 'critical',
  ACKNOWLEDGED: 'warning',
  ASSIGNED: 'serious',
  CLOSED: 'good',
  DISMISSED: 'neutral',
};

const ALERT_LABEL: Record<AlertRow['status'], string> = {
  OPEN: '待確認',
  ACKNOWLEDGED: '已確認',
  ASSIGNED: '已派安全觀察員',
  CLOSED: '已結案',
  DISMISSED: '已撤銷',
};

/** 累犯警示與安全觀察員追蹤清單 */
export function AlertBoard() {
  const toast = useToast();
  const [rows, setRows] = useState<AlertRow[] | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = useCallback(() => {
    void api.alerts().then(setRows);
  }, []);
  useEffect(load, [load]);

  const dismiss = async (alert: AlertRow) => {
    const reason = window.prompt(
      `撤銷 ${alert.studentName} 的累犯警示，請說明理由（將寫入稽核軌跡）：`,
      '',
    );
    if (!reason?.trim()) return;
    try {
      await api.dismissAlert(alert.id, reason.trim());
      toast.push('已撤銷警示，計入的反思卡回復為可計數狀態');
      load();
    } catch (error) {
      toast.push(error instanceof Error ? error.message : '操作失敗', 'error');
    }
  };

  const reschedule = async (alert: AlertRow) => {
    if (!alert.assignmentId) return;
    const dutyOn = window.prompt('請輸入新的值勤日（YYYY-MM-DD）：', alert.dutyOn ?? '');
    if (!dutyOn || !/^\d{4}-\d{2}-\d{2}$/.test(dutyOn)) return;
    try {
      await api.rescheduleDuty(alert.assignmentId, dutyOn);
      toast.push(`已改期至 ${dutyOn}，並同步調整下課管制`);
      load();
    } catch (error) {
      toast.push(error instanceof Error ? error.message : '改期失敗', 'error');
    }
  };

  return (
    <>
      <Callout tone="warning">
        <span aria-hidden="true">⚠️</span>
        <span>
          觸發規則：同一學生於 <strong>15 天內（含當天）</strong>累計填寫
          <strong> 3 張</strong>反思卡（不論安全卡或好話卡）即發出警示，並自動排入
          安全觀察員追蹤清單。已計入的卡片會被「認列」，不會對同一波處分重複觸發。
        </span>
      </Callout>

      <Panel title="累犯警示" hint={rows ? `${rows.length} 筆` : '載入中…'} flush>
        {!rows ? (
          <div className="card__body muted">載入中…</div>
        ) : rows.length === 0 ? (
          <EmptyState title="目前沒有累犯警示" hint="持續關注 15 天內累計 2 張的學生。" />
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>學生</th>
                  <th>觸發時間</th>
                  <th>視窗</th>
                  <th>張數</th>
                  <th>值勤日</th>
                  <th>狀態</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((alert) => (
                  <Fragment key={alert.id}>
                    <tr>
                      <td className="cell-strong">
                        <Link to={`/office/students/${alert.studentId}`}>
                          {alert.className} {alert.studentName}
                        </Link>
                        <div className="cell-sub">{alert.studentNo}</div>
                      </td>
                      <td className="cell-sub">{formatDateTime(alert.triggeredAt)}</td>
                      <td className="cell-sub">
                        {alert.windowStart} ~ {alert.windowEnd}
                        <div className="cell-sub">（{alert.windowDays} 天）</div>
                      </td>
                      <td className="num">
                        <Badge tone="critical">
                          {alert.cardCount} / {alert.threshold}
                        </Badge>
                      </td>
                      <td>{alert.dutyOn ? formatDate(alert.dutyOn) : '待排'}</td>
                      <td>
                        <Badge tone={ALERT_TONE[alert.status]} dot>
                          {ALERT_LABEL[alert.status]}
                        </Badge>
                      </td>
                      <td>
                        <div className="btn-row">
                          <button
                            className="btn"
                            onClick={() => setExpanded(expanded === alert.id ? null : alert.id)}
                          >
                            {expanded === alert.id ? '收合' : '依據'}
                          </button>
                          {alert.assignmentId && alert.status !== 'DISMISSED' && (
                            <button className="btn" onClick={() => void reschedule(alert)}>
                              改期
                            </button>
                          )}
                          {alert.status !== 'DISMISSED' && alert.status !== 'CLOSED' && (
                            <button className="btn btn--ghost" onClick={() => void dismiss(alert)}>
                              撤銷
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                    {expanded === alert.id && (
                      <tr>
                        <td colSpan={7} style={{ background: 'var(--surface-sunken)' }}>
                          <div className="small">
                            <strong>計入本次警示的反思卡</strong>（已認列，不再重複計數）
                          </div>
                          <ul className="small" style={{ margin: '6px 0 0', paddingLeft: 18 }}>
                            {alert.breakdown.map((item) => (
                              <li key={item.cardId}>
                                {formatDate(item.countOn)}｜{FORM_KIND_LABEL[item.formKind]}
                                <span className="muted">（卡片 {item.cardId}）</span>
                              </li>
                            ))}
                          </ul>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </>
  );
}
