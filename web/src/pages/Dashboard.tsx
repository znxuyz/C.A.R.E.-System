import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.ts';
import {
  ASSIGNMENT_STATUS_LABEL,
  ASSIGNMENT_STATUS_TONE,
  PAPER_CARD_LABEL,
  PAPER_CARD_TONE,
  RESTRICTION_REASON_LABEL,
  formatDate,
} from '../lib/format.ts';
import { Badge, EmptyState, Panel, StatTile, WaterNotice } from '../components/ui.tsx';
import { HotspotBars, TrendChart } from '../components/charts.tsx';
import type { DashboardData } from '../lib/types.ts';

/**
 * 生教組長儀表板
 *
 * 資訊優先序（依學務處作業節奏）：
 *  1. 今天誰要管制／誰要值勤 → 下課前 1 分鐘要看得到
 *  2. 還有幾張紙本沒回收 → 今日待辦
 *  3. 誰觸發再犯、誰快要觸發 → 輔導介入時機
 *  4. 趨勢與熱點 → 期末報表與導護排班依據
 */
export function Dashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .dashboard()
      .then(setData)
      .catch((err) => setError(err instanceof Error ? err.message : '載入失敗'));
  }, []);

  if (error) return <div className="field__error">{error}</div>;
  if (!data) return <div className="muted">載入中…</div>;
  const { kpis } = data;

  return (
    <>
      <div className="grid grid--kpi">
        <StatTile
          icon="⛔"
          label="今日下課管制中"
          value={kpis.restrictedActive}
          unit="人"
          foot={<Link to="/admin/restrictions">查看名單 →</Link>}
        />
        <StatTile
          icon="📄"
          label="待回收紙本反思卡"
          value={kpis.pendingPapers}
          unit="件"
          foot={<Link to="/admin/cases">前往處理 →</Link>}
        />
        <StatTile
          icon="⚠️"
          label="再犯警示"
          value={kpis.openAlerts}
          unit="案"
          tone={kpis.openAlerts > 0 ? 'alert' : undefined}
          foot={<Link to="/admin/alerts">追蹤清單 →</Link>}
        />
        <StatTile
          icon="👀"
          label="今日安全觀察員"
          value={kpis.observersToday}
          unit="人"
          foot={<Link to="/admin/observers">值勤台 →</Link>}
        />
        <StatTile icon="📋" label="今日違規登錄" value={kpis.infractionsToday} unit="件" foot={<Link to="/admin/log">＋ 登錄違規</Link>} />
        <StatTile
          icon="📈"
          label="關注名單（未達門檻）"
          value={kpis.watchlist}
          unit="人"
          foot="15 天內已有 1–2 次"
        />
      </div>

      <WaterNotice />

      <div className="grid grid--2">
        <Panel title="近 14 天違規次數" hint="依類型堆疊">
          <TrendChart data={data.trend} />
        </Panel>
        <Panel title="違規熱點 Top 5" hint="作為導護站位與宣導依據">
          <HotspotBars data={data.hotspots} />
        </Panel>
      </div>

      <Panel
        title={`今日下課管制名單（${formatDate(data.today)}）`}
        hint={`${data.restrictions.filter((r) => r.status === 'ACTIVE').length} 人管制中`}
        flush
        actions={
          <Link className="btn btn--primary" to="/admin/log">
            ＋ 登錄違規
          </Link>
        }
      >
        {data.restrictions.length === 0 ? (
          <EmptyState title="今天沒有任何學生被管制" hint="很棒的一天。" />
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>班級</th>
                  <th>座號</th>
                  <th>學號</th>
                  <th>姓名</th>
                  <th>管制原因</th>
                  <th>狀態</th>
                </tr>
              </thead>
              <tbody>
                {data.restrictions.map((row) => (
                  <tr key={row.id}>
                    <td>{row.className}</td>
                    <td className="num">{row.seatNo ?? '—'}</td>
                    <td className="num">{row.studentNo}</td>
                    <td className="cell-strong">
                      <Link to={`/admin/students/${row.studentId}`}>{row.studentName}</Link>
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
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <div className="grid grid--2">
        <Panel
          title="待回收紙本反思卡"
          hint={`${data.pendingPapers.length} 件`}
          flush
          actions={
            <Link className="btn" to="/admin/cases">
              全部處理
            </Link>
          }
        >
          {data.pendingPapers.length === 0 ? (
            <EmptyState title="沒有待回收的紙本" />
          ) : (
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>學生</th>
                    <th>應繳卡別</th>
                    <th>違規日</th>
                  </tr>
                </thead>
                <tbody>
                  {data.pendingPapers.slice(0, 6).map((row) => (
                    <tr key={row.id}>
                      <td className="cell-strong">
                        {row.className} {row.studentName}
                        <div className="cell-sub">{row.typeName}</div>
                      </td>
                      <td>
                        <Badge tone={PAPER_CARD_TONE[row.paperCard]}>
                          {PAPER_CARD_LABEL[row.paperCard]}
                        </Badge>
                      </td>
                      <td>{formatDate(row.occurredOn)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>

        <Panel title="關注名單" hint="15 天內已有紀錄、尚未達門檻" flush>
          {data.watchlist.length === 0 ? (
            <EmptyState title="目前沒有需要關注的學生" />
          ) : (
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>學生</th>
                    <th>15 天內次數</th>
                    <th>還差</th>
                  </tr>
                </thead>
                <tbody>
                  {data.watchlist.map((row) => (
                    <tr key={row.studentId}>
                      <td className="cell-strong">
                        <Link to={`/admin/students/${row.studentId}`}>
                          {row.className} {row.studentName}
                        </Link>
                      </td>
                      <td className="num">
                        <Badge tone={row.count >= 2 ? 'critical' : 'neutral'}>{row.count} / 3</Badge>
                      </td>
                      <td className="num">{row.shortfall} 次</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      </div>

      <Panel title="安全觀察員追蹤清單" hint={`${data.assignments.length} 案進行中`} flush>
        {data.assignments.length === 0 ? (
          <EmptyState title="目前沒有安全觀察員派單" />
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>學生</th>
                  <th>值勤日</th>
                  <th>進度</th>
                  <th>狀態</th>
                </tr>
              </thead>
              <tbody>
                {data.assignments.map((row) => (
                  <tr key={row.id}>
                    <td className="cell-strong">
                      {row.className} {row.studentName}
                    </td>
                    <td>{formatDate(row.dutyOn)}</td>
                    <td className="num">
                      {row.periodLogs.filter((log) => log.checkOutAt).length}/{row.totalPeriods} 節
                    </td>
                    <td>
                      <Badge tone={ASSIGNMENT_STATUS_TONE[row.status]}>
                        {ASSIGNMENT_STATUS_LABEL[row.status]}
                      </Badge>
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
