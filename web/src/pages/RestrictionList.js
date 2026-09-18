import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.ts';
import { RESTRICTION_REASON_LABEL, formatDate, todayTaipei, weekdayLabel } from '../lib/format.ts';
import { Badge, EmptyState, Panel, WaterNotice } from '../components/ui.tsx';
/** 下課管制名單（可查任一日；供學務處印出張貼於值班台） */
export function RestrictionList() {
    const [date, setDate] = useState(todayTaipei());
    const [rows, setRows] = useState(null);
    useEffect(() => {
        setRows(null);
        void api.restrictions(date).then(setRows);
    }, [date]);
    const active = (rows ?? []).filter((row) => row.status === 'ACTIVE');
    return (_jsxs(_Fragment, { children: [_jsx(Panel, { title: "\u4E0B\u8AB2\u7BA1\u5236\u540D\u55AE", hint: `${formatDate(date)}（${weekdayLabel(date)}）・管制中 ${active.length} 人`, actions: _jsxs("div", { className: "row", children: [_jsx("input", { type: "date", value: date, onChange: (event) => setDate(event.target.value), style: { width: 170 } }), _jsx("button", { className: "btn", onClick: () => window.print(), children: "\u5217\u5370" })] }), flush: true, children: !rows ? (_jsx("div", { className: "card__body muted", children: "\u8F09\u5165\u4E2D\u2026" })) : rows.length === 0 ? (_jsx(EmptyState, { title: "\u8A72\u65E5\u7121\u7BA1\u5236\u540D\u55AE" })) : (_jsx("div", { className: "table-wrap", children: _jsxs("table", { className: "data", children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { children: "\u73ED\u7D1A" }), _jsx("th", { children: "\u5B78\u865F" }), _jsx("th", { children: "\u59D3\u540D" }), _jsx("th", { children: "\u7BA1\u5236\u539F\u56E0" }), _jsx("th", { children: "\u7BC0\u6B21" }), _jsx("th", { children: "\u72C0\u614B" }), _jsx("th", { children: "\u5099\u8A3B" })] }) }), _jsx("tbody", { children: rows.map((row) => (_jsxs("tr", { children: [_jsx("td", { children: row.className }), _jsx("td", { className: "num", children: row.studentNo }), _jsx("td", { className: "cell-strong", children: _jsx(Link, { to: `/office/students/${row.studentId}`, children: row.studentName }) }), _jsx("td", { children: _jsx("div", { className: "row", style: { gap: 6 }, children: row.reasons.length === 0 ? (_jsx("span", { className: "muted small", children: "\u2014" })) : (row.reasons.map((reason) => (_jsx(Badge, { tone: "serious", children: RESTRICTION_REASON_LABEL[reason] }, reason)))) }) }), _jsx("td", { className: "cell-sub", children: row.reasons.includes('OBSERVER_DUTY') ? '1–5 節' : '全部下課' }), _jsx("td", { children: row.status === 'ACTIVE' ? (_jsx(Badge, { tone: "critical", dot: true, children: "\u7BA1\u5236\u4E2D" })) : (_jsx(Badge, { tone: "good", dot: true, children: "\u5DF2\u89E3\u9664" })) }), _jsx("td", { className: "cell-sub", children: row.note ?? '—' })] }, row.id))) })] }) })) }), _jsx(WaterNotice, {})] }));
}
