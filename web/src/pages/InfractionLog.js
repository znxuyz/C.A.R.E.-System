import { jsxs as _jsxs, jsx as _jsx, Fragment as _Fragment } from "react/jsx-runtime";
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.ts';
import { useToast } from '../components/toast.tsx';
import { Badge, Callout, Field, Panel, WaterNotice } from '../components/ui.tsx';
/**
 * 違規登錄（生教組 / 糾察隊 / 巡堂教師）
 *
 * 設計目標：走廊現場 30 秒完成。
 *  - 學號輸入 → 即時帶出姓名與班級（避免登錯人）
 *  - 違規類型用大按鈕（只有兩類，且決定配發哪張反思卡）
 *  - 熱點地點優先排序；節次預設當前節次
 *  - 送出後立即顯示三件事：已凍結當日下課、已通知導師、15 天內累計張數
 */
export function InfractionLog() {
    const toast = useToast();
    const [types, setTypes] = useState([]);
    const [locations, setLocations] = useState([]);
    const [studentNo, setStudentNo] = useState('');
    const [matched, setMatched] = useState(null);
    const [typeCode, setTypeCode] = useState('');
    const [locationCode, setLocationCode] = useState('');
    const [periodNo, setPeriodNo] = useState(2);
    const [description, setDescription] = useState('');
    const [busy, setBusy] = useState(false);
    const [result, setResult] = useState(null);
    useEffect(() => {
        void api.infractionTypes().then(setTypes);
        void api.locations().then((rows) => {
            setLocations([...rows].sort((a, b) => Number(b.isHotspot) - Number(a.isHotspot)));
        });
    }, []);
    useEffect(() => {
        const keyword = studentNo.trim();
        if (keyword.length < 3) {
            setMatched(null);
            return;
        }
        let cancelled = false;
        void api.searchStudent(keyword).then((rows) => {
            if (cancelled)
                return;
            const hit = rows.find((row) => row.studentNo === keyword) ?? rows[0] ?? null;
            setMatched(hit ? { id: hit.id, name: hit.name, className: hit.className, windowCardCount: hit.windowCardCount } : null);
        });
        return () => {
            cancelled = true;
        };
    }, [studentNo]);
    const selectedType = types.find((type) => type.code === typeCode);
    const canSubmit = Boolean(matched && typeCode && locationCode) && !busy;
    const submit = async () => {
        if (!canSubmit || !matched)
            return;
        setBusy(true);
        try {
            const response = await api.createInfraction({
                studentNo: studentNo.trim(),
                typeCode,
                locationCode,
                periodNo,
                description: description.trim() || undefined,
            });
            const formTitle = 'formTitle' in response
                ? response.formTitle
                : (selectedType?.formTitle ?? '反思卡');
            setResult({
                studentName: matched.name,
                className: matched.className,
                formTitle,
                windowCardCount: 'windowCardCount' in response
                    ? response.windowCardCount
                    : undefined,
                notifiedTeacher: Boolean(response.notifiedTeacher),
            });
            toast.push(`已登錄 ${matched.name} 的違規，並通知班導師`);
            setStudentNo('');
            setTypeCode('');
            setLocationCode('');
            setDescription('');
            setMatched(null);
        }
        catch (error) {
            toast.push(error instanceof Error ? error.message : '登錄失敗', 'error');
        }
        finally {
            setBusy(false);
        }
    };
    return (_jsxs(_Fragment, { children: [result && (_jsx(Panel, { title: "\u767B\u9304\u5B8C\u6210", hint: "\u7CFB\u7D71\u5DF2\u81EA\u52D5\u8655\u7406\u4E0B\u5217\u4E8B\u9805", children: _jsxs("div", { className: "stack", children: [_jsxs("div", { className: "row", children: [_jsxs(Badge, { tone: "good", dot: true, children: ["\u5DF2\u51CD\u7D50 ", result.className, " ", result.studentName, " \u7576\u65E5\u81EA\u7531\u4E0B\u8AB2"] }), _jsx(Badge, { tone: result.notifiedTeacher ? 'good' : 'warning', dot: true, children: result.notifiedTeacher ? '已推播／Email 通知班導師' : '該班尚未設定導師，未發送通知' }), _jsxs(Badge, { tone: "safety", children: ["\u5DF2\u914D\u767C\uFF1A", result.formTitle] })] }), typeof result.windowCardCount === 'number' && (_jsxs(Callout, { tone: result.windowCardCount >= 2 ? 'warning' : undefined, children: [_jsx("span", { "aria-hidden": "true", children: result.windowCardCount >= 2 ? '⚠️' : 'ℹ️' }), _jsxs("span", { children: ["\u8A72\u751F 15 \u5929\u5167\u7D2F\u8A08 ", _jsx("strong", { children: result.windowCardCount }), " \u5F35\u53CD\u601D\u5361", result.windowCardCount >= 3
                                            ? '；已達門檻，系統已發出累犯警示並排入安全觀察員追蹤清單。'
                                            : `；再 ${3 - result.windowCardCount} 張即觸發累犯警示。`] })] })), _jsxs("div", { className: "btn-row", children: [_jsx("button", { className: "btn", onClick: () => setResult(null), children: "\u7E7C\u7E8C\u767B\u9304\u4E0B\u4E00\u4EF6" }), _jsx(Link, { className: "btn btn--ghost", to: "/office", children: "\u56DE\u5100\u8868\u677F" })] })] }) })), _jsx(Panel, { title: "\u9055\u898F\u4E8B\u4EF6\u767B\u9304", hint: "\u73FE\u5834 30 \u79D2\u5B8C\u6210\uFF5C\u9001\u51FA\u5F8C\u7ACB\u5373\u901A\u77E5\u5C0E\u5E2B", children: _jsxs("div", { className: "stack", children: [_jsxs("div", { className: "form-grid", children: [_jsx(Field, { label: "\u5B78\u865F", hint: matched ? undefined : '輸入 3 碼以上自動比對', error: studentNo.trim().length >= 3 && !matched ? '查無此學號' : undefined, children: _jsx("input", { type: "text", inputMode: "numeric", value: studentNo, onChange: (event) => setStudentNo(event.target.value), placeholder: "\u4F8B\uFF1A1140101", autoFocus: true }) }), _jsx(Field, { label: "\u5B78\u751F", children: _jsx("div", { className: "row", style: { minHeight: 40 }, children: matched ? (_jsxs(_Fragment, { children: [_jsx("strong", { children: matched.name }), _jsx(Badge, { tone: "neutral", children: matched.className }), typeof matched.windowCardCount === 'number' && matched.windowCardCount > 0 && (_jsxs(Badge, { tone: matched.windowCardCount >= 2 ? 'critical' : 'warning', children: ["15 \u5929\u5167 ", matched.windowCardCount, " \u5F35"] }))] })) : (_jsx("span", { className: "muted small", children: "\u5F85\u6BD4\u5C0D" })) }) })] }), _jsxs("div", { className: "field", children: [_jsx("span", { className: "field__label", children: "\u9055\u898F\u985E\u578B\uFF08\u6C7A\u5B9A\u914D\u767C\u54EA\u5F35\u53CD\u601D\u5361\uFF09" }), _jsx("div", { className: "choice-grid", children: types.map((type) => (_jsxs("button", { className: `choice${typeCode === type.code ? ' choice--selected' : ''}`, onClick: () => setTypeCode(type.code), "aria-pressed": typeCode === type.code, children: [_jsx("span", { className: "choice__icon", "aria-hidden": "true", children: type.code === 'RUN_IN_CORRIDOR' ? '🏃' : '💬' }), _jsxs("span", { children: [_jsx("span", { className: "choice__title", children: type.name }), _jsx("br", {}), _jsxs("span", { className: "choice__desc", children: ["\uD83D\uDC49 ", type.formTitle] })] })] }, type.code))) })] }), _jsxs("div", { className: "form-grid", children: [_jsx(Field, { label: "\u5730\u9EDE", children: _jsxs("select", { value: locationCode, onChange: (event) => setLocationCode(event.target.value), children: [_jsx("option", { value: "", children: "\u8ACB\u9078\u64C7" }), locations.map((location) => (_jsxs("option", { value: location.code, children: [location.name, location.isHotspot ? '（熱點）' : ''] }, location.code)))] }) }), _jsx(Field, { label: "\u7BC0\u6B21", children: _jsxs("select", { value: periodNo, onChange: (event) => setPeriodNo(Number(event.target.value)), children: [[1, 2, 3, 4, 5, 6, 7].map((period) => (_jsxs("option", { value: period, children: ["\u7B2C ", period, " \u7BC0\u4E0B\u8AB2"] }, period))), _jsx("option", { value: 0, children: "\u5176\u4ED6\u6642\u6BB5" })] }) })] }), _jsx(Field, { label: "\u88DC\u5145\u8AAA\u660E\uFF08\u9078\u586B\uFF09", hint: "\u5BA2\u89C0\u63CF\u8FF0\u884C\u70BA\uFF0C\u4E0D\u8A55\u50F9\u4EBA\u683C\uFF1B\u6B64\u5167\u5BB9\u5C0E\u5E2B\u8207\u5B78\u751F\u7686\u53EF\u898B", children: _jsx("textarea", { value: description, onChange: (event) => setDescription(event.target.value), placeholder: "\u4F8B\uFF1A\u65BC\u4E09\u6A13\u8D70\u5ECA\u8207\u540C\u5B78\u8FFD\u9010\uFF0C\u7D93\u52F8\u5C0E\u5F8C\u505C\u6B62\u3002", style: { minHeight: 72 } }) }), _jsx(WaterNotice, {}), _jsxs("div", { className: "btn-row", children: [_jsx("button", { className: "btn btn--primary btn--lg", disabled: !canSubmit, onClick: () => void submit(), children: busy ? '登錄中…' : '登錄並通知導師' }), _jsx("span", { className: "small muted", children: "\u9001\u51FA\u5F8C\uFF1A\u51CD\u7D50\u7576\u65E5\u81EA\u7531\u4E0B\u8AB2 \u2192 \u914D\u767C\u53CD\u601D\u5361 \u2192 \u63A8\u64AD\uFF0FEmail \u901A\u77E5\u73ED\u5C0E\u5E2B" })] })] }) })] }));
}
