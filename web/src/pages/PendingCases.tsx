import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.ts';
import {
  INFRACTION_STATUS_LABEL,
  INFRACTION_STATUS_TONE,
  PAPER_CARD_LABEL,
  PAPER_CARD_TONE,
  formatDate,
} from '../lib/format.ts';
import { Badge, Callout, EmptyState, Panel } from '../components/ui.tsx';
import { useToast } from '../components/toast.tsx';
import type { InfractionRow } from '../lib/types.ts';

/**
 * 待回收紙本反思卡
 *
 * 一鍵「已回收」→ 當日解除下課管制。
 * 另可「免記」（班級活動優先等事由）或「撤銷」（誤報），兩者都不計入再犯。
 */
export function PendingCases() {
  const toast = useToast();
  const [rows, setRows] = useState<InfractionRow[] | null>(null);

  const load = useCallback(() => {
    void api.pendingPapers().then(setRows);
  }, []);
  useEffect(load, [load]);

  const returnPaper = async (row: InfractionRow) => {
    try {
      await api.returnPaperCard(row.id);
      toast.push(`${row.studentName} 的${row.paperCardLabel ?? PAPER_CARD_LABEL[row.paperCard]}已回收，今日管制解除`);
      load();
    } catch (error) {
      toast.push(error instanceof Error ? error.message : '操作失敗', 'error');
    }
  };

  const annotate = async (row: InfractionRow, action: 'EXEMPT' | 'VOID') => {
    const label = action === 'EXEMPT' ? '免記' : '撤銷';
    const reason = window.prompt(
      `${label} ${row.studentName}（${row.typeName}），請填寫事由（將寫入稽核軌跡）：`,
      action === 'EXEMPT' ? '班級活動優先' : '誤報',
    );
    if (!reason?.trim()) return;
    try {
      await api.annotate(row.id, action, reason.trim());
      toast.push(`已${label}，本件不計入再犯次數`);
      load();
    } catch (error) {
      toast.push(error instanceof Error ? error.message : '操作失敗', 'error');
    }
  };

  return (
    <>
      <Callout>
        <span aria-hidden="true">📄</span>
        <span>
          學生完成<strong>紙本</strong>反思卡並繳回後，在此按「已回收」，系統即
          <strong>當日解除</strong>該生下課管制。未回收者會由排程每日續管制。
        </span>
      </Callout>

      <Panel
        title="待回收紙本反思卡"
        hint={rows ? `${rows.length} 件` : '載入中…'}
        flush
        actions={
          <div className="btn-row">
            <button className="btn" onClick={load}>
              重新整理
            </button>
            <Link className="btn btn--primary" to="/admin/log">
              ＋ 登錄違規
            </Link>
          </div>
        }
      >
        {!rows ? (
          <div className="card__body muted">載入中…</div>
        ) : rows.length === 0 ? (
          <EmptyState title="沒有待回收的紙本反思卡" hint="所有案件都已處理完畢。" />
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>班級 / 學生</th>
                  <th>違規類型</th>
                  <th>應繳卡別</th>
                  <th>違規日</th>
                  <th>地點・節次</th>
                  <th>15 天內</th>
                  <th>狀態</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td className="cell-strong">
                      <Link to={`/admin/students/${row.studentId}`}>
                        {row.className} {row.studentName}
                      </Link>
                      <div className="cell-sub">{row.studentNo}</div>
                    </td>
                    <td>{row.typeName}</td>
                    <td>
                      <Badge tone={PAPER_CARD_TONE[row.paperCard]}>
                        {row.paperCardLabel ?? PAPER_CARD_LABEL[row.paperCard]}
                      </Badge>
                    </td>
                    <td>{formatDate(row.occurredOn)}</td>
                    <td className="cell-sub">
                      {row.locationName}
                      {row.periodNo ? `・第 ${row.periodNo} 節` : ''}
                    </td>
                    <td className="num">
                      {typeof row.windowCount === 'number' ? (
                        <Badge tone={row.windowCount >= 2 ? 'critical' : 'neutral'}>
                          {row.windowCount} / 3
                        </Badge>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td>
                      <Badge tone={INFRACTION_STATUS_TONE[row.status]} dot>
                        {INFRACTION_STATUS_LABEL[row.status]}
                      </Badge>
                    </td>
                    <td>
                      <div className="btn-row">
                        <button className="btn btn--primary" onClick={() => void returnPaper(row)}>
                          已回收
                        </button>
                        <button className="btn" onClick={() => void annotate(row, 'EXEMPT')}>
                          免記
                        </button>
                        <button className="btn btn--ghost" onClick={() => void annotate(row, 'VOID')}>
                          撤銷
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </>
  );
}
