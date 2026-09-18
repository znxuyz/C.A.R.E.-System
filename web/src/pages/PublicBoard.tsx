import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.ts';
import { RESTRICTION_REASON_LABEL, formatDate, formatDateTime, weekdayLabel } from '../lib/format.ts';
import { Badge, Callout, EmptyState, Panel, StatTile } from '../components/ui.tsx';
import { HotspotBars, TrendChart } from '../components/charts.tsx';
import type { PublicBoardData } from '../lib/types.ts';

/**
 * 公開唯讀看板（不需登入）
 *
 * 隱私設計：本頁**不讀取任何業務集合**，只讀一份由伺服器產生的去識別化摘要
 * （`publicBoard/today`）。預設僅顯示統計數字；若生教組於設定開啟名單，
 * 也只會出現「班級＋座號」，永不出現姓名或學號。
 */
export function PublicBoard() {
  const [board, setBoard] = useState<PublicBoardData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .publicBoard()
      .then(setBoard)
      .catch((err) => setError(err instanceof Error ? err.message : '載入失敗'));
  }, []);

  return (
    <div className="public">
      <header className="public__head">
        <div className="brand">
          <div className="brand__mark" aria-hidden="true">
            CARE
          </div>
          <div>
            <div className="brand__name">C.A.R.E. System</div>
            <div className="brand__sub">校園行為反思與追蹤・公開看板</div>
          </div>
        </div>
        <span className="spacer" />
        <Link className="btn" to="/login">
          生教組登入
        </Link>
      </header>

      <main className="public__body">
        {error && <div className="field__error">{error}</div>}
        {!board ? (
          <div className="muted">載入中…</div>
        ) : !board.enabled ? (
          <EmptyState icon="🔒" title="公開看板目前未開放" hint="請洽生活教育組。" />
        ) : (
          <>
            <Callout>
              <span aria-hidden="true">ℹ️</span>
              <span>
                本頁為<strong>去識別化</strong>的每日概況，不含學生姓名、學號或個別違規明細。
                資料更新時間：{formatDateTime(board.updatedAt)}
              </span>
            </Callout>

            <div className="grid grid--kpi">
              <StatTile icon="⛔" label="今日下課管制中" value={board.stats.restrictedCount} unit="人" />
              <StatTile icon="👀" label="今日安全觀察員" value={board.stats.observersToday} unit="人" />
              <StatTile icon="📋" label="今日違規登錄" value={board.stats.infractionsToday} unit="件" />
              <StatTile
                icon="⚠️"
                label="追蹤中的再犯案件"
                value={board.stats.openAlerts}
                unit="案"
                tone={board.stats.openAlerts > 0 ? 'alert' : undefined}
              />
              <StatTile icon="📈" label="近 14 天違規" value={board.stats.infractions14d} unit="件" />
            </div>

            <div className="grid grid--2">
              <Panel title="近 14 天違規次數" hint="依類型堆疊">
                <TrendChart data={board.trend} />
              </Panel>
              <Panel title="違規熱點 Top 5" hint="作為導護站位與宣導依據">
                <HotspotBars data={board.hotspots} />
              </Panel>
            </div>

            {board.roster && (
              <Panel
                title={`今日下課管制名單（${formatDate(board.date)} 週${weekdayLabel(board.date)}）`}
                hint="僅顯示班級與座號"
                flush
              >
                {board.roster.length === 0 ? (
                  <EmptyState title="今天沒有管制名單" />
                ) : (
                  <div className="table-wrap">
                    <table className="data">
                      <thead>
                        <tr>
                          <th>班級</th>
                          <th>座號</th>
                          <th>管制原因</th>
                        </tr>
                      </thead>
                      <tbody>
                        {board.roster.map((row, index) => (
                          <tr key={`${row.className}-${row.seatNo}-${index}`}>
                            <td>{row.className}</td>
                            <td className="num">{row.seatNo ?? '—'}</td>
                            <td>
                              <div className="row" style={{ gap: 6 }}>
                                {row.reasons.map((reason) => (
                                  <Badge key={reason} tone="serious">
                                    {RESTRICTION_REASON_LABEL[reason]}
                                  </Badge>
                                ))}
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Panel>
            )}

            <Callout>
              <span aria-hidden="true">💧</span>
              <span>
                管制期間學生<strong>可正常飲水與如廁</strong>；反思屬教育歷程，非剝奪基本需求。
              </span>
            </Callout>
          </>
        )}
      </main>

      <footer className="public__foot">
        C.A.R.E. System — Conduct Assessment &amp; Reflection Education System
      </footer>
    </div>
  );
}
