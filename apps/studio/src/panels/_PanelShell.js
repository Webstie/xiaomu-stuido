import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Construction } from 'lucide-react';
export function PanelShell({ title, description, children }) {
    return (_jsxs("div", { className: "max-w-3xl", children: [_jsxs("div", { className: "mb-6", children: [_jsx("h1", { className: "text-2xl font-semibold text-slate-100", children: title }), _jsx("p", { className: "mt-1 text-sm text-slate-400", children: description })] }), children ?? (_jsxs("div", { className: "rounded-lg border border-dashed border-led-border bg-led-panel p-12 flex flex-col items-center gap-3 text-led-muted", children: [_jsx(Construction, { size: 28 }), _jsx("span", { className: "text-sm", children: "Coming in a later checkpoint" })] }))] }));
}
