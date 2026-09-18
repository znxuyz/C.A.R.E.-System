import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.ts';
import { RESTRICTION_REASON_LABEL, formatDate, todayTaipei, weekdayLabel } from '../lib/format.ts';
import { Badge, EmptyState, Panel, WaterNotice } from '../components/ui.tsx';
import type { RestrictionRow } from '../lib/types.ts';

/** 下課管制名單（可查任一日；供學務處印出張貼於值班台） */
export function RestrictionList() {
  const [date, setDate] = useState(todayTaipei());
  const [rows, setRows] = useState<RestrictionRow[] | null>(null);

  useEffect(() => {
    setRows(null);
    void api.restrictions(date).then(setRows);
  }, [date]);

  const active = (rows ?? []).filter((row) => row.status === 'ACTIVE');

  return (
    <>
      <Panel
        title="下課管制名單"
        hint={`${formatDate(date)}（${weekdayLabel(date)}）・管制中 ${active.length} 人`}
        actions={
          <div className="row">
            <input
              type="date"
              value={date}
              onChange={(event) => setDate(event.target.value)}
              style={{ width: 170 }}
            />
            <button className="btn" onClick={() => window.print()}>
              列印
            </button>
          </div>
        }
        flush
      >
        {!rows ? (
          <div className="card__body muted">載入中…</div>
        ) : rows.length === 0 ? (
          <EmptyState title="該日無管制名單" />
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>班級</th>
                  <th>學號</th>
                  <th>姓名</th>
                  <th>管制原因</th>
                  <th>節次</th>
                  <th>狀態</th>
                  <th>備註</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td>{row.className}</td>
                    <td className="num">{row.studentNo}</td>
                    <td className="cell-strong">
                      <Link to={`/office/students/${row.studentId}`}>{row.studentName}</Link>
                    </td>
                    <td>
                      <div className="row" style={{ gap: 6 }}>
                        {row.reasons.length === 0 ? (
                          <span className="muted small">—</span>
                        ) : (
                          row.reasons.map((reason) => (
                            <Badge key={reason} tone="serious">
                              {RESTRICTION_REASON_LABEL[reason]}
                            </Badge>
                          ))
                        )}
                      </div>
                    </td>
                    <td className="cell-sub">
                      {row.reasons.includes('OBSERVER_DUTY') ? '1–5 節' : '全部下課'}
                    </td>
                    <td>
                      {row.status === 'ACTIVE' ? (
                        <Badge tone="critical" dot>
                          管制中
                        </Badge>
                      ) : (
                        <Badge tone="good" dot>
                          已解除
                        </Badge>
                      )}
                    </td>
                    <td className="cell-sub">{row.note ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
      <WaterNotice />
    </>
  );
}
