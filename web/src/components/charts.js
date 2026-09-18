import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
/**
 * 儀表板圖表
 *
 * 設計依據（已驗證）：
 *  - 分類色固定指派：slot 1（藍 #2a78d6 / 深色 #3987e5）= 校園安全反思卡、
 *    slot 2（橘 #eb6834 / #d95926）= 口說好話反思卡；不循環重用。
 *    以色盲模擬驗證：淺色 ΔE 24.7、深色 ΔE 26.8（門檻 ≥ 8）。
 *  - 兩個系列同時存在 → 必有圖例，並提供表格檢視，識別不靠顏色單獨傳達。
 *  - 單一軸；堆疊段之間留 2px 底色縫隙；資料端 4px 圓角；hover 顯示提示。
 *  - 以 HTML/CSS 繪製（非拉伸的 SVG viewBox），避免座標軸文字被非等比縮放而變形。
 */
import { useState } from 'react';
import { formatDate, weekdayLabel } from '../lib/format.ts';
const PLOT_HEIGHT = 120;
export function TrendChart({ data }) {
    const [hover, setHover] = useState(null);
    const max = Math.max(1, ...data.map((point) => point.safety + point.words));
    return (_jsxs("div", { className: "chart", children: [_jsxs("div", { className: "legend", children: [_jsxs("span", { className: "legend__item", children: [_jsx("span", { className: "legend__swatch", style: { background: 'var(--series-1)' }, "aria-hidden": "true" }), "\u6821\u5712\u5B89\u5168\u53CD\u601D\u5361"] }), _jsxs("span", { className: "legend__item", children: [_jsx("span", { className: "legend__swatch", style: { background: 'var(--series-2)' }, "aria-hidden": "true" }), "\u53E3\u8AAA\u597D\u8A71\u53CD\u601D\u5361"] }), _jsx("span", { className: "spacer" }), _jsxs("span", { className: "axis-note", children: ["\u55AE\u4F4D\uFF1A\u5F35\uFF0F\u65E5\u30FB\u8EF8\u9AD8 ", max, " \u5F35"] })] }), _jsx("div", { className: "trend", role: "img", "aria-label": `近 ${data.length} 天每日反思卡張數趨勢，最高 ${max} 張`, children: data.map((point, index) => {
                    const total = point.safety + point.words;
                    const safetyH = (point.safety / max) * PLOT_HEIGHT;
                    const wordsH = (point.words / max) * PLOT_HEIGHT;
                    const dim = hover !== null && hover !== index;
                    return (_jsxs("div", { className: "trend__col", onMouseEnter: () => setHover(index), onMouseLeave: () => setHover(null), children: [_jsx("div", { className: "trend__stack", style: { height: PLOT_HEIGHT }, children: total === 0 ? (_jsx("span", { className: "trend__zero" })) : (_jsxs(_Fragment, { children: [wordsH > 0 && (_jsx("span", { className: "trend__seg trend__seg--words", style: { height: Math.max(3, wordsH), opacity: dim ? 0.5 : 1 } })), safetyH > 0 && (_jsx("span", { className: "trend__seg trend__seg--safety", style: { height: Math.max(3, safetyH), opacity: dim ? 0.5 : 1 } }))] })) }), _jsx("span", { className: "trend__label", children: point.date.slice(5).replace('-', '/') }), hover === index && (_jsxs("div", { className: "trend__tip", role: "tooltip", children: [_jsxs("div", { style: { fontWeight: 500 }, children: [formatDate(point.date), "\uFF08", weekdayLabel(point.date), "\uFF09"] }), _jsxs("div", { className: "row", style: { gap: 6 }, children: [_jsx("span", { className: "legend__swatch", style: { background: 'var(--series-1)' } }), "\u5B89\u5168\u5361 ", _jsx("strong", { children: point.safety }), " \u5F35"] }), _jsxs("div", { className: "row", style: { gap: 6 }, children: [_jsx("span", { className: "legend__swatch", style: { background: 'var(--series-2)' } }), "\u597D\u8A71\u5361 ", _jsx("strong", { children: point.words }), " \u5F35"] })] }))] }, point.date));
                }) }), _jsxs("details", { children: [_jsx("summary", { className: "small muted", style: { cursor: 'pointer' }, children: "\u8868\u683C\u6AA2\u8996\uFF08\u7121\u969C\u7919 / \u532F\u51FA\u7528\uFF09" }), _jsx("div", { className: "table-wrap", style: { marginTop: 8 }, children: _jsxs("table", { className: "data", children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { children: "\u65E5\u671F" }), _jsx("th", { children: "\u6821\u5712\u5B89\u5168\u53CD\u601D\u5361" }), _jsx("th", { children: "\u53E3\u8AAA\u597D\u8A71\u53CD\u601D\u5361" }), _jsx("th", { children: "\u5408\u8A08" })] }) }), _jsx("tbody", { children: data.map((point) => (_jsxs("tr", { children: [_jsxs("td", { children: [point.date, "\uFF08", weekdayLabel(point.date), "\uFF09"] }), _jsx("td", { className: "num", children: point.safety }), _jsx("td", { className: "num", children: point.words }), _jsx("td", { className: "num cell-strong", children: point.safety + point.words })] }, point.date))) })] }) })] })] }));
}
/** 熱點地點：單一系列的量值比較 → 水平條，單一色相 */
export function HotspotBars({ data }) {
    const max = Math.max(1, ...data.map((item) => item.count));
    if (data.length === 0) {
        return _jsx("div", { className: "small muted", children: "\u5C1A\u7121\u8CC7\u6599" });
    }
    return (_jsx("div", { className: "bars", children: data.map((item) => (_jsxs("div", { className: "bar-row", children: [_jsx("span", { className: "muted", style: { textAlign: 'right' }, children: item.name }), _jsx("span", { className: "bar-track", children: _jsx("span", { className: "bar-fill", style: { width: `${Math.max(3, (item.count / max) * 100)}%` } }) }), _jsx("span", { className: "num cell-strong", children: item.count })] }, item.name))) }));
}
