import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
export function Badge({ tone = 'neutral', children, dot = false, }) {
    return (_jsxs("span", { className: `badge badge--${tone}`, children: [dot && _jsx("span", { className: "badge__dot", "aria-hidden": "true" }), children] }));
}
/* -------------------------------- 統計磚 ------------------------------- */
/**
 * KPI 統計磚：資料的任務是「單一標題數字」，不畫圖。
 * 數字使用等寬數字（tabular-nums）避免更新時跳動。
 */
export function StatTile({ label, value, unit, foot, tone, meter, icon, }) {
    const percent = meter ? Math.min(100, Math.round((meter.value / Math.max(1, meter.max)) * 100)) : 0;
    return (_jsxs("div", { className: `card tile${tone === 'alert' ? ' tile--alert' : ''}`, children: [_jsxs("div", { className: "tile__label", children: [icon && _jsx("span", { "aria-hidden": "true", children: icon }), label] }), _jsxs("div", { className: "tile__value", children: [value, unit && _jsx("span", { className: "tile__unit", children: unit })] }), meter && (_jsx("div", { className: "meter", role: "img", "aria-label": `${meter.value} / ${meter.max}`, children: _jsx("div", { className: `meter__fill${meter.tone ? ` meter__fill--${meter.tone}` : ''}`, style: { width: `${percent}%` } }) })), foot && _jsx("div", { className: "tile__foot", children: foot })] }));
}
/* --------------------------------- 卡片 -------------------------------- */
export function Panel({ title, hint, actions, flush, children, style, }) {
    return (_jsxs("section", { className: "card", style: style, children: [_jsxs("header", { className: "card__head", children: [_jsx("h2", { className: "card__title", children: title }), hint && _jsx("span", { className: "card__hint", children: hint }), _jsx("span", { className: "spacer" }), actions] }), _jsx("div", { className: `card__body${flush ? ' card__body--flush' : ''}`, children: children })] }));
}
export function EmptyState({ icon = '✓', title, hint }) {
    return (_jsxs("div", { className: "empty", children: [_jsx("div", { className: "empty__icon", "aria-hidden": "true", children: icon }), _jsx("div", { children: title }), hint && _jsx("div", { className: "small", children: hint })] }));
}
export function Callout({ tone, children, }) {
    return _jsx("div", { className: `callout${tone ? ` callout--${tone}` : ''}`, children: children });
}
export function Field({ label, hint, error, children, }) {
    return (_jsxs("label", { className: "field", children: [_jsx("span", { className: "field__label", children: label }), children, hint && !error && _jsx("span", { className: "field__hint", children: hint }), error && _jsx("span", { className: "field__error", children: error })] }));
}
/** 正向管教固定提示：管制期間的基本權益不受限制 */
export function WaterNotice() {
    return (_jsxs(Callout, { children: [_jsx("span", { "aria-hidden": "true", children: "\uD83D\uDCA7" }), _jsxs("span", { children: ["\u7BA1\u5236\u671F\u9593\u5B78\u751F", _jsx("strong", { children: "\u53EF\u6B63\u5E38\u98F2\u6C34\u8207\u5982\u5EC1" }), "\uFF1B\u53CD\u601D\u5C6C\u6559\u80B2\u6B77\u7A0B\uFF0C\u975E\u525D\u596A\u57FA\u672C\u9700\u6C42\u3002"] })] }));
}
