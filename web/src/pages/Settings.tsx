import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api.ts';
import { Callout, Field, Panel } from '../components/ui.tsx';
import { useToast } from '../components/toast.tsx';
import type { SystemSettings } from '../lib/types.ts';

const ALL_PERIODS = [1, 2, 3, 4, 5, 6, 7, 8];

/**
 * 系統設定（僅系統管理者）
 *
 * 校規調整不必改程式：門檻、視窗、值勤節次都在這裡。
 * 每次調整都寫入稽核軌跡；已發出的警示會留存當時的參數快照，
 * 因此日後調參不影響既有案件的可追溯性。
 */
export function Settings() {
  const toast = useToast();
  const [form, setForm] = useState<SystemSettings | null>(null);
  const [saved, setSaved] = useState<SystemSettings | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    void api
      .settings()
      .then((value) => {
        setForm(value);
        setSaved(value);
      })
      .catch((error) => toast.push(error instanceof Error ? error.message : '載入失敗', 'error'));
  }, [toast]);

  useEffect(load, [load]);

  if (!form || !saved) return <div className="muted">載入中…</div>;

  const patch = (next: Partial<SystemSettings>) => setForm({ ...form, ...next });
  const togglePeriod = (period: number) => {
    const next = form.observerPeriodNumbers.includes(period)
      ? form.observerPeriodNumbers.filter((p) => p !== period)
      : [...form.observerPeriodNumbers, period].sort((a, b) => a - b);
    patch({ observerPeriodNumbers: next, observerPeriods: next.length });
  };

  const dirty = JSON.stringify(form) !== JSON.stringify(saved);

  const save = async () => {
    setBusy(true);
    try {
      await api.updateSettings({
        recidivismWindowDays: form.recidivismWindowDays,
        recidivismThreshold: form.recidivismThreshold,
        observerPeriodNumbers: form.observerPeriodNumbers,
        carryOverUnfinished: form.carryOverUnfinished,
        emailHomeroom: form.emailHomeroom,
        publicBoard: form.publicBoard,
      });
      setSaved(form);
      toast.push('設定已儲存，之後登錄的違規即依新參數判定');
    } catch (error) {
      toast.push(error instanceof Error ? error.message : '儲存失敗', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Panel
        title="再犯偵測"
        hint={`目前規則：${form.recidivismWindowDays} 天內累計 ${form.recidivismThreshold} 次即觸發`}
      >
        <div className="stack">
          <div className="form-grid">
            <Field label="回溯天數（含當天）" hint="1–90 天。預設 15 天">
              <input
                type="number"
                min={1}
                max={90}
                value={form.recidivismWindowDays}
                onChange={(event) => patch({ recidivismWindowDays: Number(event.target.value) })}
              />
            </Field>
            <Field label="觸發次數" hint="1–20 次。預設 3 次">
              <input
                type="number"
                min={1}
                max={20}
                value={form.recidivismThreshold}
                onChange={(event) => patch({ recidivismThreshold: Number(event.target.value) })}
              />
            </Field>
          </div>
          <Callout>
            <span aria-hidden="true">ℹ️</span>
            <span>
              調整只影響<strong>之後</strong>的判定；已發出的警示會留存觸發當時的參數，
              家長或學生申訴時仍可追溯當時依據。
            </span>
          </Callout>
        </div>
      </Panel>

      <Panel title="安全觀察員" hint={`目前 ${form.observerPeriods} 節`}>
        <div className="stack">
          <div className="field">
            <span className="field__label">值勤節次（下課）</span>
            <div className="row" style={{ gap: 8 }}>
              {ALL_PERIODS.map((period) => {
                const on = form.observerPeriodNumbers.includes(period);
                return (
                  <button
                    key={period}
                    className={`btn${on ? ' btn--primary' : ''}`}
                    onClick={() => togglePeriod(period)}
                    aria-pressed={on}
                  >
                    第 {period} 節
                  </button>
                );
              })}
            </div>
            <span className="field__hint">
              預設第 1–5 節（扣除打掃時間與 5 分鐘短下課）。共 {form.observerPeriods} 節。
            </span>
          </div>
        </div>
      </Panel>

      <Panel title="下課管制">
        <label className={`check${form.carryOverUnfinished ? ' check--on' : ''}`}>
          <input
            type="checkbox"
            checked={form.carryOverUnfinished}
            onChange={(event) => patch({ carryOverUnfinished: event.target.checked })}
          />
          <span>
            <span className="check__label">紙本未回收時，管制延續到隔日</span>
            <span className="check__desc">
              勾選後，學生未繳回紙本反思卡就會每天續管制，直到回收為止（避免拖延即免責）。
              取消勾選則只管制違規當天。
            </span>
          </span>
        </label>
      </Panel>

      <Panel title="公開看板" hint="其他老師免登入即可查看">
        <div className="stack">
          <label className={`check${form.publicBoard.enabled ? ' check--on' : ''}`}>
            <input
              type="checkbox"
              checked={form.publicBoard.enabled}
              onChange={(event) =>
                patch({ publicBoard: { ...form.publicBoard, enabled: event.target.checked } })
              }
            />
            <span>
              <span className="check__label">開放公開看板</span>
              <span className="check__desc">關閉後，公開頁會顯示「目前未開放」。</span>
            </span>
          </label>

          <label className={`check${form.publicBoard.showRoster ? ' check--on' : ''}`}>
            <input
              type="checkbox"
              checked={form.publicBoard.showRoster}
              onChange={(event) =>
                patch({ publicBoard: { ...form.publicBoard, showRoster: event.target.checked } })
              }
            />
            <span>
              <span className="check__label">在公開看板列出管制名單（班級＋座號）</span>
              <span className="check__desc">
                預設關閉。即使開啟也<strong>絕不顯示姓名或學號</strong>；
                但校內同學仍可由班級座號辨識當事人，等同公開懲戒 ——
                開啟前請確認符合校內個資與輔導管教規範。
              </span>
            </span>
          </label>
        </div>
      </Panel>

      <Panel title="通知" hint="選用">
        <label className={`check${form.emailHomeroom ? ' check--on' : ''}`}>
          <input
            type="checkbox"
            checked={form.emailHomeroom}
            onChange={(event) => patch({ emailHomeroom: event.target.checked })}
          />
          <span>
            <span className="check__label">登錄違規時寄 Email 通知導師</span>
            <span className="check__desc">
              需先於班級資料填入導師信箱，並安裝 Firebase「Trigger Email」擴充套件。
            </span>
          </span>
        </label>
      </Panel>

      <div className="row">
        <button className="btn btn--primary btn--lg" disabled={!dirty || busy} onClick={() => void save()}>
          {busy ? '儲存中…' : '儲存設定'}
        </button>
        {dirty && (
          <button className="btn" onClick={() => setForm(saved)}>
            取消變更
          </button>
        )}
        {!dirty && <span className="small muted">目前沒有未儲存的變更</span>}
      </div>
    </>
  );
}
