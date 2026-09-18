import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useEffect, useState } from 'react';
import { api } from '../lib/api.ts';
import { CASE_STATUS_LABEL, CASE_STATUS_TONE, FORM_KIND_TONE, ROLE_LABEL, formatDate, formatDateTime, } from '../lib/format.ts';
import { Badge, Callout, Field } from './ui.tsx';
import { Drawer } from './Drawer.tsx';
import { useToast } from './toast.tsx';
/**
 * 反思卡審核抽屜（導師簽章 / 生教組蓋章共用）
 *
 * 審核者需要在同一畫面看到四件事，才能「看內容做判斷」而非蓋橡皮章：
 *  ① 違規事實（誰登錄、何時、何地、第幾節）
 *  ② 學生逐題作答
 *  ③ 15 天累犯進度（決定是否需要進一步輔導）
 *  ④ 簽核軌跡（誰簽過、幾點簽的）
 */
export function CardReviewDrawer({ cardId, stage, actorName, onClose, onDone, }) {
    const toast = useToast();
    const [card, setCard] = useState(null);
    const [comment, setComment] = useState('');
    const [activityPriority, setActivityPriority] = useState(false);
    const [exemptReason, setExemptReason] = useState('');
    const [busy, setBusy] = useState(false);
    useEffect(() => {
        void api
            .card(cardId)
            .then(setCard)
            .catch((error) => toast.push(error instanceof Error ? error.message : '載入失敗', 'error'));
    }, [cardId, toast]);
    const act = async (decision) => {
        if (!card)
            return;
        setBusy(true);
        try {
            const input = {
                cardId: card.id,
                decision,
                comment: comment.trim() || undefined,
                teacherActivityPriority: stage === 'HOMEROOM_TEACHER' ? activityPriority : undefined,
                exemptReason: exemptReason.trim() || undefined,
            };
            if (stage === 'HOMEROOM_TEACHER') {
                await api.teacherSign(input, actorName);
                toast.push(activityPriority
                    ? '已勾選班級活動優先：該時段不計入處分，當日管制已解除'
                    : decision === 'SIGNED'
                        ? '已完成導師簽章，案件送交生教組'
                        : '已退回學生補正');
            }
            else {
                await api.officeStamp(input, actorName);
                toast.push(decision === 'SIGNED' ? '已蓋章結案，當日下課管制解除' : '已退回補正');
            }
            onDone();
            onClose();
        }
        catch (error) {
            toast.push(error instanceof Error ? error.message : '操作失敗', 'error');
        }
        finally {
            setBusy(false);
        }
    };
    if (!card) {
        return (_jsx(Drawer, { title: "\u8F09\u5165\u4E2D\u2026", onClose: onClose, children: _jsx("div", { className: "muted", children: "\u8B80\u53D6\u53CD\u601D\u5361\u5167\u5BB9\u2026" }) }));
    }
    const answered = card.template.sections.flatMap((section) => section.questions.map((question) => ({
        section: section.title,
        label: question.label,
        value: card.answers[question.id],
    })));
    return (_jsxs(Drawer, { title: `${card.className} ${card.studentName}・${card.formTitle}`, subtitle: _jsxs(_Fragment, { children: ["\u5B78\u865F ", card.studentNo, "\uFF5C", card.typeName, "\uFF5C\u57FA\u6E96\u65E5 ", formatDate(card.countOn)] }), onClose: onClose, footer: _jsxs(_Fragment, { children: [_jsx("button", { className: "btn", disabled: busy, onClick: () => void act('RETURNED'), children: "\u9000\u56DE\u88DC\u6B63" }), _jsx("button", { className: "btn btn--primary", disabled: busy, onClick: () => void act('SIGNED'), children: stage === 'HOMEROOM_TEACHER'
                        ? activityPriority
                            ? '確認班級活動優先（不計處分）'
                            : '完成導師簽章'
                        : '蓋章結案（當日解除管制）' })] }), children: [_jsxs("div", { className: "row", children: [_jsx(Badge, { tone: CASE_STATUS_TONE[card.status], dot: true, children: CASE_STATUS_LABEL[card.status] }), _jsx(Badge, { tone: FORM_KIND_TONE[card.formKind], children: card.formTitle }), card.returnCount > 0 && _jsxs(Badge, { tone: "warning", children: ["\u5DF2\u9000\u56DE ", card.returnCount, " \u6B21"] })] }), _jsxs("section", { children: [_jsx("h3", { className: "card__title", style: { fontSize: 14, marginBottom: 8 }, children: "\u9055\u898F\u4E8B\u5BE6" }), _jsxs("dl", { className: "kv", children: [_jsx("dt", { children: "\u985E\u578B" }), _jsx("dd", { children: card.infraction.typeName }), _jsx("dt", { children: "\u6642\u9593" }), _jsxs("dd", { children: [formatDateTime(card.infraction.occurredAt), card.infraction.periodNo ? `・第 ${card.infraction.periodNo} 節下課` : ''] }), _jsx("dt", { children: "\u5730\u9EDE" }), _jsx("dd", { children: card.infraction.locationName }), _jsx("dt", { children: "\u767B\u9304\u8005" }), _jsxs("dd", { children: [card.infraction.reporterName, "\uFF08", ROLE_LABEL[card.infraction.reporterRole], "\uFF09"] }), card.infraction.description && (_jsxs(_Fragment, { children: [_jsx("dt", { children: "\u88DC\u5145" }), _jsx("dd", { children: card.infraction.description })] }))] })] }), _jsxs(Callout, { tone: card.progress.cardCount >= card.progress.threshold - 1 ? 'warning' : undefined, children: [_jsx("span", { "aria-hidden": "true", children: "\uD83D\uDCCA" }), _jsxs("span", { children: ["\u7D2F\u72AF\u8996\u7A97 ", card.progress.windowStart, " ~ ", card.progress.windowEnd, "\uFF1A \u5DF2\u7D2F\u8A08 ", _jsx("strong", { children: card.progress.cardCount }), " / ", card.progress.threshold, " \u5F35", card.progress.shortfall > 0
                                ? `（再 ${card.progress.shortfall} 張即觸發安全觀察員）`
                                : '（已達門檻）'] })] }), _jsxs("section", { children: [_jsx("h3", { className: "card__title", style: { fontSize: 14, marginBottom: 8 }, children: "\u5B78\u751F\u586B\u5BEB\u5167\u5BB9" }), answered.map((item, index) => (_jsxs("div", { className: "qa", children: [_jsx("div", { className: "qa__q", children: item.label }), _jsx("div", { className: "qa__a", children: Array.isArray(item.value)
                                    ? item.value.join('、')
                                    : item.value === undefined || item.value === ''
                                        ? '（未填）'
                                        : String(item.value) })] }, `${item.label}-${index}`)))] }), card.approvals.length > 0 && (_jsxs("section", { children: [_jsx("h3", { className: "card__title", style: { fontSize: 14, marginBottom: 8 }, children: "\u7C3D\u6838\u8ECC\u8DE1" }), _jsx("div", { className: "timeline", children: card.approvals.map((approval, index) => (_jsxs("div", { className: "timeline__item", children: [_jsx("span", { className: "timeline__dot timeline__dot--done" }), _jsxs("div", { children: [_jsxs("div", { className: "timeline__title", children: [approval.stage === 'HOMEROOM_TEACHER' ? '導師簽章' : '生教組蓋章', "\u30FB", approval.decision === 'SIGNED'
                                                    ? '同意'
                                                    : approval.decision === 'EXEMPTED'
                                                        ? '班級活動優先（不計處分）'
                                                        : '退回補正'] }), _jsxs("div", { className: "timeline__meta", children: [approval.actorName, "\u30FB", formatDateTime(approval.actedAt), approval.comment ? `・${approval.comment}` : ''] })] })] }, index))) })] })), stage === 'HOMEROOM_TEACHER' && (_jsxs("label", { className: `check${activityPriority ? ' check--on' : ''}`, children: [_jsx("input", { type: "checkbox", checked: activityPriority, onChange: (event) => setActivityPriority(event.target.checked) }), _jsxs("span", { children: [_jsx("span", { className: "check__label", children: "\u5C0E\u5E2B\u73ED\u7D1A\u6D3B\u52D5\u512A\u5148" }), _jsxs("span", { className: "check__desc", children: ["\u52FE\u9078\u8868\u793A\u8A72\u6642\u6BB5\u70BA\u73ED\u7D1A\u6D3B\u52D5\uFF08\u5982\u73ED\u969B\u6BD4\u8CFD\u7DF4\u7FD2\u3001\u5E79\u90E8\u8A13\u7DF4\uFF09\uFF0C", _jsx("strong", { children: "\u8A72\u6642\u6BB5\u4E0D\u8A08\u5165\u8655\u5206" }), "\uFF1A\u6848\u4EF6\u7D50\u6848\u70BA\u300C\u4E0D\u8A08\u8655\u5206\u300D\u3001\u4E0D\u5217\u5165\u7D2F\u72AF\u7D71\u8A08\uFF0C \u4E26\u7ACB\u5373\u89E3\u9664\u7576\u65E5\u4E0B\u8AB2\u7BA1\u5236\u3002"] })] })] })), stage === 'HOMEROOM_TEACHER' && activityPriority && (_jsx(Field, { label: "\u6D3B\u52D5\u4E8B\u7531", hint: "\u4F9B\u751F\u6559\u7D44\u67E5\u6838\u8207\u5B78\u671F\u7D71\u8A08", children: _jsx("input", { type: "text", value: exemptReason, onChange: (event) => setExemptReason(event.target.value), placeholder: "\u4F8B\uFF1A\u73ED\u969B\u7C43\u7403\u8CFD\u7DF4\u7FD2" }) })), _jsx(Field, { label: stage === 'HOMEROOM_TEACHER' ? '導師評語（選填；退回時必填）' : '生教組意見（選填；退回時必填）', children: _jsx("textarea", { value: comment, onChange: (event) => setComment(event.target.value), placeholder: stage === 'HOMEROOM_TEACHER'
                        ? '例：已與學生談過，願意在走廊提醒同學，值得鼓勵。'
                        : '例：反思內容具體，准予結案。' }) })] }));
}
