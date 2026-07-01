import { jsx as _jsx } from "react/jsx-runtime";
import SVG2DRenderer from './SVG2DRenderer.js';
export default function FaceRenderer({ renderer = 'svg2d', ...rest }) {
    // Only one renderer in v1; switch here for future swap
    if (renderer === 'svg2d') {
        return _jsx(SVG2DRenderer, { ...rest });
    }
    // reason: exhaustive guard for future renderer kinds
    const _ = renderer;
    return null;
}
