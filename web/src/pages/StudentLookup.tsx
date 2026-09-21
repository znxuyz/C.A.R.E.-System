import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../lib/api.ts";
import {
  INFRACTION_STATUS_LABEL,
  INFRACTION_STATUS_TONE,
  formatDate,
  formatDateTime,
} from "../lib/format.ts";
import {
  Badge,
  Callout,
  EmptyState,
  Panel,
  StatTile,
} from "../components/ui.tsx";
import type { StudentDetail } from "../lib/types.ts";

/** 學生查詢 + 個人違規歷程（輔導會議與親師溝通使用） */
export function StudentLookup() {
  const { studentId } = useParams();
  const [keyword, setKeyword] = useState("");
  const [results, setResults] = useState<
    Array<{
      id: string;
      studentNo: string;
      name: string;
      className: string;
      seatNo?: number;
      windowCount?: number;
    }>
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
      .catch((err) =>
        setError(err instanceof Error ? err.message : "載入失敗"),
      );
  }, [studentId]);

  useEffect(() => {
    const trimmed = keyword.trim();
    // 中文姓氏一個字即可查；學號至少兩碼再開始比對
    const minLength = /^[0-9A-Za-z]+$/.test(trimmed) ? 2 : 1;
    if (trimmed.length < minLength) {
      setResults([]);
      return;
    }
    void api.searchStudent(trimmed).then(setResults);
  }, [keyword]);

  if (studentId) {
    if (error) return <div className="field__error">{error}</div>;
    if (!detail) return <div className="muted">載入中…</div>;

    return (
      <>
        <div className="row">
          <Link className="btn btn--ghost" to="/admin/students">
            ← 返回查詢
          </Link>
        </div>

        <Panel
          title={`${detail.className} ${detail.name}`}
          hint={`學號 ${detail.studentNo}${detail.seatNo ? `・座號 ${detail.seatNo}` : ""}`}
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
              label="15 天內再犯次數"
              value={`${detail.progress.count} / ${detail.progress.threshold}`}
              foot={`${detail.progress.windowStart} ~ ${detail.progress.windowEnd}`}
              meter={{
                value: detail.progress.count,
                max: detail.progress.threshold,
                tone:
                  detail.progress.count >= detail.progress.threshold
                    ? "critical"
                    : "warning",
              }}
              tone={
                detail.progress.count >= detail.progress.threshold
                  ? "alert"
                  : undefined
              }
            />
            <StatTile
              label="累計違規登錄"
              value={detail.totals.infractions}
              unit="件"
            />
            <StatTile label="再犯警示" value={detail.totals.alerts} unit="次" />
            <StatTile
              label="安全觀察員值勤"
              value={detail.totals.duties}
              unit="次"
            />
          </div>
          {detail.progress.shortfall > 0 && detail.progress.count > 0 && (
            <Callout
              tone={detail.progress.shortfall <= 1 ? "warning" : undefined}
            >
              <span aria-hidden="true">
                {detail.progress.shortfall <= 1 ? "⚠️" : "ℹ️"}
              </span>
              <span>
                再 <strong>{detail.progress.shortfall}</strong>{" "}
                次即觸發再犯警示， 建議提前安排晤談或正向支持措施。
              </span>
            </Callout>
          )}
        </Panel>

        <Panel title="違規歷程" hint={`${detail.history.length} 筆`} flush>
          {detail.history.length === 0 ? (
            <EmptyState title="尚無任何紀錄" />
          ) : (
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>日期</th>
                    <th>類型</th>
                    <th>地點・節次</th>
                    <th>狀態</th>
                    <th>紙本回收</th>
                    <th>備註</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.history.map((row) => (
                    <tr key={row.id}>
                      <td>{formatDate(row.occurredOn)}</td>
                      <td className="cell-strong">{row.typeName}</td>
                      <td className="cell-sub">
                        {row.locationName}
                        {row.periodNo ? `・第 ${row.periodNo} 節` : ""}
                      </td>
                      <td>
                        <Badge tone={INFRACTION_STATUS_TONE[row.status]} dot>
                          {INFRACTION_STATUS_LABEL[row.status]}
                        </Badge>
                      </td>
                      <td className="cell-sub">
                        {formatDate(row.paperReturnedOn)}
                      </td>
                      <td className="cell-sub">
                        {row.exemptReason ?? row.voidReason ?? row.note ?? "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>

        {detail.alerts.length > 0 && (
          <Panel title="再犯警示紀錄" flush>
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>觸發時間</th>
                    <th>視窗</th>
                    <th>次數</th>
                    <th>值勤日</th>
                    <th>狀態</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.alerts.map((alert) => (
                    <tr key={alert.id}>
                      <td className="cell-sub">
                        {formatDateTime(alert.triggeredAt)}
                      </td>
                      <td className="cell-sub">
                        {alert.windowStart} ~ {alert.windowEnd}
                      </td>
                      <td className="num">
                        {alert.count} / {alert.threshold}
                      </td>
                      <td>{alert.dutyOn ? formatDate(alert.dutyOn) : "—"}</td>
                      <td>{alert.status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        )}
      </>
    );
  }

  return (
    <Panel
      title="學生查詢"
      hint={
        results.length > 0 ? `${results.length} 位相符` : "輸入學號、姓名或班級"
      }
    >
      <div className="stack">
        <input
          type="text"
          value={keyword}
          onChange={(event) => setKeyword(event.target.value)}
          placeholder="例：1140101、王小明、六年四班"
          autoFocus
        />
        {results.length === 0 ? (
          <div className="muted small">
            可輸入學號、姓名或班級（例：1140101、小明、六年四班）。
          </div>
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>班級</th>
                  <th>座號</th>
                  <th>學號</th>
                  <th>姓名</th>
                  <th>15 天內次數</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {results.slice(0, 100).map((row) => (
                  <tr key={row.id}>
                    <td>{row.className}</td>
                    <td className="num">{row.seatNo ?? "—"}</td>
                    <td className="num">{row.studentNo}</td>
                    <td className="cell-strong">{row.name}</td>
                    <td className="num">
                      {typeof row.windowCount === "number" ? (
                        <Badge
                          tone={row.windowCount >= 2 ? "critical" : "neutral"}
                        >
                          {row.windowCount} / 3
                        </Badge>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td>
                      <Link className="btn" to={`/admin/students/${row.id}`}>
                        查看歷程
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Panel>
  );
}
