import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api.ts';
import { CASE_STATUS_LABEL, CASE_STATUS_TONE, FORM_KIND_TONE, formatDate, } from '../lib/format.ts';
import { Badge, Callout, EmptyState, Field, Panel, WaterNotice } from '../components/ui.tsx';
import { useToast } from '../components/toast.tsx';
/**
 * 學生端：填寫反思卡
 * 在學務處電腦或平板操作；題目由 formTemplates 模板驅動，
 * 必填與最少字數於前後端雙重檢核（後端為準）。
 */
export function StudentCards({ session }) {
    const toast = useToast();
    const [cards, setCards] = useState(null);
    const [active, setActive] = useState(null);
    const [answers, setAnswers] = useState({});
    const [busy, setBusy] = useState(false);
    const load = useCallback(() => {
        const studentId = session.studentId ?? '';
        void api
            .studentCards(studentId)
            .then(setCards)
            .catch(() => setCards([]));
    }, [session.studentId]);
    useEffect(load, [load]);
    const open = async (cardId) => {
        const detail = await api.card(cardId);
        setActive(detail);
        setAnswers(detail.answers ?? {});
    };
    const submit = async () => {
        if (!active)
            return;
        for (const section of active.template.sections) {
            for (const question of section.questions) {
                const value = answers[question.id];
                if (question.required && (value === undefined || value === '')) {
                    toast.push(`「${question.label}」為必填`, 'error');
                    return;
                }
                if (question.minLength && typeof value === 'string' && value.trim().length < question.minLength) {
                    toast.push(`「${question.label}」至少需 ${question.minLength} 字`, 'error');
                    return;
                }
            }
        }
        setBusy(true);
        try {
            await api.submitCard(active.id, answers);
            toast.push('已送出，等待導師線上簽章');
            setActive(null);
            load();
        }
        catch (error) {
            toast.push(error instanceof Error ? error.message : '送出失敗', 'error');
        }
        finally {
            setBusy(false);
        }
    };
    if (active) {
        return (_jsx(_Fragment, { children: _jsx(Panel, { title: active.template.title, hint: `${active.typeName}｜違規日 ${formatDate(active.countOn)}`, actions: _jsx("button", { className: "btn", onClick: () => setActive(null), children: "\u8FD4\u56DE" }), children: _jsxs("div", { className: "stack", children: [_jsxs(Callout, { children: [_jsx("span", { "aria-hidden": "true", children: "\uD83C\uDF31" }), _jsx("span", { children: active.template.guidance })] }), active.template.sections.map((section) => (_jsxs("section", { className: "stack", children: [_jsx("h3", { className: "card__title", style: { fontSize: 14 }, children: section.title }), section.questions.map((question) => {
                                    const value = answers[question.id];
                                    const setValue = (next) => setAnswers((prev) => ({ ...prev, [question.id]: next }));
                                    return (_jsx(Field, { label: `${question.label}${question.required ? ' ＊' : ''}`, hint: question.minLength ? `至少 ${question.minLength} 字` : undefined, children: question.type === 'textarea' ? (_jsx("textarea", { value: value ?? '', placeholder: question.placeholder, onChange: (event) => setValue(event.target.value) })) : question.type === 'choice' ? (_jsxs("select", { value: value ?? '', onChange: (event) => setValue(event.target.value), children: [_jsx("option", { value: "", children: "\u8ACB\u9078\u64C7" }), question.options?.map((option) => (_jsx("option", { value: option, children: option }, option)))] })) : question.type === 'multiselect' ? (_jsx("div", { className: "stack", style: { gap: 6 }, children: question.options?.map((option) => {
                                                const list = Array.isArray(value) ? value : [];
                                                return (_jsxs("label", { className: "row", style: { gap: 8 }, children: [_jsx("input", { type: "checkbox", checked: list.includes(option), onChange: (event) => setValue(event.target.checked
                                                                ? [...list, option]
                                                                : list.filter((item) => item !== option)) }), _jsx("span", { children: option })] }, option));
                                            }) })) : question.type === 'scale' || question.type === 'number' ? (_jsx("input", { type: "number", min: question.min ?? 0, max: question.max ?? 99, value: value ?? '', onChange: (event) => setValue(Number(event.target.value)) })) : (_jsx("input", { type: "text", value: value ?? '', placeholder: question.placeholder, onChange: (event) => setValue(event.target.value) })) }, question.id));
                                })] }, section.id))), _jsx(WaterNotice, {}), _jsxs("div", { className: "btn-row", children: [_jsx("button", { className: "btn btn--primary btn--lg", disabled: busy, onClick: () => void submit(), children: busy ? '送出中…' : '送出，請導師簽章' }), _jsx("span", { className: "small muted", children: "\u9001\u51FA\u5F8C\uFF1A\u5C0E\u5E2B\u7DDA\u4E0A\u7C3D\u7AE0 \u2192 \u751F\u6559\u7D44\u84CB\u7AE0 \u2192 \u7576\u65E5\u81EA\u52D5\u89E3\u9664\u4E0B\u8AB2\u7BA1\u5236" })] })] }) }) }));
    }
    return (_jsx(Panel, { title: "\u6211\u7684\u53CD\u601D\u5361", hint: "\u5B8C\u6210\u586B\u5BEB \u2192 \u5C0E\u5E2B\u7C3D\u7AE0 \u2192 \u751F\u6559\u7D44\u84CB\u7AE0 \u2192 \u7576\u65E5\u89E3\u9664\u7BA1\u5236", flush: true, children: !cards ? (_jsx("div", { className: "card__body muted", children: "\u8F09\u5165\u4E2D\u2026" })) : cards.length === 0 ? (_jsx(EmptyState, { title: "\u76EE\u524D\u6C92\u6709\u5F85\u586B\u5BEB\u7684\u53CD\u601D\u5361", hint: "\u4FDD\u6301\u4E0B\u53BB\uFF01" })) : (_jsx("div", { className: "table-wrap", children: _jsxs("table", { className: "data", children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { children: "\u9055\u898F\u65E5" }), _jsx("th", { children: "\u985E\u578B" }), _jsx("th", { children: "\u53CD\u601D\u5361" }), _jsx("th", { children: "\u72C0\u614B" }), _jsx("th", {})] }) }), _jsx("tbody", { children: cards.map((card) => (_jsxs("tr", { children: [_jsx("td", { children: formatDate(card.countOn) }), _jsx("td", { children: card.typeName }), _jsx("td", { children: _jsx(Badge, { tone: FORM_KIND_TONE[card.formKind], children: card.formTitle }) }), _jsx("td", { children: _jsx(Badge, { tone: CASE_STATUS_TONE[card.status], dot: true, children: CASE_STATUS_LABEL[card.status] }) }), _jsx("td", { children: card.status === 'DRAFT' || card.status === 'RETURNED' ? (_jsx("button", { className: "btn btn--primary", onClick: () => void open(card.id), children: card.status === 'RETURNED' ? '補正後重新送出' : '開始填寫' })) : (_jsx("button", { className: "btn", onClick: () => void open(card.id), children: "\u6AA2\u8996" })) })] }, card.id))) })] }) })) }));
}
