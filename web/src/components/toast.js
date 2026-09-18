import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { createContext, useCallback, useContext, useMemo, useState } from 'react';
const ToastContext = createContext({ push: () => { } });
export function ToastProvider({ children }) {
    const [items, setItems] = useState([]);
    const push = useCallback((message, tone = 'good') => {
        const id = Date.now() + Math.random();
        setItems((prev) => [...prev, { id, message, tone }]);
        setTimeout(() => setItems((prev) => prev.filter((item) => item.id !== id)), 4200);
    }, []);
    const value = useMemo(() => ({ push }), [push]);
    return (_jsxs(ToastContext.Provider, { value: value, children: [children, _jsx("div", { className: "toast-stack", role: "status", "aria-live": "polite", children: items.map((item) => (_jsx("div", { className: `toast toast--${item.tone}`, children: item.message }, item.id))) })] }));
}
export const useToast = () => useContext(ToastContext);
