import { jsx as _jsx } from "react/jsx-runtime";
import { PanelShell } from './_PanelShell.js';
import { EXPRESSION_IDS } from '@xiaomu/contracts';
export default function Expressions() {
    return (_jsx(PanelShell, { title: "Expressions", description: `16 expression poses: ${EXPRESSION_IDS.join(', ')}.` }));
}
