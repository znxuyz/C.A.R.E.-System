import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api.ts';
import { CASE_STATUS_LABEL, CASE_STATUS_TONE, FORM_KIND_TONE, formatDate, formatDateTime, } from '../lib/format.ts';
import { Badge, EmptyState, Panel } from '../components/ui.tsx';
import { CardReviewDrawer } from '../components/CardReviewDrawer.tsx';
/**
 * 審核佇列
 *  - 生教組（stage=DISCIPLINE_OFFICE）：第二層蓋章，先進先出
 *  - 導師（stage=HOMEROOM_TEACHER）：第一層簽章，只看自己班級
 */
export function ReviewQueue({ session, stage, }) {
    const [rows, setRows] = useState(null);
    const [active, setActive] = useState(null);
    const load = useCallback(() => {
        if (stage === 'DISCIPLINE_OFFICE') {
            void api.officeQueue().then(setRows);
            return;
        }
        // 導師只看自己所轄班級（班級清單取自 staff/{uid}.classIds）
        void api
            .myClassIds(session.uid)
            .then((classIds) => api.teacherQueue(classIds))
            .then(setRows);
    }, [stage, session.uid]);
    useEffect(load, [load]);
    const isOffice = stage === 'DISCIPLINE_OFFICE';
    return (_jsxs(_Fragment, { children: [_jsx(Panel, { title: isOffice ? '待生教組蓋章' : '待導師簽章', hint: rows ? `${rows.length} 件・依送達時間先後排序` : '載入中…', flush: true, actions: _jsx("button", { className: "btn", onClick: load, children: "\u91CD\u65B0\u6574\u7406" }), children: !rows ? (_jsx("div", { className: "card__body muted", children: "\u8F09\u5165\u4E2D\u2026" })) : rows.length === 0 ? (_jsx(EmptyState, { title: isOffice ? '沒有待蓋章的案件' : '沒有待簽章的案件', hint: "\u6240\u6709\u6848\u4EF6\u90FD\u5DF2\u8655\u7406\u5B8C\u7562\u3002" })) : (_jsx("div", { className: "table-wrap", children: _jsxs("table", { className: "data", children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { children: "\u73ED\u7D1A / \u5B78\u751F" }), _jsx("th", { children: "\u9055\u898F\u985E\u578B" }), _jsx("th", { children: "\u53CD\u601D\u5361" }), _jsx("th", { children: isOffice ? '導師簽章' : '學生送出' }), _jsx("th", { children: "\u7D2F\u72AF\u9032\u5EA6" }), _jsx("th", { children: "\u72C0\u614B" }), _jsx("th", {})] }) }), _jsx("tbody", { children: rows.map((card) => (_jsxs("tr", { children: [_jsxs("td", { className: "cell-strong", children: [card.className, " ", card.studentName, _jsxs("div", { className: "cell-sub", children: [card.studentNo, "\u30FB\u9055\u898F\u65E5 ", formatDate(card.countOn)] })] }), _jsx("td", { children: card.typeName }), _jsx("td", { children: _jsx(Badge, { tone: FORM_KIND_TONE[card.formKind], children: card.formTitle }) }), _jsx("td", { className: "cell-sub", children: isOffice
                                                ? `${card.teacherName ?? ''} ${formatDateTime(card.teacherSignedAt)}`
                                                : formatDateTime(card.submittedAt) }), _jsx("td", { className: "num", children: typeof card.windowCardCount === 'number' ? (_jsxs(Badge, { tone: card.windowCardCount >= 2 ? 'critical' : 'neutral', children: [card.windowCardCount, " / 3 \u5F35"] })) : ('—') }), _jsx("td", { children: _jsx(Badge, { tone: CASE_STATUS_TONE[card.status], children: CASE_STATUS_LABEL[card.status] }) }), _jsx("td", { children: _jsx("button", { className: "btn btn--primary", onClick: () => setActive(card.id), children: isOffice ? '審核蓋章' : '查看並簽章' }) })] }, card.id))) })] }) })) }), active && (_jsx(CardReviewDrawer, { cardId: active, stage: stage, actorName: session.name, onClose: () => setActive(null), onDone: load }))] }));
}
