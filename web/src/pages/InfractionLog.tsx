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
interface StudentHit {
  id: string;
  studentNo: string;
  name: string;
  className: string;
  seatNo?: number;
  windowCount?: number;
  active?: boolean;
}

export function InfractionLog() {
  const toast = useToast();
  const [types, setTypes] = useState<InfractionTypeOption[]>([]);
  const [locations, setLocations] = useState<LocationOption[]>([]);
  const [settings, setSettings] = useState<SystemSettings | null>(null);
  // keyword 可以是學號或姓名；candidates 為比對到的候選名單
  const [keyword, setKeyword] = useState("");
  const [candidates, setCandidates] = useState<StudentHit[]>([]);
  const [matched, setMatched] = useState<StudentHit | null>(null);
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
    const trimmed = keyword.trim();
    // 中文姓氏只有一個字，打一個字就要查得到；學號則至少兩碼才開始比對
    const minLength = /^[0-9A-Za-z]+$/.test(trimmed) ? 2 : 1;
    if (trimmed.length < minLength) {
      setCandidates([]);
      setMatched(null);
      return;
    }
    let cancelled = false;
    void api.searchStudent(trimmed).then((rows) => {
      if (cancelled) return;
      const hits = rows as StudentHit[];
      setCandidates(hits);
      // 只有「學號完全相同」或「唯一一筆結果」才自動帶入，
      // 同名同姓時一律讓使用者自己點，避免登錯人
      const exact = hits.find((row) => row.studentNo === trimmed);
      setMatched(exact ?? (hits.length === 1 ? (hits[0] ?? null) : null));
    });
    return () => {
      cancelled = true;
    };
  }, [keyword]);

  // 回溯天數可於後台調整，畫面文案一律跟著設定走（預設 15 天）
  const windowDays = settings?.recidivismWindowDays ?? 15;
  // 已畢業／轉出的學生不得登錄（後端也會擋，這裡先讓現場知道）
  const inactive = matched?.active === false;
  const canSubmit =
    Boolean(matched && !inactive && typeCode && locationCode) && !busy;

  const submit = async () => {
    if (!canSubmit || !matched) return;
    setBusy(true);
    try {
      const response = await api.createInfraction({
        studentNo: matched.studentNo,
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
      setKeyword("");
      setCandidates([]);
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
              label="學號或姓名"
              hint={
                matched
                  ? undefined
                  : candidates.length > 1
                    ? `${candidates.length} 位相符，請點選右邊的學生`
                    : "學號或姓名皆可，由開頭比對（學號打前幾碼、姓名打姓氏即可）"
              }
              error={
                keyword.trim() !== "" && candidates.length === 0
                  ? "查無相符的學生（若尚未匯入名冊，請先到「系統設定 → 學生名冊」匯入）"
                  : undefined
              }
            >
              <input
                type="text"
                value={keyword}
                onChange={(event) => setKeyword(event.target.value)}
                placeholder="例：1140101 或 王小明"
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
                    {inactive && <Badge tone="critical">已畢業／轉出</Badge>}
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
                ) : candidates.length > 0 ? (
                  <div className="hit-list">
                    {candidates.map((hit) => (
                      <button
                        key={hit.id}
                        type="button"
                        className="btn btn--sm"
                        onClick={() => setMatched(hit)}
                      >
                        {hit.className} {hit.seatNo ? `${hit.seatNo} 號 ` : ""}
                        {hit.name}
                        <span className="muted">（{hit.studentNo}）</span>
                        {hit.active === false && "・已離校"}
                      </button>
                    ))}
                  </div>
                ) : (
                  <span className="muted small">待比對</span>
                )}
              </div>
              {matched && (
                <button
                  type="button"
                  className="btn btn--sm"
                  style={{ marginTop: 6 }}
                  onClick={() => {
                    setMatched(null);
                    setKeyword("");
                    setCandidates([]);
                  }}
                >
                  換一位
                </button>
              )}
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
