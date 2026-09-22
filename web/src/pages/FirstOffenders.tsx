import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api.ts";
import { formatDate } from "../lib/format.ts";
import { Badge, Callout, EmptyState, Panel } from "../components/ui.tsx";
import { describeFirestoreError } from "../lib/errors.ts";
import type { FirstOffenderRow, SystemSettings } from "../lib/types.ts";

/**
 * 初犯名單
 *
 * 回溯期間內只有 1 筆、且尚未被警示認列的學生。依預設政策這一次只做
 * 記錄勸導（不發反思卡），因此這份清單的用途是「處分還沒發生前就介入」：
 * 導師晤談、個別關懷、必要時通知家長。
 *
 * 每一列都標出這筆紀錄何時退出回溯期 —— 過期後該生自動離開名單，
 * 這也是向學生說明「表現穩定就會歸零」的依據。
 */
export function FirstOffenders() {
  const [rows, setRows] = useState<FirstOffenderRow[] | null>(null);
  const [settings, setSettings] = useState<SystemSettings | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setError(null);
    void api
      .firstOffenders()
      .then(setRows)
      .catch((err) => {
        setRows([]);
        setError(describeFirestoreError(err));
      });
    void api
      .settings()
      .then(setSettings)
      .catch(() => undefined);
  }, []);

  useEffect(load, [load]);

  const windowDays = settings?.recidivismWindowDays ?? 15;
  const threshold = settings?.recidivismThreshold ?? 3;
  const cardFromOffense = settings?.cardFromOffense ?? 2;

  return (
    <>
      <Callout>
        <span aria-hidden="true">🌱</span>
        <span>
          <strong>{windowDays} 天內只有 1 次紀錄</strong>的學生。依目前設定，第{" "}
          {cardFromOffense} 次起才發反思卡，所以名單上的學生{" "}
          <strong>這一次只做了記錄與勸導</strong>，還沒有任何處分。
          <br />
          用途是在處分發生前介入：導師晤談、個別關懷。若在回溯期內沒有再犯，
          紀錄到期就自動退出名單；再犯累計到 {threshold}{" "}
          次才會觸發警示與安全觀察員追蹤。
        </span>
      </Callout>

      {error && (
        <Callout tone="warning">
          <span aria-hidden="true">⚠️</span>
          <span>
            <strong>讀取失敗</strong>：{error}
            <button
              className="btn btn--sm"
              style={{ marginTop: 8 }}
              onClick={load}
            >
              重新載入
            </button>
          </span>
        </Callout>
      )}

      <Panel
        title="初犯名單"
        hint={rows ? `${rows.length} 人` : "載入中…"}
        flush
      >
        {!rows ? (
          <div className="card__body muted">載入中…</div>
        ) : rows.length === 0 ? (
          <EmptyState
            title="目前沒有初犯紀錄"
            hint={`${windowDays} 天內尚無只登錄一次的學生。`}
          />
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>學生</th>
                  <th>違規日</th>
                  <th>類型</th>
                  <th>地點・節次</th>
                  <th>處理</th>
                  <th>紀錄到期</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.infractionId}>
                    <td className="cell-strong">
                      <Link to={`/admin/students/${row.studentId}`}>
                        {row.className} {row.studentName}
                      </Link>
                      <div className="cell-sub">
                        {row.seatNo ? `${row.seatNo} 號・` : ""}
                        {row.studentNo}
                      </div>
                    </td>
                    <td className="cell-sub">{formatDate(row.occurredOn)}</td>
                    <td>{row.typeName}</td>
                    <td className="cell-sub">
                      {row.locationName}
                      {row.periodNo ? `・第 ${row.periodNo} 節下課` : ""}
                    </td>
                    <td>
                      {row.cardIssued ? (
                        <Badge tone="safety">已發反思卡</Badge>
                      ) : (
                        <Badge tone="good">記錄勸導</Badge>
                      )}
                    </td>
                    <td className="cell-sub">
                      {formatDate(row.expiresOn)}
                      <div className="cell-sub">
                        {row.daysLeft > 0
                          ? `還有 ${row.daysLeft} 天`
                          : "今日到期"}
                      </div>
                    </td>
                    <td>
                      <Link
                        className="btn"
                        to={`/admin/students/${row.studentId}`}
                      >
                        查看歷程
                      </Link>
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
