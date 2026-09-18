import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api.ts';
import { ASSIGNMENT_STATUS_LABEL, ASSIGNMENT_STATUS_TONE, formatDate, formatDateTime, todayTaipei, } from '../lib/format.ts';
import { Badge, Callout, EmptyState, Panel } from '../components/ui.tsx';
import { useToast } from '../components/toast.tsx';
/**
 * 安全觀察員值勤台（學務處櫃台平板／電腦操作）
 *
 * 一日下課共 5 節（扣除打掃時間與 5 分鐘短下課）。
 * 每節「報到 → 離開」各一次打卡，離開時可記錄勸導人數與觀察心得；
 * 5 節完成後系統自動開立行為檢討書，待學生填寫。
 */
export function ObserverDesk() {
    const toast = useToast();
    const [rows, setRows] = useState(null);
    const [filter, setFilter] = useState('TODAY');
    const today = todayTaipei();
    const load = useCallback(() => {
        void api.assignments().then(setRows);
    }, []);
    useEffect(load, [load]);
    const act = async (assignment, periodNo, action) => {
        try {
            let observedCount;
            let note;
            if (action === 'CHECK_OUT') {
                const input = window.prompt(`第 ${periodNo} 節：提醒了幾位同學？（可留白）`, '0');
                if (input !== null && input.trim() !== '')
                    observedCount = Number(input);
                note = window.prompt('觀察紀錄（可留白）', '') ?? undefined;
            }
            const result = await api.logObserverPeriod({
                assignmentId: assignment.id,
                periodNo,
                action,
                observedCount,
                note: note || undefined,
            });
            toast.push(action === 'CHECK_IN'
                ? `${assignment.studentName} 第 ${periodNo} 節已報到`
                : `第 ${periodNo} 節完成（累計 ${result.completedPeriods}/${assignment.totalPeriods} 節）`);
            load();
        }
        catch (error) {
            toast.push(error instanceof Error ? error.message : '打卡失敗', 'error');
        }
    };
    const visible = (rows ?? []).filter((row) => filter === 'TODAY' ? row.dutyOn === today : true);
    return (_jsxs(_Fragment, { children: [_jsxs(Callout, { children: [_jsx("span", { "aria-hidden": "true", children: "\uD83D\uDC40" }), _jsxs("span", { children: ["\u503C\u52E4\u5167\u5BB9\uFF1A\u65BC\u5B78\u52D9\u8655\u5354\u52A9\u89C0\u5BDF\u8D70\u5ECA\u5954\u8DD1\u540C\u5B78\u4E26\u9069\u6642\u63D0\u9192\u3002", _jsx("strong", { children: "5 \u7BC0\u5B8C\u6210\u5F8C\u7CFB\u7D71\u81EA\u52D5\u958B\u7ACB\u884C\u70BA\u6AA2\u8A0E\u66F8" }), "\uFF1B\u6AA2\u8A0E\u66F8\u7D93\u5C0E\u5E2B\u7C3D\u7AE0 + \u751F\u6559\u7D44\u84CB\u7AE0\u5F8C\uFF0C", _jsx("strong", { children: "\u9694\u65E5\uFF08\u4E0B\u4E00\u500B\u4E0A\u8AB2\u65E5\uFF09" }), "\u6062\u5FA9\u81EA\u7531\u4E0B\u8AB2\u3002\u503C\u52E4\u671F\u9593\u53EF\u6B63\u5E38\u98F2\u6C34\u8207\u5982\u5EC1\u3002"] })] }), _jsx(Panel, { title: "\u503C\u52E4\u53F0", hint: `${visible.length} 位・${filter === 'TODAY' ? formatDate(today) : '全部日期'}`, actions: _jsxs("div", { className: "btn-row", children: [_jsx("button", { className: `btn${filter === 'TODAY' ? ' btn--primary' : ''}`, onClick: () => setFilter('TODAY'), children: "\u4ECA\u65E5" }), _jsx("button", { className: `btn${filter === 'ALL' ? ' btn--primary' : ''}`, onClick: () => setFilter('ALL'), children: "\u5168\u90E8" })] }), children: !rows ? (_jsx("div", { className: "muted", children: "\u8F09\u5165\u4E2D\u2026" })) : visible.length === 0 ? (_jsx(EmptyState, { title: "\u4ECA\u65E5\u6C92\u6709\u5B89\u5168\u89C0\u5BDF\u54E1\u503C\u52E4" })) : (_jsx("div", { className: "stack", children: visible.map((assignment) => {
                        const done = assignment.periodLogs.filter((log) => log.checkOutAt).length;
                        return (_jsxs("div", { className: "card", children: [_jsxs("div", { className: "card__head", children: [_jsxs("div", { children: [_jsxs("div", { className: "card__title", children: [assignment.className, " ", assignment.studentName, _jsxs("span", { className: "muted small", children: ["\uFF08", assignment.studentNo, "\uFF09"] })] }), _jsxs("div", { className: "small muted", children: ["\u503C\u52E4\u65E5 ", formatDate(assignment.dutyOn), "\u30FB\u9032\u5EA6 ", done, "/", assignment.totalPeriods, " \u7BC0", assignment.unlockOn ? `・預定解鎖 ${formatDate(assignment.unlockOn)}` : ''] })] }), _jsx("span", { className: "spacer" }), _jsx(Badge, { tone: ASSIGNMENT_STATUS_TONE[assignment.status], dot: true, children: ASSIGNMENT_STATUS_LABEL[assignment.status] })] }), _jsxs("div", { className: "card__body", children: [_jsx("div", { className: "table-wrap", children: _jsxs("table", { className: "data", children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { children: "\u7BC0\u6B21" }), _jsx("th", { children: "\u5831\u5230" }), _jsx("th", { children: "\u96E2\u958B" }), _jsx("th", { children: "\u52F8\u5C0E\u4EBA\u6578" }), _jsx("th", { children: "\u89C0\u5BDF\u7D00\u9304" }), _jsx("th", {})] }) }), _jsx("tbody", { children: assignment.periodLogs.map((log) => (_jsxs("tr", { children: [_jsxs("td", { className: "cell-strong", children: ["\u7B2C ", log.periodNo, " \u7BC0"] }), _jsx("td", { className: "cell-sub", children: formatDateTime(log.checkInAt) }), _jsx("td", { className: "cell-sub", children: formatDateTime(log.checkOutAt) }), _jsx("td", { className: "num", children: log.observedCount ?? '—' }), _jsx("td", { className: "cell-sub", children: log.note ?? '—' }), _jsx("td", { children: !log.checkInAt ? (_jsx("button", { className: "btn", onClick: () => void act(assignment, log.periodNo, 'CHECK_IN'), children: "\u5831\u5230" })) : !log.checkOutAt ? (_jsx("button", { className: "btn btn--primary", onClick: () => void act(assignment, log.periodNo, 'CHECK_OUT'), children: "\u96E2\u958B" })) : (_jsx(Badge, { tone: "good", children: "\u5DF2\u5B8C\u6210" })) })] }, log.periodNo))) })] }) }), assignment.status === 'DUTY_COMPLETED' && (_jsxs(Callout, { tone: "warning", children: [_jsx("span", { "aria-hidden": "true", children: "\uD83D\uDCDD" }), _jsxs("span", { children: ["\u503C\u52E4\u5DF2\u5B8C\u6210\uFF0C\u7CFB\u7D71\u5DF2\u958B\u7ACB", _jsx("strong", { children: "\u884C\u70BA\u6AA2\u8A0E\u66F8" }), "\uFF0C \u8ACB\u63D0\u9192\u5B78\u751F\u65BC\u4E0B\u8AB2\u6642\u9593\u81F3\u5B78\u52D9\u8655\u96FB\u8166\u586B\u5BEB\u3002"] })] }))] })] }, assignment.id));
                    }) })) })] }));
}
