import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api.ts";
import { useToast } from "../components/toast.tsx";
import {
  Badge,
  Callout,
  EmptyState,
  Field,
  Panel,
  WaterNotice,
} from "../components/ui.tsx";
import type {
  InfractionTypeOption,
  LocationOption,
  SystemSettings,
} from "../lib/types.ts";

/**
 * 違規登錄
 *
 * 目標：走廊現場 30 秒完成。
 *  - 學號輸入 → 即時帶出姓名、班級與「15 天內已幾次」（避免登錯人）
 *  - 違規類型用大按鈕（只有兩類，且決定發哪一張紙本反思卡）
 *  - 送出後立即回饋：已凍結當日下課、應發哪張卡、目前累計次數
 */
export function InfractionLog() {
  const toast = useToast();
  const [types, setTypes] = useState<InfractionTypeOption[]>([]);
  const [locations, setLocations] = useState<LocationOption[]>([]);
  const [settings, setSettings] = useState<SystemSettings | null>(null);
  const [studentNo, setStudentNo] = useState("");
  const [matched, setMatched] = useState<{
    id: string;
    name: string;
    className: string;
    seatNo?: number;
    windowCount?: number;
  } | null>(null);
  const [typeCode, setTypeCode] = useState("");
  const [locationCode, setLocationCode] = useState("");
  const [periodNo, setPeriodNo] = useState(2);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{
    studentName: string;
    className: string;
    paperCardLabel: string;
    triggered: boolean;
    count: number;
    shortfall: number;
    dutyOn?: string;
  } | null>(null);

  useEffect(() => {
    void api.infractionTypes().then(setTypes);
    void api
      .settings()
      .then(setSettings)
      .catch(() => undefined);
    void api
      .locations()
      .then((rows) =>
        setLocations(
          [...rows].sort((a, b) => Number(b.isHotspot) - Number(a.isHotspot)),
        ),
      );
  }, []);

  useEffect(() => {
    const keyword = studentNo.trim();
    if (keyword.length < 3) {
      setMatched(null);
      return;
    }
    let cancelled = false;
    void api.searchStudent(keyword).then((rows) => {
      if (cancelled) return;
      const hit =
        rows.find((row) => row.studentNo === keyword) ?? rows[0] ?? null;
      setMatched(
        hit
          ? {
              id: hit.id,
              name: hit.name,
              className: hit.className,
              seatNo: hit.seatNo,
              windowCount: hit.windowCount,
            }
          : null,
      );
    });
    return () => {
      cancelled = true;
    };
  }, [studentNo]);

  // 回溯天數可於後台調整，畫面文案一律跟著設定走（預設 15 天）
  const windowDays = settings?.recidivismWindowDays ?? 15;
  const canSubmit = Boolean(matched && typeCode && locationCode) && !busy;

  const submit = async () => {
    if (!canSubmit || !matched) return;
    setBusy(true);
    try {
      const response = await api.createInfraction({
        studentNo: studentNo.trim(),
        typeCode,
        locationCode,
        periodNo,
        note: note.trim() || undefined,
      });
      setResult({
        studentName: response.studentName,
        className: response.className,
        paperCardLabel: response.paperCardLabel,
        triggered: response.recidivism.triggered,
        count: response.recidivism.count,
        shortfall: response.recidivism.shortfall,
        dutyOn: response.recidivism.dutyOn,
      });
      toast.push(`已登錄 ${response.studentName} 的違規`);
      setStudentNo("");
      setTypeCode("");
      setLocationCode("");
      setNote("");
      setMatched(null);
    } catch (error) {
      toast.push(error instanceof Error ? error.message : "登錄失敗", "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {result && (
        <Panel title="登錄完成" hint="系統已自動處理下列事項">
          <div className="stack">
            <div className="row">
              <Badge tone="good" dot>
                已凍結 {result.className} {result.studentName} 當日自由下課
              </Badge>
              <Badge tone="safety">應發：{result.paperCardLabel}</Badge>
            </div>
            <Callout
              tone={
                result.triggered || result.count >= 2 ? "warning" : undefined
              }
            >
              <span aria-hidden="true">
                {result.triggered ? "⚠️" : result.count >= 2 ? "⚠️" : "ℹ️"}
              </span>
              <span>
                該生 {windowDays} 天內累計 <strong>{result.count}</strong> 次
                {result.triggered ? (
                  <>
                    ，<strong>已達再犯門檻</strong>
                    ：系統已發出警示並排入安全觀察員追蹤清單
                    {result.dutyOn ? `，預定值勤日 ${result.dutyOn}` : ""}。
                  </>
                ) : (
                  `；再 ${result.shortfall} 次即觸發再犯警示。`
                )}
              </span>
            </Callout>
            <div className="btn-row">
              <button
                className="btn btn--primary"
                onClick={() => setResult(null)}
              >
                繼續登錄下一件
              </button>
              <Link className="btn btn--ghost" to="/admin">
                回儀表板
              </Link>
            </div>
          </div>
        </Panel>
      )}

      <Panel title="違規事件登錄" hint="現場 30 秒完成">
        <div className="stack">
          <div className="form-grid">
            <Field
              label="學號"
              hint={matched ? undefined : "輸入 3 碼以上自動比對"}
              error={
                studentNo.trim().length >= 3 && !matched
                  ? "查無此學號（若尚未匯入名冊，請先到「系統設定 → 基本資料」匯入）"
                  : undefined
              }
            >
              <input
                type="text"
                inputMode="numeric"
                value={studentNo}
                onChange={(event) => setStudentNo(event.target.value)}
                placeholder="例：1140101"
                autoFocus
              />
            </Field>
            <Field label="學生">
              <div className="row" style={{ minHeight: 40 }}>
                {matched ? (
                  <>
                    <strong>{matched.name}</strong>
                    <Badge tone="neutral">
                      {matched.className}
                      {matched.seatNo ? ` ${matched.seatNo} 號` : ""}
                    </Badge>
                    {typeof matched.windowCount === "number" &&
                      matched.windowCount > 0 && (
                        <Badge
                          tone={
                            matched.windowCount >= 2 ? "critical" : "warning"
                          }
                        >
                          {windowDays} 天內 {matched.windowCount} 次
                        </Badge>
                      )}
                  </>
                ) : (
                  <span className="muted small">待比對</span>
                )}
              </div>
            </Field>
          </div>

          <div className="field">
            <span className="field__label">
              違規類型（決定發哪一張紙本反思卡）
            </span>
            {types.length === 0 ? (
              <EmptyState
                title="尚未建立違規類型"
                hint="請至「系統設定 → 基本資料」按一次「建立內建違規類型與地點」。"
              />
            ) : (
              <div className="choice-grid">
                {types.map((type) => (
                  <button
                    key={type.code}
                    className={`choice${typeCode === type.code ? " choice--selected" : ""}`}
                    onClick={() => setTypeCode(type.code)}
                    aria-pressed={typeCode === type.code}
                  >
                    <span className="choice__icon" aria-hidden="true">
                      {type.icon ?? "📋"}
                    </span>
                    <span>
                      <span className="choice__title">{type.name}</span>
                      <br />
                      <span className="choice__desc">
                        👉 {type.paperCardLabel}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="form-grid">
            <Field label="地點">
              <select
                value={locationCode}
                onChange={(event) => setLocationCode(event.target.value)}
              >
                <option value="">請選擇</option>
                {locations.map((location) => (
                  <option key={location.code} value={location.code}>
                    {location.name}
                    {location.isHotspot ? "（熱點）" : ""}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="節次">
              <select
                value={periodNo}
                onChange={(event) => setPeriodNo(Number(event.target.value))}
              >
                {[1, 2, 3, 4, 5, 6, 7].map((period) => (
                  <option key={period} value={period}>
                    第 {period} 節下課
                  </option>
                ))}
                <option value={0}>其他時段</option>
              </select>
            </Field>
          </div>

          <Field label="補充說明（選填）" hint="客觀描述行為，不評價人格">
            <textarea
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="例：於三樓走廊與同學追逐，經勸導後停止。"
              style={{ minHeight: 72 }}
            />
          </Field>

          <WaterNotice />

          <div className="btn-row">
            <button
              className="btn btn--primary btn--lg"
              disabled={!canSubmit}
              onClick={() => void submit()}
            >
              {busy ? "登錄中…" : "登錄違規"}
            </button>
            <span className="small muted">
              送出後：凍結當日自由下課 → 發放紙本反思卡 → 自動計算 {windowDays}{" "}
              天內再犯次數
            </span>
          </div>
        </div>
      </Panel>
    </>
  );
}
