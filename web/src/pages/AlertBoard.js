import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { Fragment, useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.ts';
import { FORM_KIND_LABEL, formatDate, formatDateTime } from '../lib/format.ts';
import { Badge, Callout, EmptyState, Panel } from '../components/ui.tsx';
import { useToast } from '../components/toast.tsx';
const ALERT_TONE = {
    OPEN: 'critical',
    ACKNOWLEDGED: 'warning',
    ASSIGNED: 'serious',
    CLOSED: 'good',
    DISMISSED: 'neutral',
};
const ALERT_LABEL = {
    OPEN: '待確認',
    ACKNOWLEDGED: '已確認',
    ASSIGNED: '已派安全觀察員',
    CLOSED: '已結案',
    DISMISSED: '已撤銷',
};
/** 累犯警示與安全觀察員追蹤清單 */
export function AlertBoard() {
    const toast = useToast();
    const [rows, setRows] = useState(null);
    const [expanded, setExpanded] = useState(null);
    const load = useCallback(() => {
        void api.alerts().then(setRows);
    }, []);
    useEffect(load, [load]);
    const dismiss = async (alert) => {
        const reason = window.prompt(`撤銷 ${alert.studentName} 的累犯警示，請說明理由（將寫入稽核軌跡）：`, '');
        if (!reason?.trim())
            return;
        try {
            await api.dismissAlert(alert.id, reason.trim());
            toast.push('已撤銷警示，計入的反思卡回復為可計數狀態');
            load();
        }
        catch (error) {
            toast.push(error instanceof Error ? error.message : '操作失敗', 'error');
        }
    };
    const reschedule = async (alert) => {
        if (!alert.assignmentId)
            return;
        const dutyOn = window.prompt('請輸入新的值勤日（YYYY-MM-DD）：', alert.dutyOn ?? '');
        if (!dutyOn || !/^\d{4}-\d{2}-\d{2}$/.test(dutyOn))
            return;
        try {
            await api.rescheduleDuty(alert.assignmentId, dutyOn);
            toast.push(`已改期至 ${dutyOn}，並同步調整下課管制`);
            load();
        }
        catch (error) {
            toast.push(error instanceof Error ? error.message : '改期失敗', 'error');
        }
    };
    return (_jsxs(_Fragment, { children: [_jsxs(Callout, { tone: "warning", children: [_jsx("span", { "aria-hidden": "true", children: "\u26A0\uFE0F" }), _jsxs("span", { children: ["\u89F8\u767C\u898F\u5247\uFF1A\u540C\u4E00\u5B78\u751F\u65BC ", _jsx("strong", { children: "15 \u5929\u5167\uFF08\u542B\u7576\u5929\uFF09" }), "\u7D2F\u8A08\u586B\u5BEB", _jsx("strong", { children: " 3 \u5F35" }), "\u53CD\u601D\u5361\uFF08\u4E0D\u8AD6\u5B89\u5168\u5361\u6216\u597D\u8A71\u5361\uFF09\u5373\u767C\u51FA\u8B66\u793A\uFF0C\u4E26\u81EA\u52D5\u6392\u5165 \u5B89\u5168\u89C0\u5BDF\u54E1\u8FFD\u8E64\u6E05\u55AE\u3002\u5DF2\u8A08\u5165\u7684\u5361\u7247\u6703\u88AB\u300C\u8A8D\u5217\u300D\uFF0C\u4E0D\u6703\u5C0D\u540C\u4E00\u6CE2\u8655\u5206\u91CD\u8907\u89F8\u767C\u3002"] })] }), _jsx(Panel, { title: "\u7D2F\u72AF\u8B66\u793A", hint: rows ? `${rows.length} 筆` : '載入中…', flush: true, children: !rows ? (_jsx("div", { className: "card__body muted", children: "\u8F09\u5165\u4E2D\u2026" })) : rows.length === 0 ? (_jsx(EmptyState, { title: "\u76EE\u524D\u6C92\u6709\u7D2F\u72AF\u8B66\u793A", hint: "\u6301\u7E8C\u95DC\u6CE8 15 \u5929\u5167\u7D2F\u8A08 2 \u5F35\u7684\u5B78\u751F\u3002" })) : (_jsx("div", { className: "table-wrap", children: _jsxs("table", { className: "data", children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { children: "\u5B78\u751F" }), _jsx("th", { children: "\u89F8\u767C\u6642\u9593" }), _jsx("th", { children: "\u8996\u7A97" }), _jsx("th", { children: "\u5F35\u6578" }), _jsx("th", { children: "\u503C\u52E4\u65E5" }), _jsx("th", { children: "\u72C0\u614B" }), _jsx("th", {})] }) }), _jsx("tbody", { children: rows.map((alert) => (_jsxs(Fragment, { children: [_jsxs("tr", { children: [_jsxs("td", { className: "cell-strong", children: [_jsxs(Link, { to: `/office/students/${alert.studentId}`, children: [alert.className, " ", alert.studentName] }), _jsx("div", { className: "cell-sub", children: alert.studentNo })] }), _jsx("td", { className: "cell-sub", children: formatDateTime(alert.triggeredAt) }), _jsxs("td", { className: "cell-sub", children: [alert.windowStart, " ~ ", alert.windowEnd, _jsxs("div", { className: "cell-sub", children: ["\uFF08", alert.windowDays, " \u5929\uFF09"] })] }), _jsx("td", { className: "num", children: _jsxs(Badge, { tone: "critical", children: [alert.cardCount, " / ", alert.threshold] }) }), _jsx("td", { children: alert.dutyOn ? formatDate(alert.dutyOn) : '待排' }), _jsx("td", { children: _jsx(Badge, { tone: ALERT_TONE[alert.status], dot: true, children: ALERT_LABEL[alert.status] }) }), _jsx("td", { children: _jsxs("div", { className: "btn-row", children: [_jsx("button", { className: "btn", onClick: () => setExpanded(expanded === alert.id ? null : alert.id), children: expanded === alert.id ? '收合' : '依據' }), alert.assignmentId && alert.status !== 'DISMISSED' && (_jsx("button", { className: "btn", onClick: () => void reschedule(alert), children: "\u6539\u671F" })), alert.status !== 'DISMISSED' && alert.status !== 'CLOSED' && (_jsx("button", { className: "btn btn--ghost", onClick: () => void dismiss(alert), children: "\u64A4\u92B7" }))] }) })] }), expanded === alert.id && (_jsx("tr", { children: _jsxs("td", { colSpan: 7, style: { background: 'var(--surface-sunken)' }, children: [_jsxs("div", { className: "small", children: [_jsx("strong", { children: "\u8A08\u5165\u672C\u6B21\u8B66\u793A\u7684\u53CD\u601D\u5361" }), "\uFF08\u5DF2\u8A8D\u5217\uFF0C\u4E0D\u518D\u91CD\u8907\u8A08\u6578\uFF09"] }), _jsx("ul", { className: "small", style: { margin: '6px 0 0', paddingLeft: 18 }, children: alert.breakdown.map((item) => (_jsxs("li", { children: [formatDate(item.countOn), "\uFF5C", FORM_KIND_LABEL[item.formKind], _jsxs("span", { className: "muted", children: ["\uFF08\u5361\u7247 ", item.cardId, "\uFF09"] })] }, item.cardId))) })] }) }))] }, alert.id))) })] }) })) })] }));
}
