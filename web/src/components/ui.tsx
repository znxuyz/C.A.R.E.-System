import type { CSSProperties, ReactNode } from 'react';

/* --------------------------------- 標章 -------------------------------- */

export type Tone = 'neutral' | 'good' | 'warning' | 'serious' | 'critical' | 'safety' | 'words';

export function Badge({
  tone = 'neutral',
  children,
  dot = false,
}: {
  tone?: Tone | string;
  children: ReactNode;
  dot?: boolean;
}) {
  return (
    <span className={`badge badge--${tone}`}>
      {dot && <span className="badge__dot" aria-hidden="true" />}
      {children}
    </span>
  );
}

/* -------------------------------- 統計磚 ------------------------------- */

/**
 * KPI 統計磚：資料的任務是「單一標題數字」，不畫圖。
 * 數字使用等寬數字（tabular-nums）避免更新時跳動。
 */
export function StatTile({
  label,
  value,
  unit,
  foot,
  tone,
  meter,
  icon,
}: {
  label: string;
  value: number | string;
  unit?: string;
  foot?: ReactNode;
  tone?: 'alert';
  meter?: { value: number; max: number; tone?: 'warning' | 'critical' };
  icon?: string;
}) {
  const percent = meter ? Math.min(100, Math.round((meter.value / Math.max(1, meter.max)) * 100)) : 0;
  return (
    <div className={`card tile${tone === 'alert' ? ' tile--alert' : ''}`}>
      <div className="tile__label">
        {icon && <span aria-hidden="true">{icon}</span>}
        {label}
      </div>
      <div className="tile__value">
        {value}
        {unit && <span className="tile__unit">{unit}</span>}
      </div>
      {meter && (
        <div className="meter" role="img" aria-label={`${meter.value} / ${meter.max}`}>
          <div
            className={`meter__fill${meter.tone ? ` meter__fill--${meter.tone}` : ''}`}
            style={{ width: `${percent}%` }}
          />
        </div>
      )}
      {foot && <div className="tile__foot">{foot}</div>}
    </div>
  );
}

/* --------------------------------- 卡片 -------------------------------- */

export function Panel({
  title,
  hint,
  actions,
  flush,
  children,
  style,
}: {
  title: string;
  hint?: ReactNode;
  actions?: ReactNode;
  flush?: boolean;
  children: ReactNode;
  style?: CSSProperties;
}) {
  return (
    <section className="card" style={style}>
      <header className="card__head">
        <h2 className="card__title">{title}</h2>
        {hint && <span className="card__hint">{hint}</span>}
        <span className="spacer" />
        {actions}
      </header>
      <div className={`card__body${flush ? ' card__body--flush' : ''}`}>{children}</div>
    </section>
  );
}

export function EmptyState({ icon = '✓', title, hint }: { icon?: string; title: string; hint?: string }) {
  return (
    <div className="empty">
      <div className="empty__icon" aria-hidden="true">
        {icon}
      </div>
      <div>{title}</div>
      {hint && <div className="small">{hint}</div>}
    </div>
  );
}

export function Callout({
  tone,
  children,
}: {
  tone?: 'warning';
  children: ReactNode;
}) {
  return <div className={`callout${tone ? ` callout--${tone}` : ''}`}>{children}</div>;
}

export function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <label className="field">
      <span className="field__label">{label}</span>
      {children}
      {hint && !error && <span className="field__hint">{hint}</span>}
      {error && <span className="field__error">{error}</span>}
    </label>
  );
}

/** 正向管教固定提示：管制期間的基本權益不受限制 */
export function WaterNotice() {
  return (
    <Callout>
      <span aria-hidden="true">💧</span>
      <span>
        管制期間學生<strong>可正常飲水與如廁</strong>；反思屬教育歷程，非剝奪基本需求。
      </span>
    </Callout>
  );
}
