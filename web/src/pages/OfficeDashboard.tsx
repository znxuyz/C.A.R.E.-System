import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.ts';
import {
  ASSIGNMENT_STATUS_LABEL,
  ASSIGNMENT_STATUS_TONE,
  CASE_STATUS_LABEL,
  CASE_STATUS_TONE,
  FORM_KIND_TONE,
  RESTRICTION_REASON_LABEL,
  formatDate,
  formatDateTime,
} from '../lib/format.ts';
import { Badge, EmptyState, Panel, StatTile, WaterNotice } from '../components/ui.tsx';
import { HotspotBars, TrendChart } from '../components/charts.tsx';
import type { DashboardData } from '../lib/types.ts';

/**
 * 生教組戰情儀表板
 *
 * 資訊優先序（依學務處實際作業節奏）：
 *  1. 今天誰要管制／誰要值勤 → 下課前 1 分鐘要看得到
 *  2. 我還有幾件要蓋章 → 行政待辦
 *  3. 誰觸發累犯、誰快要觸發 → 輔導介入時機
 *  4. 趨勢與熱點 → 期末報表與導護排班依據
 */
export function OfficeDashboard() {
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
          foot={<Link to="/office/restrictions">查看名單 →</Link>}
        />
        <StatTile
          icon="🖊️"
          label="待生教組蓋章"
          value={kpis.pendingOffice}
          unit="件"
          foot={<Link to="/office/review">前往審核 →</Link>}
        />
        <StatTile icon="⏳" label="待導師簽章" value={kpis.pendingTeacher} unit="件" foot="等待各班導師處理" />
        <StatTile
          icon="⚠️"
          label="累犯警示"
          value={kpis.openAlerts}
          unit="案"
          tone={kpis.openAlerts > 0 ? 'alert' : undefined}
          foot={<Link to="/office/alerts">追蹤清單 →</Link>}
        />
        <StatTile
          icon="👀"
          label="今日安全觀察員"
          value={kpis.observersToday}
          unit="人"
          foot={<Link to="/office/observers">值勤台 →</Link>}
        />
        <StatTile
          icon="📈"
          label="關注名單（未達門檻）"
          value={kpis.atRiskStudents}
          unit="人"
          foot="15 天內已有 1–2 張反思卡"
        />
      </div>

      <WaterNotice />

      <div className="grid grid--2">
        <Panel title="近 14 天反思卡張數" hint="依卡種堆疊">
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
        actions={<Link className="btn" to="/office/log">＋ 登錄違規</Link>}
      >
        {data.restrictions.length === 0 ? (
          <EmptyState title="今天沒有任何學生被管制" hint="很棒的一天。" />
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>班級</th>
                  <th>學號</th>
                  <th>姓名</th>
                  <th>管制原因</th>
                  <th>狀態</th>
                  <th>備註</th>
                </tr>
              </thead>
              <tbody>
                {data.restrictions.map((row) => (
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

      <div className="grid grid--2">
        <Panel
          title="待我蓋章"
          hint={`${data.officeQueue.length} 件`}
          flush
          actions={<Link className="btn btn--primary" to="/office/review">開始審核</Link>}
        >
          {data.officeQueue.length === 0 ? (
            <EmptyState title="目前沒有待蓋章案件" />
          ) : (
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>學生</th>
                    <th>卡種</th>
                    <th>導師簽章時間</th>
                    <th>狀態</th>
                  </tr>
                </thead>
                <tbody>
                  {data.officeQueue.slice(0, 6).map((card) => (
                    <tr key={card.id}>
                      <td className="cell-strong">
                        {card.className} {card.studentName}
                        <div className="cell-sub">{card.typeName}</div>
                      </td>
                      <td>
                        <Badge tone={FORM_KIND_TONE[card.formKind]}>{card.formTitle}</Badge>
                      </td>
                      <td className="cell-sub">{formatDateTime(card.teacherSignedAt)}</td>
                      <td>
                        <Badge tone={CASE_STATUS_TONE[card.status]}>
                          {CASE_STATUS_LABEL[card.status]}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>

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
      </div>
    </>
  );
}
