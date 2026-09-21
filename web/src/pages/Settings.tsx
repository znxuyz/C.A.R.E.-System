import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../lib/api.ts";
import { Callout, Field, Panel } from "../components/ui.tsx";
import { useToast } from "../components/toast.tsx";
import type { LocationOption, SystemSettings } from "../lib/types.ts";
import { readRosterFile } from "../lib/rosterFile.ts";
import {
  diffRoster,
  parseRoster,
  parseRosterRows,
  type ExistingStudent,
} from "../core/services/roster.ts";

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
  const [locations, setLocations] = useState<LocationOption[] | null>(null);
  const [newLocation, setNewLocation] = useState("");
  const [newHotspot, setNewHotspot] = useState(false);
  const [savingLocation, setSavingLocation] = useState(false);
  // 檔案匯入時保留原始表格；貼上文字則即時解析
  const [table, setTable] = useState<string[][] | null>(null);
  const [fileInfo, setFileInfo] = useState<string | null>(null);
  const [importMode, setImportMode] = useState<"MERGE" | "REPLACE">("MERGE");
  const [existing, setExisting] = useState<ExistingStudent[] | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

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

  const loadLocations = useCallback(() => {
    void api
      .locations()
      .then((rows) =>
        setLocations(
          [...rows].sort(
            (a, b) =>
              Number(b.isHotspot) - Number(a.isHotspot) ||
              a.name.localeCompare(b.name, "zh-Hant"),
          ),
        ),
      )
      .catch(() => setLocations([]));
  }, []);

  useEffect(loadLocations, [loadLocations]);

  const loadRoster = useCallback(() => {
    void api
      .rosterSnapshot()
      .then(setExisting)
      .catch(() => setExisting([]));
  }, []);

  useEffect(loadRoster, [loadRoster]);

  useEffect(load, [load]);

  // 匯入前先在前端解析一次，讓使用者看到筆數與有問題的列再決定要不要寫入
  const preview = useMemo(() => {
    const parsed = table
      ? parseRosterRows(table)
      : roster.trim()
        ? parseRoster(roster)
        : null;
    if (!parsed) return null;
    return { ...parsed, diff: diffRoster(existing ?? [], parsed.rows) };
  }, [table, roster, existing]);

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

  const addLocation = async () => {
    const name = newLocation.trim();
    if (!name) return;
    setSavingLocation(true);
    try {
      await api.saveLocation({ name, isHotspot: newHotspot });
      toast.push(`已新增地點「${name}」`);
      setNewLocation("");
      setNewHotspot(false);
      loadLocations();
    } catch (error) {
      toast.push(error instanceof Error ? error.message : "新增失敗", "error");
    } finally {
      setSavingLocation(false);
    }
  };

  const toggleHotspot = async (location: LocationOption) => {
    try {
      await api.saveLocation({
        code: location.code,
        name: location.name,
        isHotspot: !location.isHotspot,
      });
      loadLocations();
    } catch (error) {
      toast.push(error instanceof Error ? error.message : "更新失敗", "error");
    }
  };

  const deleteLocation = async (location: LocationOption) => {
    if (
      !window.confirm(
        `確定刪除地點「${location.name}」？\n既有違規紀錄已存下當時的地點名稱，不受影響；只是之後登錄時不再出現這個選項。`,
      )
    ) {
      return;
    }
    try {
      await api.deleteLocation(location.code);
      toast.push(`已刪除地點「${location.name}」`);
      loadLocations();
    } catch (error) {
      toast.push(error instanceof Error ? error.message : "刪除失敗", "error");
    }
  };

  const pickFile = async (file: File | null) => {
    if (!file) return;
    try {
      const result = await readRosterFile(file);
      setTable(result.table);
      setFileInfo(result.source);
      setRoster("");
    } catch (error) {
      setTable(null);
      setFileInfo(null);
      toast.push(
        error instanceof Error ? error.message : "檔案讀取失敗",
        "error",
      );
    }
  };

  const clearFile = () => {
    setTable(null);
    setFileInfo(null);
    if (fileInput.current) fileInput.current.value = "";
  };

  const importRoster = async () => {
    // 停用是對既有資料的異動，先讓使用者確認人數對不對
    if (
      importMode === "REPLACE" &&
      preview &&
      preview.diff.missing.length > 0
    ) {
      const names = preview.diff.missing
        .slice(0, 5)
        .map((student) => `${student.className} ${student.name}`)
        .join("、");
      if (
        !window.confirm(
          `這份名冊會把 ${preview.diff.missing.length} 位學生標記為已畢業／轉出並停用：\n${names}${
            preview.diff.missing.length > 5 ? " …" : ""
          }\n\n停用不是刪除，違規歷程與再犯紀錄都會保留。確定要繼續嗎？`,
        )
      ) {
        return;
      }
    }
    setImporting(true);
    try {
      const result = table
        ? await api.importRosterTable(table, importMode)
        : await api.importRoster(roster, importMode);
      toast.push(
        `已匯入 ${result.students} 名學生（新增 ${result.created}、更新 ${result.reclassed}` +
          (result.deactivated > 0 ? `、停用 ${result.deactivated}` : "") +
          `），共 ${result.classes} 個班級`,
      );
      loadRoster();
      if (result.errors.length > 0) {
        toast.push(
          `有 ${result.errors.length} 行未匯入：${result.errors[0]}`,
          "error",
        );
      } else {
        setRoster("");
        clearFile();
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
              hint="往前算幾天。填 15 代表「今天＋前 14 天」這段期間內的違規才會被計入。1–365 天，預設 15 天。"
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
            <Field
              label="觸發次數"
              hint="同一位學生在上述期間內累計到第幾次違規，就發出再犯警示。填 3 代表第 3 次時觸發。1–20 次，預設 3 次。"
            >
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
          <Callout tone="warning">
            <span aria-hidden="true">📐</span>
            <span>
              目前規則：同一位學生在{" "}
              <strong>{form.recidivismWindowDays} 天內（含當天）</strong>累計到{" "}
              <strong>第 {form.recidivismThreshold} 次</strong>
              違規時，系統會發出再犯警示，並自動把他排入
              <strong>安全觀察員追蹤清單</strong>（值勤一日下課{" "}
              {form.observerPeriods} 節）。
              <br />
              計入的是<strong>違規登錄的筆數</strong>
              （走廊奔跑與口出穢言合併計算）；已被某次警示認列的違規會標記為
              「已認列」，不會對下一波處分重複計數。
            </span>
          </Callout>

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

      <Panel
        title="違規類型與地點"
        hint={locations ? `目前 ${locations.length} 個地點` : "載入中…"}
      >
        <div className="stack">
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
              口說好話反思卡，以及常見校園地點。 可重複執行，不會產生重複資料。
            </span>
          </div>

          <div className="field">
            <span className="field__label">目前的地點</span>
            {locations === null ? (
              <span className="muted small">載入中…</span>
            ) : locations.length === 0 ? (
              <span className="muted small">尚未建立任何地點。</span>
            ) : (
              <div className="tag-grid">
                {locations.map((location) => (
                  <div
                    key={location.code}
                    className={`tag-card${location.isHotspot ? " tag-card--hot" : ""}`}
                  >
                    <span className="tag-card__name">{location.name}</span>
                    <button
                      type="button"
                      className="tag-card__flag"
                      onClick={() => void toggleHotspot(location)}
                      title="切換是否為熱點（熱點會在儀表板優先統計）"
                      aria-pressed={location.isHotspot}
                    >
                      {location.isHotspot ? "🔥 熱點" : "設為熱點"}
                    </button>
                    <button
                      type="button"
                      className="tag-card__remove"
                      onClick={() => void deleteLocation(location)}
                      aria-label={`刪除 ${location.name}`}
                      title="刪除這個地點"
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            )}
            <span className="field__hint">
              點「🔥 熱點／設為熱點」切換；熱點會在儀表板的地點統計優先呈現。
              刪除不影響既有違規紀錄（已存下當時的地點名稱）。
            </span>
          </div>

          <div className="field">
            <span className="field__label">新增地點</span>
            <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
              <input
                type="text"
                value={newLocation}
                maxLength={20}
                placeholder="例：後棟樓梯"
                style={{ maxWidth: 220 }}
                onChange={(event) => setNewLocation(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void addLocation();
                }}
              />
              <button
                type="button"
                className={newHotspot ? "btn btn--sm btn--on" : "btn btn--sm"}
                onClick={() => setNewHotspot(!newHotspot)}
                aria-pressed={newHotspot}
              >
                🔥 列為熱點
              </button>
              <button
                className="btn btn--primary"
                disabled={savingLocation || !newLocation.trim()}
                onClick={() => void addLocation()}
              >
                {savingLocation ? "新增中…" : "新增"}
              </button>
            </div>
          </div>
        </div>
      </Panel>

      <Panel
        title="學生名冊"
        hint={
          preview
            ? `檔案 ${preview.rows.length} 位`
            : existing
              ? `目前在校 ${existing.filter((student) => student.active).length} 人`
              : "Excel 或 CSV 皆可"
        }
      >
        <div className="stack">
          <div className="field">
            <span className="field__label">匯入方式</span>
            <div className="btn-row">
              <button
                type="button"
                className={
                  importMode === "MERGE" ? "btn btn--sm btn--on" : "btn btn--sm"
                }
                onClick={() => setImportMode("MERGE")}
                aria-pressed={importMode === "MERGE"}
              >
                新增／更新
              </button>
              <button
                type="button"
                className={
                  importMode === "REPLACE"
                    ? "btn btn--sm btn--on"
                    : "btn btn--sm"
                }
                onClick={() => setImportMode("REPLACE")}
                aria-pressed={importMode === "REPLACE"}
              >
                完整名冊（新學年換屆）
              </button>
            </div>
            <span className="field__hint">
              {importMode === "MERGE"
                ? "只處理檔案中的學生：沒有的就新增，已有的更新班級與座號。適合學期中轉入或個別修正。"
                : "把檔案當成「本學年在校生的完整名冊」：不在檔案中的學生會標記為已畢業／轉出並停用。停用不是刪除 —— 違規歷程與再犯紀錄全部保留，只是不能再登錄新違規。"}
            </span>
          </div>

          <div className="field">
            <span className="field__label">從 Excel／CSV 匯入</span>
            <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
              <input
                ref={fileInput}
                type="file"
                accept=".xlsx,.xlsm,.csv,.txt"
                onChange={(event) =>
                  void pickFile(event.target.files?.[0] ?? null)
                }
              />
              {fileInfo && (
                <button
                  type="button"
                  className="btn btn--sm"
                  onClick={clearFile}
                >
                  清除檔案
                </button>
              )}
            </div>
            <span className="field__hint">
              直接選校務系統匯出的 .xlsx 或 .csv；欄位需包含
              <strong> 班級／座號／學號／姓名</strong>
              （標題列順序不拘，也可沒有標題列， 此時依 班級,座號,學號,姓名
              的順序讀取）。舊版 .xls 請先另存為 .xlsx。
            </span>
            {fileInfo && <span className="field__hint">已讀取 {fileInfo}</span>}
          </div>

          <Field
            label="或直接貼上"
            hint="每行一位，以逗號或 Tab 分隔。以學號為鍵，重複匯入只會更新、不會產生重複學生。"
          >
            <textarea
              value={roster}
              disabled={Boolean(table)}
              onChange={(event) => setRoster(event.target.value)}
              placeholder={
                "七年一班,1,1140101,王小明\n七年一班,2,1140102,李小美"
              }
              style={{
                minHeight: 100,
                fontFamily: "var(--font-mono, monospace)",
              }}
            />
          </Field>

          {preview && (
            <Callout tone={preview.errors.length > 0 ? "warning" : undefined}>
              <span aria-hidden="true">
                {preview.errors.length > 0 ? "⚠️" : "ℹ️"}
              </span>
              <span>
                解析到 <strong>{preview.rows.length}</strong> 位學生、
                {new Set(preview.rows.map((row) => row.className)).size}{" "}
                個班級。
                {existing && existing.length > 0 && (
                  <>
                    <br />
                    比對現有名冊（以學號為準）：新增{" "}
                    <strong>{preview.diff.created.length}</strong>{" "}
                    位、重新編班或更名{" "}
                    <strong>{preview.diff.reclassed.length}</strong> 位
                    {preview.diff.reactivated.length > 0 && (
                      <>、重新啟用 {preview.diff.reactivated.length} 位</>
                    )}
                    {importMode === "REPLACE" ? (
                      <>
                        、
                        <strong>
                          停用（畢業／轉出）{preview.diff.missing.length} 位
                        </strong>
                      </>
                    ) : (
                      <>
                        ；另有 {preview.diff.missing.length}{" "}
                        位在校生不在這份檔案中（此模式不會動到他們）
                      </>
                    )}
                    。
                  </>
                )}
                {preview.errors.length > 0 && (
                  <>
                    <br />有 <strong>{preview.errors.length}</strong>{" "}
                    列無法匯入：
                    {preview.errors.slice(0, 3).join("；")}
                    {preview.errors.length > 3 ? " …" : ""}
                  </>
                )}
              </span>
            </Callout>
          )}

          <div className="btn-row">
            <button
              className="btn btn--primary"
              disabled={importing || !preview || preview.rows.length === 0}
              onClick={() => void importRoster()}
            >
              {importing
                ? "匯入中…"
                : preview
                  ? `匯入 ${preview.rows.length} 位學生`
                  : "匯入名冊"}
            </button>
            <span className="small muted">
              可重複匯入：同學號只會更新資料，既有的再犯計次不會被清掉。
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
