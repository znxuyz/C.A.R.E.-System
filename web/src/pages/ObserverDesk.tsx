import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api.ts';
import {
  ASSIGNMENT_STATUS_LABEL,
  ASSIGNMENT_STATUS_TONE,
  formatDate,
  formatDateTime,
  todayTaipei,
} from '../lib/format.ts';
import { Badge, Callout, EmptyState, Panel } from '../components/ui.tsx';
import { useToast } from '../components/toast.tsx';
import type { AssignmentRow } from '../lib/types.ts';

/**
 * 安全觀察員值勤台（學務處櫃台操作）
 *
 * 一日下課共 5 節（扣除打掃時間與 5 分鐘短下課）。
 * 每節「報到 → 離開」各一次打卡；5 節完成後，學生繳交**紙本**行為檢討書，
 * 在此按「檢討書已回收」，系統即安排**隔日（下一個上課日）**解鎖。
 */
export function ObserverDesk() {
  const toast = useToast();
  const [rows, setRows] = useState<AssignmentRow[] | null>(null);
  const [filter, setFilter] = useState<'TODAY' | 'ALL'>('TODAY');
  const today = todayTaipei();

  const load = useCallback(() => {
    void api.assignments().then(setRows);
  }, []);
  useEffect(load, [load]);

  const act = async (assignment: AssignmentRow, periodNo: number, action: 'CHECK_IN' | 'CHECK_OUT') => {
    try {
      let observedCount: number | undefined;
      let note: string | undefined;
      if (action === 'CHECK_OUT') {
        const input = window.prompt(`第 ${periodNo} 節：提醒了幾位同學？（可留白）`, '0');
        if (input !== null && input.trim() !== '') observedCount = Number(input);
        note = window.prompt('觀察紀錄（可留白）', '') ?? undefined;
      }
      const result = await api.logObserverPeriod({
        assignmentId: assignment.id,
        periodNo,
        action,
        observedCount,
        note: note || undefined,
      });
      toast.push(
        action === 'CHECK_IN'
          ? `${assignment.studentName} 第 ${periodNo} 節已報到`
          : `第 ${periodNo} 節完成（累計 ${result.completedPeriods}/${assignment.totalPeriods} 節）`,
      );
      load();
    } catch (error) {
      toast.push(error instanceof Error ? error.message : '打卡失敗', 'error');
    }
  };

  const returnReview = async (assignment: AssignmentRow) => {
    try {
      const result = await api.returnConductReview(assignment.id);
      toast.push(`檢討書已回收，${formatDate(result.unlockOn)} 起恢復自由下課`);
      load();
    } catch (error) {
      toast.push(error instanceof Error ? error.message : '操作失敗', 'error');
    }
  };

  const visible = (rows ?? []).filter((row) => (filter === 'TODAY' ? row.dutyOn === today : true));

  return (
    <>
      <Callout>
        <span aria-hidden="true">👀</span>
        <span>
          值勤內容：於學務處協助觀察走廊奔跑同學並適時提醒。
          5 節完成後學生繳交<strong>紙本行為檢討書</strong>，回收後
          <strong>隔日（下一個上課日）</strong>恢復自由下課。值勤期間可正常飲水與如廁。
        </span>
      </Callout>

      <Panel
        title="值勤台"
        hint={`${visible.length} 位・${filter === 'TODAY' ? formatDate(today) : '全部日期'}`}
        actions={
          <div className="btn-row">
            <button
              className={`btn${filter === 'TODAY' ? ' btn--primary' : ''}`}
              onClick={() => setFilter('TODAY')}
            >
              今日
            </button>
            <button
              className={`btn${filter === 'ALL' ? ' btn--primary' : ''}`}
              onClick={() => setFilter('ALL')}
            >
              全部
            </button>
          </div>
        }
      >
        {!rows ? (
          <div className="muted">載入中…</div>
        ) : visible.length === 0 ? (
          <EmptyState title="今日沒有安全觀察員值勤" />
        ) : (
          <div className="stack">
            {visible.map((assignment) => {
              const done = assignment.periodLogs.filter((log) => log.checkOutAt).length;
              return (
                <div className="card" key={assignment.id}>
                  <div className="card__head">
                    <div>
                      <div className="card__title">
                        {assignment.className} {assignment.studentName}
                        <span className="muted small">（{assignment.studentNo}）</span>
                      </div>
                      <div className="small muted">
                        值勤日 {formatDate(assignment.dutyOn)}・進度 {done}/{assignment.totalPeriods} 節
                        {assignment.unlockOn ? `・解鎖日 ${formatDate(assignment.unlockOn)}` : ''}
                      </div>
                    </div>
                    <span className="spacer" />
                    <Badge tone={ASSIGNMENT_STATUS_TONE[assignment.status]} dot>
                      {ASSIGNMENT_STATUS_LABEL[assignment.status]}
                    </Badge>
                  </div>
                  <div className="card__body stack">
                    <div className="table-wrap">
                      <table className="data">
                        <thead>
                          <tr>
                            <th>節次</th>
                            <th>報到</th>
                            <th>離開</th>
                            <th>勸導人數</th>
                            <th>觀察紀錄</th>
                            <th />
                          </tr>
                        </thead>
                        <tbody>
                          {assignment.periodLogs.map((log) => (
                            <tr key={log.periodNo}>
                              <td className="cell-strong">第 {log.periodNo} 節</td>
                              <td className="cell-sub">{formatDateTime(log.checkInAt)}</td>
                              <td className="cell-sub">{formatDateTime(log.checkOutAt)}</td>
                              <td className="num">{log.observedCount ?? '—'}</td>
                              <td className="cell-sub">{log.note ?? '—'}</td>
                              <td>
                                {assignment.status === 'CLOSED' ? (
                                  <Badge tone="good">已結案</Badge>
                                ) : !log.checkInAt ? (
                                  <button
                                    className="btn"
                                    onClick={() => void act(assignment, log.periodNo, 'CHECK_IN')}
                                  >
                                    報到
                                  </button>
                                ) : !log.checkOutAt ? (
                                  <button
                                    className="btn btn--primary"
                                    onClick={() => void act(assignment, log.periodNo, 'CHECK_OUT')}
                                  >
                                    離開
                                  </button>
                                ) : (
                                  <Badge tone="good">已完成</Badge>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    {assignment.status === 'DUTY_COMPLETED' && (
                      <div className="row">
                        <Callout tone="warning">
                          <span aria-hidden="true">📝</span>
                          <span>
                            值勤已完成，請學生繳交<strong>紙本行為檢討書</strong>；
                            回收後按右側按鈕，系統將安排隔日解鎖。
                          </span>
                        </Callout>
                        <button className="btn btn--primary" onClick={() => void returnReview(assignment)}>
                          檢討書已回收
                        </button>
                      </div>
                    )}

                    {assignment.status === 'CLOSED' && assignment.unlockOn && (
                      <Callout>
                        <span aria-hidden="true">✅</span>
                        <span>
                          檢討書已於 {formatDate(assignment.reviewReturnedOn)} 回收，
                          <strong>{formatDate(assignment.unlockOn)}</strong> 起恢復自由下課。
                        </span>
                      </Callout>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Panel>
    </>
  );
}
