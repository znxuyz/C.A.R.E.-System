import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../lib/api.ts';
import { formatDate, formatDateTime } from '../lib/format.ts';
import { Badge, Callout, EmptyState, Panel, StatTile } from '../components/ui.tsx';
import type { StudentDetail } from '../lib/types.ts';

const KIND_ICON: Record<string, string> = {
  INFRACTION: '📋',
  CARD: '📝',
  ALERT: '⚠️',
  DUTY: '👀',
  REVIEW: '📄',
};

const KIND_DOT: Record<string, string> = {
  INFRACTION: '',
  CARD: ' timeline__dot--done',
  ALERT: '',
  DUTY: ' timeline__dot--wait',
  REVIEW: ' timeline__dot--wait',
};

/** 學生查詢 + 個人行為歷程（輔導會議與親師溝通使用） */
export function StudentLookup() {
  const { studentId } = useParams();
  const [keyword, setKeyword] = useState('');
  const [results, setResults] = useState<
    Array<{ id: string; studentNo: string; name: string; className: string; windowCardCount?: number }>
  >([]);
  const [detail, setDetail] = useState<StudentDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!studentId) {
      setDetail(null);
      return;
    }
    setError(null);
    void api
      .student(studentId)
      .then(setDetail)
      .catch((err) => setError(err instanceof Error ? err.message : '載入失敗'));
  }, [studentId]);

  useEffect(() => {
    if (keyword.trim().length < 2) {
      setResults([]);
      return;
    }
    void api.searchStudent(keyword).then(setResults);
  }, [keyword]);

  if (studentId) {
    if (error) return <div className="field__error">{error}</div>;
    if (!detail) return <div className="muted">載入中…</div>;

    return (
      <>
        <div className="row">
          <Link className="btn btn--ghost" to="/office/students">
            ← 返回查詢
          </Link>
        </div>

        <Panel
          title={`${detail.className} ${detail.name}`}
          hint={`學號 ${detail.studentNo}${detail.guardianEmail ? `・家長信箱 ${detail.guardianEmail}` : ''}`}
          actions={
            detail.restrictedToday ? (
              <Badge tone="critical" dot>
                今日管制中
              </Badge>
            ) : (
              <Badge tone="good" dot>
                今日可自由下課
              </Badge>
            )
          }
        >
          <div className="grid grid--kpi">
            <StatTile
              label="累犯視窗內張數"
              value={`${detail.progress.cardCount} / ${detail.progress.threshold}`}
              foot={`${detail.progress.windowStart} ~ ${detail.progress.windowEnd}`}
              meter={{
                value: detail.progress.cardCount,
                max: detail.progress.threshold,
                tone: detail.progress.cardCount >= detail.progress.threshold ? 'critical' : 'warning',
              }}
              tone={detail.progress.cardCount >= detail.progress.threshold ? 'alert' : undefined}
            />
            <StatTile label="累計違規登錄" value={detail.totals.infractions} unit="件" />
            <StatTile label="累計反思卡" value={detail.totals.cards} unit="張" />
            <StatTile label="安全觀察員值勤" value={detail.totals.duties} unit="次" />
          </div>
          {detail.progress.shortfall > 0 && detail.progress.cardCount > 0 && (
            <Callout tone={detail.progress.shortfall <= 1 ? 'warning' : undefined}>
              <span aria-hidden="true">{detail.progress.shortfall <= 1 ? '⚠️' : 'ℹ️'}</span>
              <span>
                再 <strong>{detail.progress.shortfall}</strong> 張反思卡即觸發累犯警示，
                建議提前安排晤談或正向支持措施。
              </span>
            </Callout>
          )}
        </Panel>

        <Panel title="行為歷程" hint="含違規登錄、反思卡、警示與值勤紀錄">
          {detail.timeline.length === 0 ? (
            <EmptyState title="尚無任何紀錄" />
          ) : (
            <div className="timeline">
              {detail.timeline.map((item) => (
                <div className="timeline__item" key={`${item.kind}-${item.id}`}>
                  <span className={`timeline__dot${KIND_DOT[item.kind] ?? ''}`} />
                  <div>
                    <div className="timeline__title">
                      <span aria-hidden="true">{KIND_ICON[item.kind]} </span>
                      {item.title}
                    </div>
                    <div className="timeline__meta">
                      {formatDateTime(item.at)}・{item.detail}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Panel>
      </>
    );
  }

  return (
    <Panel title="學生查詢" hint="輸入學號或姓名">
      <div className="stack">
        <input
          type="text"
          value={keyword}
          onChange={(event) => setKeyword(event.target.value)}
          placeholder="例：1140101 或 王小明"
          autoFocus
        />
        {results.length === 0 ? (
          <div className="muted small">請輸入 2 個字以上進行查詢。</div>
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>班級</th>
                  <th>學號</th>
                  <th>姓名</th>
                  <th>15 天內張數</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {results.map((row) => (
                  <tr key={row.id}>
                    <td>{row.className}</td>
                    <td className="num">{row.studentNo}</td>
                    <td className="cell-strong">{row.name}</td>
                    <td className="num">
                      {typeof row.windowCardCount === 'number' ? (
                        <Badge tone={row.windowCardCount >= 2 ? 'critical' : 'neutral'}>
                          {row.windowCardCount} / 3
                        </Badge>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td>
                      <Link className="btn" to={`/office/students/${row.id}`}>
                        查看歷程
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="small muted">
          查詢日：{formatDate(new Date().toISOString())}｜歷程資料含違規登錄、反思卡、累犯警示與值勤紀錄。
        </div>
      </div>
    </Panel>
  );
}
