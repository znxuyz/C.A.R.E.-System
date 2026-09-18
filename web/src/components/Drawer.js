import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect } from 'react';
/** 右側抽屜：審核詳情用，保留列表上下文（生教組需一件接一件處理） */
export function Drawer({ title, subtitle, onClose, footer, children, }) {
    useEffect(() => {
        const onKey = (event) => {
            if (event.key === 'Escape')
                onClose();
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [onClose]);
    return (_jsx("div", { className: "drawer-backdrop", role: "dialog", "aria-modal": "true", "aria-label": title, onClick: (event) => {
            if (event.target === event.currentTarget)
                onClose();
        }, children: _jsxs("div", { className: "drawer", children: [_jsxs("header", { className: "drawer__head", children: [_jsxs("div", { children: [_jsx("h2", { className: "card__title", children: title }), subtitle && _jsx("div", { className: "small muted", children: subtitle })] }), _jsx("span", { className: "spacer" }), _jsx("button", { className: "btn btn--ghost", onClick: onClose, "aria-label": "\u95DC\u9589", children: "\u2715" })] }), _jsx("div", { className: "drawer__body", children: children }), footer && _jsx("div", { className: "drawer__foot", children: footer })] }) }));
}
