import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../lib/api.ts';
import { formatDate, formatDateTime } from '../lib/format.ts';
import { Badge, Callout, EmptyState, Panel, StatTile } from '../components/ui.tsx';
const KIND_ICON = {
    INFRACTION: '📋',
    CARD: '📝',
    ALERT: '⚠️',
    DUTY: '👀',
    REVIEW: '📄',
};
const KIND_DOT = {
    INFRACTION: '',
    CARD: ' timeline__dot--done',
    ALERT: '',
    DUTY: ' timeline__dot--wait',
    REVIEW: ' timeline__dot--wait',
};
/** 學生查詢 + 個人行為歷程（輔導會議與親師溝通使用） */
export function StudentLookup() {
    const { studentId } = useParams();
    const [keyword, setKeyword] = useState('');
    const [results, setResults] = useState([]);
    const [detail, setDetail] = useState(null);
    const [error, setError] = useState(null);
    useEffect(() => {
        if (!studentId) {
            setDetail(null);
            return;
        }
        setError(null);
        void api
            .student(studentId)
            .then(setDetail)
            .catch((err) => setError(err instanceof Error ? err.message : '載入失敗'));
    }, [studentId]);
    useEffect(() => {
        if (keyword.trim().length < 2) {
            setResults([]);
            return;
        }
        void api.searchStudent(keyword).then(setResults);
    }, [keyword]);
    if (studentId) {
        if (error)
            return _jsx("div", { className: "field__error", children: error });
        if (!detail)
            return _jsx("div", { className: "muted", children: "\u8F09\u5165\u4E2D\u2026" });
        return (_jsxs(_Fragment, { children: [_jsx("div", { className: "row", children: _jsx(Link, { className: "btn btn--ghost", to: "/office/students", children: "\u2190 \u8FD4\u56DE\u67E5\u8A62" }) }), _jsxs(Panel, { title: `${detail.className} ${detail.name}`, hint: `學號 ${detail.studentNo}${detail.guardianEmail ? `・家長信箱 ${detail.guardianEmail}` : ''}`, actions: detail.restrictedToday ? (_jsx(Badge, { tone: "critical", dot: true, children: "\u4ECA\u65E5\u7BA1\u5236\u4E2D" })) : (_jsx(Badge, { tone: "good", dot: true, children: "\u4ECA\u65E5\u53EF\u81EA\u7531\u4E0B\u8AB2" })), children: [_jsxs("div", { className: "grid grid--kpi", children: [_jsx(StatTile, { label: "\u7D2F\u72AF\u8996\u7A97\u5167\u5F35\u6578", value: `${detail.progress.cardCount} / ${detail.progress.threshold}`, foot: `${detail.progress.windowStart} ~ ${detail.progress.windowEnd}`, meter: {
                                        value: detail.progress.cardCount,
                                        max: detail.progress.threshold,
                                        tone: detail.progress.cardCount >= detail.progress.threshold ? 'critical' : 'warning',
                                    }, tone: detail.progress.cardCount >= detail.progress.threshold ? 'alert' : undefined }), _jsx(StatTile, { label: "\u7D2F\u8A08\u9055\u898F\u767B\u9304", value: detail.totals.infractions, unit: "\u4EF6" }), _jsx(StatTile, { label: "\u7D2F\u8A08\u53CD\u601D\u5361", value: detail.totals.cards, unit: "\u5F35" }), _jsx(StatTile, { label: "\u5B89\u5168\u89C0\u5BDF\u54E1\u503C\u52E4", value: detail.totals.duties, unit: "\u6B21" })] }), detail.progress.shortfall > 0 && detail.progress.cardCount > 0 && (_jsxs(Callout, { tone: detail.progress.shortfall <= 1 ? 'warning' : undefined, children: [_jsx("span", { "aria-hidden": "true", children: detail.progress.shortfall <= 1 ? '⚠️' : 'ℹ️' }), _jsxs("span", { children: ["\u518D ", _jsx("strong", { children: detail.progress.shortfall }), " \u5F35\u53CD\u601D\u5361\u5373\u89F8\u767C\u7D2F\u72AF\u8B66\u793A\uFF0C \u5EFA\u8B70\u63D0\u524D\u5B89\u6392\u6664\u8AC7\u6216\u6B63\u5411\u652F\u6301\u63AA\u65BD\u3002"] })] }))] }), _jsx(Panel, { title: "\u884C\u70BA\u6B77\u7A0B", hint: "\u542B\u9055\u898F\u767B\u9304\u3001\u53CD\u601D\u5361\u3001\u8B66\u793A\u8207\u503C\u52E4\u7D00\u9304", children: detail.timeline.length === 0 ? (_jsx(EmptyState, { title: "\u5C1A\u7121\u4EFB\u4F55\u7D00\u9304" })) : (_jsx("div", { className: "timeline", children: detail.timeline.map((item) => (_jsxs("div", { className: "timeline__item", children: [_jsx("span", { className: `timeline__dot${KIND_DOT[item.kind] ?? ''}` }), _jsxs("div", { children: [_jsxs("div", { className: "timeline__title", children: [_jsxs("span", { "aria-hidden": "true", children: [KIND_ICON[item.kind], " "] }), item.title] }), _jsxs("div", { className: "timeline__meta", children: [formatDateTime(item.at), "\u30FB", item.detail] })] })] }, `${item.kind}-${item.id}`))) })) })] }));
    }
    return (_jsx(Panel, { title: "\u5B78\u751F\u67E5\u8A62", hint: "\u8F38\u5165\u5B78\u865F\u6216\u59D3\u540D", children: _jsxs("div", { className: "stack", children: [_jsx("input", { type: "text", value: keyword, onChange: (event) => setKeyword(event.target.value), placeholder: "\u4F8B\uFF1A1140101 \u6216 \u738B\u5C0F\u660E", autoFocus: true }), results.length === 0 ? (_jsx("div", { className: "muted small", children: "\u8ACB\u8F38\u5165 2 \u500B\u5B57\u4EE5\u4E0A\u9032\u884C\u67E5\u8A62\u3002" })) : (_jsx("div", { className: "table-wrap", children: _jsxs("table", { className: "data", children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { children: "\u73ED\u7D1A" }), _jsx("th", { children: "\u5B78\u865F" }), _jsx("th", { children: "\u59D3\u540D" }), _jsx("th", { children: "15 \u5929\u5167\u5F35\u6578" }), _jsx("th", {})] }) }), _jsx("tbody", { children: results.map((row) => (_jsxs("tr", { children: [_jsx("td", { children: row.className }), _jsx("td", { className: "num", children: row.studentNo }), _jsx("td", { className: "cell-strong", children: row.name }), _jsx("td", { className: "num", children: typeof row.windowCardCount === 'number' ? (_jsxs(Badge, { tone: row.windowCardCount >= 2 ? 'critical' : 'neutral', children: [row.windowCardCount, " / 3"] })) : ('—') }), _jsx("td", { children: _jsx(Link, { className: "btn", to: `/office/students/${row.id}`, children: "\u67E5\u770B\u6B77\u7A0B" }) })] }, row.id))) })] }) })), _jsxs("div", { className: "small muted", children: ["\u67E5\u8A62\u65E5\uFF1A", formatDate(new Date().toISOString()), "\uFF5C\u6B77\u7A0B\u8CC7\u6599\u542B\u9055\u898F\u767B\u9304\u3001\u53CD\u601D\u5361\u3001\u7D2F\u72AF\u8B66\u793A\u8207\u503C\u52E4\u7D00\u9304\u3002"] })] }) }));
}
