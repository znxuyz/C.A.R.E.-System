import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useState } from 'react';
import { USE_MOCK, auth } from '../lib/api.ts';
import { Callout, Field } from '../components/ui.tsx';
const DEMO_ROLES = [
    { key: 'office', label: '生教組', desc: '審核蓋章、登錄違規、累犯追蹤、值勤台', icon: '🛡️' },
    { key: 'teacher', label: '班導師', desc: '線上簽章、勾選班級活動優先', icon: '✍️' },
    { key: 'patrol', label: '糾察隊／巡堂教師', desc: '快速登錄違規', icon: '📋' },
    { key: 'student', label: '學生', desc: '填寫反思卡、查詢下課狀態', icon: '🎒' },
];
export function Login({ onSignedIn }) {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState(null);
    const [busy, setBusy] = useState(false);
    const signIn = async (identifier, pass = '') => {
        setBusy(true);
        setError(null);
        try {
            onSignedIn(await auth.signIn(identifier, pass));
        }
        catch (err) {
            setError(err instanceof Error ? err.message : '登入失敗');
        }
        finally {
            setBusy(false);
        }
    };
    return (_jsx("div", { className: "login-wrap", children: _jsx("div", { className: "card login-card", children: _jsxs("div", { className: "card__body stack", children: [_jsxs("div", { className: "brand", children: [_jsx("div", { className: "brand__mark", "aria-hidden": "true", children: "CARE" }), _jsxs("div", { children: [_jsx("div", { className: "brand__name", children: "C.A.R.E. System" }), _jsx("div", { className: "brand__sub", children: "Conduct Assessment & Reflection Education" })] })] }), _jsx("p", { className: "small muted", children: "\u6821\u5712\u884C\u70BA\u53CD\u601D\u8207\u8FFD\u8E64\u7CFB\u7D71\uFF5C\u9055\u898F\u767B\u9304\u30FB\u96D9\u8ECC\u53CD\u601D\u5361\u30FB\u5C0E\u5E2B\u7C3D\u7AE0\u30FB\u751F\u6559\u7D44\u84CB\u7AE0\u30FB\u7D2F\u72AF\u8B66\u793A" }), USE_MOCK ? (_jsxs(_Fragment, { children: [_jsxs(Callout, { children: ["\u76EE\u524D\u70BA", _jsx("strong", { children: "\u793A\u7BC4\u6A21\u5F0F" }), "\uFF08\u4E0D\u9023\u7DDA Firebase\uFF0C\u8CC7\u6599\u50C5\u5B58\u5728\u700F\u89BD\u5668\uFF09\u3002 \u8ACB\u9078\u64C7\u4E00\u500B\u89D2\u8272\u9AD4\u9A57\u64CD\u4F5C\u52D5\u7DDA\u3002"] }), _jsx("div", { className: "stack", children: DEMO_ROLES.map((role) => (_jsxs("button", { className: "choice", onClick: () => void signIn(role.key), disabled: busy, children: [_jsx("span", { className: "choice__icon", "aria-hidden": "true", children: role.icon }), _jsxs("span", { children: [_jsxs("span", { className: "choice__title", children: ["\u4EE5\u300C", role.label, "\u300D\u8EAB\u5206\u767B\u5165"] }), _jsx("br", {}), _jsx("span", { className: "choice__desc", children: role.desc })] })] }, role.key))) })] })) : (_jsxs("form", { className: "stack", onSubmit: (event) => {
                            event.preventDefault();
                            void signIn(email, password);
                        }, children: [_jsx(Field, { label: "\u6821\u52D9\u5E33\u865F\uFF08Email\uFF09", children: _jsx("input", { type: "email", value: email, onChange: (event) => setEmail(event.target.value), autoComplete: "username", required: true }) }), _jsx(Field, { label: "\u5BC6\u78BC", children: _jsx("input", { type: "password", value: password, onChange: (event) => setPassword(event.target.value), autoComplete: "current-password", required: true }) }), _jsx("button", { className: "btn btn--primary btn--lg btn--block", disabled: busy, children: busy ? '登入中…' : '登入' })] })), error && _jsx("div", { className: "field__error", children: error })] }) }) }));
}
