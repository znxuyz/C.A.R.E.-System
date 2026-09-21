import { useCallback, useEffect, useState } from "react";
import { api } from "../lib/api.ts";
import { Callout, Field, Panel } from "../components/ui.tsx";
import { useToast } from "../components/toast.tsx";
import type { SystemSettings } from "../lib/types.ts";

const ALL_PERIODS = [1, 2, 3, 4, 5, 6, 7, 8];

/** 回溯視窗常用級距：一次點選即可，仍可手動輸入 1–365 之間的任意天數。 */
const WINDOW_PRESETS = [
  { days: 15, label: "15 天" },
  { days: 30, label: "一個月" },
  { days: 120, label: "一學期" },
  { days: 365, label: "一學年" },
] as const;

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
  const [seeding, setSeeding] = useState(false);
  const [roster, setRoster] = useState("");
  const [importing, setImporting] = useState(false);

  const load = useCallback(() => {
    void api
      .settings()
      .then((value) => {
        setForm(value);
        setSaved(value);
      })
      .catch((error) =>
        toast.push(
          error instanceof Error ? error.message : "載入失敗",
          "error",
        ),
      );
  }, [toast]);

  useEffect(load, [load]);

  if (!form || !saved) return <div className="muted">載入中…</div>;

  const patch = (next: Partial<SystemSettings>) =>
    setForm({ ...form, ...next });
  const togglePeriod = (period: number) => {
    const next = form.observerPeriodNumbers.includes(period)
      ? form.observerPeriodNumbers.filter((p) => p !== period)
      : [...form.observerPeriodNumbers, period].sort((a, b) => a - b);
    patch({ observerPeriodNumbers: next, observerPeriods: next.length });
  };

  const seed = async () => {
    setSeeding(true);
    try {
      const result = await api.seedBaseData();
      toast.push(
        `已建立 ${result.types} 種違規類型、${result.locations} 個地點`,
      );
    } catch (error) {
      toast.push(error instanceof Error ? error.message : "建立失敗", "error");
    } finally {
      setSeeding(false);
    }
  };

  const importRoster = async () => {
    setImporting(true);
    try {
      const result = await api.importRoster(roster);
      toast.push(`已匯入 ${result.students} 名學生、${result.classes} 個班級`);
      if (result.errors.length > 0) {
        toast.push(
          `有 ${result.errors.length} 行未匯入：${result.errors[0]}`,
          "error",
        );
      } else {
        setRoster("");
      }
    } catch (error) {
      toast.push(error instanceof Error ? error.message : "匯入失敗", "error");
    } finally {
      setImporting(false);
    }
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
        publicBoard: form.publicBoard,
      });
      setSaved(form);
      toast.push("設定已儲存，之後登錄的違規即依新參數判定");
    } catch (error) {
      toast.push(error instanceof Error ? error.message : "儲存失敗", "error");
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
            <Field
              label="回溯天數（含當天）"
              hint="1–365 天。預設 15 天；可設為一學期或一學年"
            >
              <input
                type="number"
                min={1}
                max={365}
                value={form.recidivismWindowDays}
                onChange={(event) =>
                  patch({ recidivismWindowDays: Number(event.target.value) })
                }
              />
              <div className="btn-row" style={{ marginTop: 6 }}>
                {WINDOW_PRESETS.map((preset) => (
                  <button
                    key={preset.days}
                    type="button"
                    className={
                      form.recidivismWindowDays === preset.days
                        ? "btn btn--sm btn--on"
                        : "btn btn--sm"
                    }
                    onClick={() => patch({ recidivismWindowDays: preset.days })}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            </Field>
            <Field label="觸發次數" hint="1–20 次。預設 3 次">
              <input
                type="number"
                min={1}
                max={20}
                value={form.recidivismThreshold}
                onChange={(event) =>
                  patch({ recidivismThreshold: Number(event.target.value) })
                }
              />
            </Field>
          </div>
          <Callout>
            <span aria-hidden="true">ℹ️</span>
            <span>
              調整只影響<strong>之後</strong>
              的判定；已發出的警示會留存觸發當時的參數，
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
                    className={`btn${on ? " btn--primary" : ""}`}
                    onClick={() => togglePeriod(period)}
                    aria-pressed={on}
                  >
                    第 {period} 節
                  </button>
                );
              })}
            </div>
            <span className="field__hint">
              預設第 1–5 節（扣除打掃時間與 5 分鐘短下課）。共{" "}
              {form.observerPeriods} 節。
            </span>
          </div>
        </div>
      </Panel>

      <Panel title="下課管制">
        <label
          className={`check${form.carryOverUnfinished ? " check--on" : ""}`}
        >
          <input
            type="checkbox"
            checked={form.carryOverUnfinished}
            onChange={(event) =>
              patch({ carryOverUnfinished: event.target.checked })
            }
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
          <label
            className={`check${form.publicBoard.enabled ? " check--on" : ""}`}
          >
            <input
              type="checkbox"
              checked={form.publicBoard.enabled}
              onChange={(event) =>
                patch({
                  publicBoard: {
                    ...form.publicBoard,
                    enabled: event.target.checked,
                  },
                })
              }
            />
            <span>
              <span className="check__label">開放公開看板</span>
              <span className="check__desc">
                關閉後，公開頁會顯示「目前未開放」。
              </span>
            </span>
          </label>

          <label
            className={`check${form.publicBoard.showRoster ? " check--on" : ""}`}
          >
            <input
              type="checkbox"
              checked={form.publicBoard.showRoster}
              onChange={(event) =>
                patch({
                  publicBoard: {
                    ...form.publicBoard,
                    showRoster: event.target.checked,
                  },
                })
              }
            />
            <span>
              <span className="check__label">
                在公開看板列出管制名單（班級＋座號）
              </span>
              <span className="check__desc">
                預設關閉。即使開啟也<strong>絕不顯示姓名或學號</strong>；
                但校內同學仍可由班級座號辨識當事人，等同公開懲戒 ——
                開啟前請確認符合校內個資與輔導管教規範。
              </span>
            </span>
          </label>
        </div>
      </Panel>

      <Panel title="基本資料" hint="首次啟用時先建立，登錄畫面才有選項">
        <div className="stack">
          <div className="field">
            <span className="field__label">違規類型與地點</span>
            <div className="btn-row">
              <button
                className="btn"
                disabled={seeding}
                onClick={() => void seed()}
              >
                {seeding ? "建立中…" : "建立內建違規類型與地點"}
              </button>
              <span className="small muted">
                走廊奔跑 → 校園安全反思卡、口出穢言 →
                口說好話反思卡，以及常見校園地點。 可重複執行；日後要增修再於
                Firebase 主控台調整。
              </span>
            </div>
          </div>

          <Field
            label="學生名冊匯入"
            hint="每行一位：班級,座號,學號,姓名（可用逗號或 Tab；可含標題列）。以學號為鍵，重複匯入只會更新、不會產生重複學生。"
          >
            <textarea
              value={roster}
              onChange={(event) => setRoster(event.target.value)}
              placeholder={
                "七年一班,1,1140101,王小明\n七年一班,2,1140102,李小美"
              }
              style={{
                minHeight: 120,
                fontFamily: "var(--font-mono, monospace)",
              }}
            />
          </Field>
          <div className="btn-row">
            <button
              className="btn btn--primary"
              disabled={importing || !roster.trim()}
              onClick={() => void importRoster()}
            >
              {importing ? "匯入中…" : "匯入名冊"}
            </button>
            <span className="small muted">
              名冊可從校務系統匯出 Excel 後，複製對應四欄貼上。
            </span>
          </div>
        </div>
      </Panel>

      <div className="row">
        <button
          className="btn btn--primary btn--lg"
          disabled={!dirty || busy}
          onClick={() => void save()}
        >
          {busy ? "儲存中…" : "儲存設定"}
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
