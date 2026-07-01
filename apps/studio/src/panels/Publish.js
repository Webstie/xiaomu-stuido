import { jsx as _jsx } from "react/jsx-runtime";
import { PanelShell } from './_PanelShell.js';
export default function Publish() {
    return (_jsx(PanelShell, { title: "Publish", description: "One-click publish to ./data/published/v{N}.json with rollback support." }));
}
