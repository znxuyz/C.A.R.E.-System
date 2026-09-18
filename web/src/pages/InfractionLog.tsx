import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.ts';
import { useToast } from '../components/toast.tsx';
import { Badge, Callout, Field, Panel, WaterNotice } from '../components/ui.tsx';
import type { InfractionTypeOption, LocationOption } from '../lib/types.ts';

/**
 * 違規登錄（生教組 / 糾察隊 / 巡堂教師）
 *
 * 設計目標：走廊現場 30 秒完成。
 *  - 學號輸入 → 即時帶出姓名與班級（避免登錯人）
 *  - 違規類型用大按鈕（只有兩類，且決定配發哪張反思卡）
 *  - 熱點地點優先排序；節次預設當前節次
 *  - 送出後立即顯示三件事：已凍結當日下課、已通知導師、15 天內累計張數
 */
export function InfractionLog() {
  const toast = useToast();
  const [types, setTypes] = useState<InfractionTypeOption[]>([]);
  const [locations, setLocations] = useState<LocationOption[]>([]);
  const [studentNo, setStudentNo] = useState('');
  const [matched, setMatched] = useState<{ id: string; name: string; className: string; windowCardCount?: number } | null>(null);
  const [typeCode, setTypeCode] = useState('');
  const [locationCode, setLocationCode] = useState('');
  const [periodNo, setPeriodNo] = useState(2);
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<
    | {
        studentName: string;
        className: string;
        formTitle: string;
        windowCardCount?: number;
        notifiedTeacher: boolean;
      }
    | null
  >(null);

  useEffect(() => {
    void api.infractionTypes().then(setTypes);
    void api.locations().then((rows) => {
      setLocations([...rows].sort((a, b) => Number(b.isHotspot) - Number(a.isHotspot)));
    });
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
      const hit = rows.find((row) => row.studentNo === keyword) ?? rows[0] ?? null;
      setMatched(hit ? { id: hit.id, name: hit.name, className: hit.className, windowCardCount: hit.windowCardCount } : null);
    });
    return () => {
      cancelled = true;
    };
  }, [studentNo]);

  const selectedType = types.find((type) => type.code === typeCode);
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
        description: description.trim() || undefined,
      });
      const formTitle =
        'formTitle' in response
          ? (response as { formTitle: string }).formTitle
          : (selectedType?.formTitle ?? '反思卡');
      setResult({
        studentName: matched.name,
        className: matched.className,
        formTitle,
        windowCardCount:
          'windowCardCount' in response
            ? (response as { windowCardCount?: number }).windowCardCount
            : undefined,
        notifiedTeacher: Boolean((response as { notifiedTeacher?: boolean }).notifiedTeacher),
      });
      toast.push(`已登錄 ${matched.name} 的違規，並通知班導師`);
      setStudentNo('');
      setTypeCode('');
      setLocationCode('');
      setDescription('');
      setMatched(null);
    } catch (error) {
      toast.push(error instanceof Error ? error.message : '登錄失敗', 'error');
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
              <Badge tone={result.notifiedTeacher ? 'good' : 'warning'} dot>
                {result.notifiedTeacher ? '已推播／Email 通知班導師' : '該班尚未設定導師，未發送通知'}
              </Badge>
              <Badge tone="safety">已配發：{result.formTitle}</Badge>
            </div>
            {typeof result.windowCardCount === 'number' && (
              <Callout tone={result.windowCardCount >= 2 ? 'warning' : undefined}>
                <span aria-hidden="true">{result.windowCardCount >= 2 ? '⚠️' : 'ℹ️'}</span>
                <span>
                  該生 15 天內累計 <strong>{result.windowCardCount}</strong> 張反思卡
                  {result.windowCardCount >= 3
                    ? '；已達門檻，系統已發出累犯警示並排入安全觀察員追蹤清單。'
                    : `；再 ${3 - result.windowCardCount} 張即觸發累犯警示。`}
                </span>
              </Callout>
            )}
            <div className="btn-row">
              <button className="btn" onClick={() => setResult(null)}>
                繼續登錄下一件
              </button>
              <Link className="btn btn--ghost" to="/office">
                回儀表板
              </Link>
            </div>
          </div>
        </Panel>
      )}

      <Panel title="違規事件登錄" hint="現場 30 秒完成｜送出後立即通知導師">
        <div className="stack">
          <div className="form-grid">
            <Field
              label="學號"
              hint={matched ? undefined : '輸入 3 碼以上自動比對'}
              error={studentNo.trim().length >= 3 && !matched ? '查無此學號' : undefined}
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
                    <Badge tone="neutral">{matched.className}</Badge>
                    {typeof matched.windowCardCount === 'number' && matched.windowCardCount > 0 && (
                      <Badge tone={matched.windowCardCount >= 2 ? 'critical' : 'warning'}>
                        15 天內 {matched.windowCardCount} 張
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
            <span className="field__label">違規類型（決定配發哪張反思卡）</span>
            <div className="choice-grid">
              {types.map((type) => (
                <button
                  key={type.code}
                  className={`choice${typeCode === type.code ? ' choice--selected' : ''}`}
                  onClick={() => setTypeCode(type.code)}
                  aria-pressed={typeCode === type.code}
                >
                  <span className="choice__icon" aria-hidden="true">
                    {type.code === 'RUN_IN_CORRIDOR' ? '🏃' : '💬'}
                  </span>
                  <span>
                    <span className="choice__title">{type.name}</span>
                    <br />
                    <span className="choice__desc">👉 {type.formTitle}</span>
                  </span>
                </button>
              ))}
            </div>
          </div>

          <div className="form-grid">
            <Field label="地點">
              <select value={locationCode} onChange={(event) => setLocationCode(event.target.value)}>
                <option value="">請選擇</option>
                {locations.map((location) => (
                  <option key={location.code} value={location.code}>
                    {location.name}
                    {location.isHotspot ? '（熱點）' : ''}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="節次">
              <select value={periodNo} onChange={(event) => setPeriodNo(Number(event.target.value))}>
                {[1, 2, 3, 4, 5, 6, 7].map((period) => (
                  <option key={period} value={period}>
                    第 {period} 節下課
                  </option>
                ))}
                <option value={0}>其他時段</option>
              </select>
            </Field>
          </div>

          <Field label="補充說明（選填）" hint="客觀描述行為，不評價人格；此內容導師與學生皆可見">
            <textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="例：於三樓走廊與同學追逐，經勸導後停止。"
              style={{ minHeight: 72 }}
            />
          </Field>

          <WaterNotice />

          <div className="btn-row">
            <button className="btn btn--primary btn--lg" disabled={!canSubmit} onClick={() => void submit()}>
              {busy ? '登錄中…' : '登錄並通知導師'}
            </button>
            <span className="small muted">
              送出後：凍結當日自由下課 → 配發反思卡 → 推播／Email 通知班導師
            </span>
          </div>
        </div>
      </Panel>
    </>
  );
}
