import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api.ts';
import {
  CASE_STATUS_LABEL,
  CASE_STATUS_TONE,
  FORM_KIND_TONE,
  formatDate,
  formatDateTime,
} from '../lib/format.ts';
import { Badge, EmptyState, Panel } from '../components/ui.tsx';
import { CardReviewDrawer } from '../components/CardReviewDrawer.tsx';
import type { CardSummary, Session } from '../lib/types.ts';

/**
 * 審核佇列
 *  - 生教組（stage=DISCIPLINE_OFFICE）：第二層蓋章，先進先出
 *  - 導師（stage=HOMEROOM_TEACHER）：第一層簽章，只看自己班級
 */
export function ReviewQueue({
  session,
  stage,
}: {
  session: Session;
  stage: 'HOMEROOM_TEACHER' | 'DISCIPLINE_OFFICE';
}) {
  const [rows, setRows] = useState<CardSummary[] | null>(null);
  const [active, setActive] = useState<string | null>(null);

  const load = useCallback(() => {
    if (stage === 'DISCIPLINE_OFFICE') {
      void api.officeQueue().then(setRows);
      return;
    }
    // 導師只看自己所轄班級（班級清單取自 staff/{uid}.classIds）
    void api
      .myClassIds(session.uid)
      .then((classIds) => api.teacherQueue(classIds))
      .then(setRows);
  }, [stage, session.uid]);

  useEffect(load, [load]);

  const isOffice = stage === 'DISCIPLINE_OFFICE';

  return (
    <>
      <Panel
        title={isOffice ? '待生教組蓋章' : '待導師簽章'}
        hint={rows ? `${rows.length} 件・依送達時間先後排序` : '載入中…'}
        flush
        actions={
          <button className="btn" onClick={load}>
            重新整理
          </button>
        }
      >
        {!rows ? (
          <div className="card__body muted">載入中…</div>
        ) : rows.length === 0 ? (
          <EmptyState
            title={isOffice ? '沒有待蓋章的案件' : '沒有待簽章的案件'}
            hint="所有案件都已處理完畢。"
          />
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>班級 / 學生</th>
                  <th>違規類型</th>
                  <th>反思卡</th>
                  <th>{isOffice ? '導師簽章' : '學生送出'}</th>
                  <th>累犯進度</th>
                  <th>狀態</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((card) => (
                  <tr key={card.id}>
                    <td className="cell-strong">
                      {card.className} {card.studentName}
                      <div className="cell-sub">
                        {card.studentNo}・違規日 {formatDate(card.countOn)}
                      </div>
                    </td>
                    <td>{card.typeName}</td>
                    <td>
                      <Badge tone={FORM_KIND_TONE[card.formKind]}>{card.formTitle}</Badge>
                    </td>
                    <td className="cell-sub">
                      {isOffice
                        ? `${card.teacherName ?? ''} ${formatDateTime(card.teacherSignedAt)}`
                        : formatDateTime(card.submittedAt)}
                    </td>
                    <td className="num">
                      {typeof card.windowCardCount === 'number' ? (
                        <Badge tone={card.windowCardCount >= 2 ? 'critical' : 'neutral'}>
                          {card.windowCardCount} / 3 張
                        </Badge>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td>
                      <Badge tone={CASE_STATUS_TONE[card.status]}>
                        {CASE_STATUS_LABEL[card.status]}
                      </Badge>
                    </td>
                    <td>
                      <button className="btn btn--primary" onClick={() => setActive(card.id)}>
                        {isOffice ? '審核蓋章' : '查看並簽章'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {active && (
        <CardReviewDrawer
          cardId={active}
          stage={stage}
          actorName={session.name}
          onClose={() => setActive(null)}
          onDone={load}
        />
      )}
    </>
  );
}
